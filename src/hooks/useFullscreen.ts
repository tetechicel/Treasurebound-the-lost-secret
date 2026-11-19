import { useCallback, useEffect, useState } from 'react';

interface FullscreenDocument extends Document {
  webkitFullscreenElement?: Element | null;
  webkitFullscreenEnabled?: boolean;
  webkitExitFullscreen?: () => Promise<void> | void;
}

interface FullscreenElement extends HTMLElement {
  webkitRequestFullscreen?: () => Promise<void> | void;
}

interface OrientationWithLock {
  lock?: (orientation: 'landscape' | 'landscape-primary' | 'portrait') => Promise<void>;
  unlock?: () => void;
}

function getFullscreenElement(): Element | null {
  if (typeof document === 'undefined') return null;
  const doc = document as FullscreenDocument;
  return doc.fullscreenElement ?? doc.webkitFullscreenElement ?? null;
}

function checkIsStandalone(): boolean {
  if (typeof window === 'undefined') return false;
  const nav = window.navigator as Navigator & { standalone?: boolean };
  return (
    window.matchMedia('(display-mode: fullscreen)').matches ||
    window.matchMedia('(display-mode: standalone)').matches ||
    nav.standalone === true
  );
}

function checkIsSupported(): boolean {
  if (typeof document === 'undefined') return false;
  const doc = document as FullscreenDocument;
  const el = doc.documentElement as FullscreenElement;
  const hasMethod = Boolean(el?.requestFullscreen || el?.webkitRequestFullscreen);
  const enabledFlag =
    doc.fullscreenEnabled !== undefined
      ? doc.fullscreenEnabled
      : doc.webkitFullscreenEnabled !== undefined
        ? doc.webkitFullscreenEnabled
        : true;
  return Boolean(hasMethod && enabledFlag);
}

export async function tryLockLandscapeOrientation(): Promise<boolean> {
  if (typeof screen === 'undefined') return false;
  const orientation = screen.orientation as unknown as OrientationWithLock | undefined;
  if (!orientation?.lock) return false;
  try {
    await orientation.lock('landscape');
    return true;
  } catch {
    return false;
  }
}

export function tryUnlockOrientation(): void {
  if (typeof screen === 'undefined') return;
  const orientation = screen.orientation as unknown as OrientationWithLock | undefined;
  try {
    orientation?.unlock?.();
  } catch {
    // Ignore when orientation unlock is unsupported
  }
}

export function useFullscreen() {
  const [isFullscreen, setIsFullscreen] = useState<boolean>(() => Boolean(getFullscreenElement()));
  const [isStandalone, setIsStandalone] = useState<boolean>(() => checkIsStandalone());
  const [isSupported, setIsSupported] = useState<boolean>(() => checkIsSupported());
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    setIsSupported(checkIsSupported());
    setIsStandalone(checkIsStandalone());

    const syncState = () => {
      const active = Boolean(getFullscreenElement());
      setIsFullscreen(active);
      setIsStandalone(checkIsStandalone());
      if (active) setNotice(null);
    };

    const handleError = () => {
      setIsFullscreen(Boolean(getFullscreenElement()));
      setNotice(
        'Mode Layar Penuh diblokir oleh browser atau frame saat ini. Game tetap dapat dimainkan normal.'
      );
    };

    const displayMedia = window.matchMedia('(display-mode: fullscreen)');
    const standaloneMedia = window.matchMedia('(display-mode: standalone)');

    document.addEventListener('fullscreenchange', syncState);
    document.addEventListener('webkitfullscreenchange', syncState);
    document.addEventListener('fullscreenerror', handleError);
    document.addEventListener('webkitfullscreenerror', handleError);
    displayMedia.addEventListener('change', syncState);
    standaloneMedia.addEventListener('change', syncState);

    return () => {
      document.removeEventListener('fullscreenchange', syncState);
      document.removeEventListener('webkitfullscreenchange', syncState);
      document.removeEventListener('fullscreenerror', handleError);
      document.removeEventListener('webkitfullscreenerror', handleError);
      displayMedia.removeEventListener('change', syncState);
      standaloneMedia.removeEventListener('change', syncState);
    };
  }, []);

  const enterFullscreen = useCallback(async (lockLandscape = false): Promise<boolean> => {
    setNotice(null);
    if (getFullscreenElement()) {
      if (lockLandscape) await tryLockLandscapeOrientation();
      return true;
    }

    const doc = document as FullscreenDocument;
    const el = doc.documentElement as FullscreenElement;

    if (!el) return false;

    try {
      if (el.requestFullscreen) {
        try {
          await el.requestFullscreen({ navigationUI: 'hide' } as FullscreenOptions);
        } catch {
          await el.requestFullscreen();
        }
      } else if (el.webkitRequestFullscreen) {
        await el.webkitRequestFullscreen();
      } else {
        setNotice(
          'Browser ini tidak mendukung Fullscreen API. Pasang sebagai PWA (Tambah ke Layar Utama) untuk tampilan penuh.'
        );
        return false;
      }

      setIsFullscreen(true);
      if (lockLandscape) {
        await tryLockLandscapeOrientation();
      }
      return true;
    } catch {
      setNotice(
        'Layar Penuh tidak diizinkan oleh browser saat ini. Pasang sebagai aplikasi (PWA) atau lanjutkan bermain langsung.'
      );
      return false;
    }
  }, []);

  const exitFullscreen = useCallback(async (): Promise<void> => {
    const doc = document as FullscreenDocument;
    try {
      if (doc.fullscreenElement && doc.exitFullscreen) {
        await doc.exitFullscreen();
      } else if (doc.webkitFullscreenElement && doc.webkitExitFullscreen) {
        await doc.webkitExitFullscreen();
      }
    } catch {
      // Ignore exit errors
    } finally {
      tryUnlockOrientation();
      setIsFullscreen(Boolean(getFullscreenElement()));
    }
  }, []);

  const toggleFullscreen = useCallback(
    async (lockLandscape = true) => {
      if (getFullscreenElement()) {
        await exitFullscreen();
      } else {
        await enterFullscreen(lockLandscape);
      }
    },
    [enterFullscreen, exitFullscreen]
  );

  const dismissNotice = useCallback(() => setNotice(null), []);

  return {
    isFullscreen,
    isStandalone,
    isSupported,
    notice,
    dismissNotice,
    enterFullscreen,
    exitFullscreen,
    toggleFullscreen,
  };
}
