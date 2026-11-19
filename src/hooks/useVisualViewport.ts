import { useEffect, useState } from 'react';

export interface VisualViewportState {
  width: number;
  height: number;
  isPortrait: boolean;
  isCompactHeight: boolean;
  isKeyboardOpen: boolean;
}

function readViewport(): VisualViewportState {
  if (typeof window === 'undefined') {
    return {
      width: 1280,
      height: 720,
      isPortrait: false,
      isCompactHeight: false,
      isKeyboardOpen: false,
    };
  }

  const vv = window.visualViewport;
  const width = Math.round(vv?.width ?? window.innerWidth);
  const height = Math.round(vv?.height ?? window.innerHeight);
  const activeTag = document.activeElement?.tagName;
  const inputFocused = activeTag === 'INPUT' || activeTag === 'TEXTAREA';
  const heightDelta = window.innerHeight - height;
  const isKeyboardOpen = inputFocused && (heightDelta > 110 || height < 420);

  return {
    width,
    height,
    isPortrait: height > width,
    isCompactHeight: height <= 480,
    isKeyboardOpen,
  };
}

export function syncVisualViewportCssVars(): VisualViewportState {
  const next = readViewport();
  if (typeof document !== 'undefined') {
    document.documentElement.style.setProperty('--vvh', `${next.height}px`);
    document.documentElement.style.setProperty('--vvw', `${next.width}px`);
  }
  return next;
}

export function useVisualViewport(): VisualViewportState {
  const [state, setState] = useState<VisualViewportState>(() => readViewport());

  useEffect(() => {
    const update = () => {
      setState(syncVisualViewportCssVars());
    };

    update();
    const vv = window.visualViewport;
    vv?.addEventListener('resize', update);
    vv?.addEventListener('scroll', update);
    window.addEventListener('resize', update);
    window.addEventListener('orientationchange', update);

    return () => {
      vv?.removeEventListener('resize', update);
      vv?.removeEventListener('scroll', update);
      window.removeEventListener('resize', update);
      window.removeEventListener('orientationchange', update);
    };
  }, []);

  return state;
}

export function scrollInputIntoView(element: HTMLElement | null): void {
  if (!element || typeof window === 'undefined') return;
  const runScroll = () => {
    syncVisualViewportCssVars();
    element.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'nearest' });
  };
  window.setTimeout(runScroll, 120);
  window.setTimeout(runScroll, 340);
}
