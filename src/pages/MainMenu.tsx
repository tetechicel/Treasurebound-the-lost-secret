import { useEffect, useRef, useState } from 'react';
import { BookOpen, Info, Play, Settings, X } from 'lucide-react';
import { GameSettings } from '../types/game';
import { HowToPlayModal } from '../components/ui/HowToPlayModal';
import { SettingsModal } from '../components/ui/SettingsModal';
import { CreditsModal } from '../components/ui/CreditsModal';
import { FullscreenButton } from '../components/ui/FullscreenButton';
import { PWAInstallButton } from '../components/ui/PWAInstallButton';
import { soundSystem } from '../game/systems/SoundSystem';

interface MainMenuProps {
  settings: GameSettings;
  isFullscreen: boolean;
  isStandalone: boolean;
  fullscreenNotice: string | null;
  onDismissFullscreenNotice: () => void;
  onToggleFullscreen: (lockLandscape?: boolean) => void;
  onUpdateSettings: (next: GameSettings) => void;
  onPlay: () => void;
}

export function MainMenu({
  settings,
  isFullscreen,
  isStandalone,
  fullscreenNotice,
  onDismissFullscreenNotice,
  onToggleFullscreen,
  onUpdateSettings,
  onPlay,
}: MainMenuProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [modal, setModal] = useState<'howto' | 'settings' | 'credits' | null>(null);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (modal) {
        if (e.key === 'Escape') setModal(null);
        return;
      }
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        soundSystem.playClick();
        onPlay();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [modal, onPlay]);

  // Animated Pixel-Art Island Horizon Backdrop
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let rafId = 0;
    const w = 320;
    const h = 180;
    canvas.width = w;
    canvas.height = h;
    ctx.imageSmoothingEnabled = false;

    const fireflies = Array.from({ length: 18 }, (_, i) => ({
      x: (i * 37) % w,
      y: 45 + ((i * 23) % 90),
      phase: i * 0.7,
    }));

    const render = (t: number) => {
      const sec = t * 0.001;

      const skyBands = ['#0d1d2e', '#132a42', '#1a3b57', '#24526e', '#2f6d82'];
      skyBands.forEach((col, i) => {
        ctx.fillStyle = col;
        ctx.fillRect(0, i * 20, w, 21);
      });

      ctx.fillStyle = '#d98c3f';
      ctx.fillRect(218, 56, 26, 26);
      ctx.fillStyle = '#f5c451';
      ctx.fillRect(222, 60, 18, 18);

      ctx.fillStyle = '#487d91';
      const c1 = Math.floor((sec * 4) % (w + 60)) - 50;
      const c2 = Math.floor((sec * 2.5 + 140) % (w + 60)) - 50;
      ctx.fillRect(c1, 24, 34, 6);
      ctx.fillRect(c1 + 6, 20, 20, 4);
      ctx.fillRect(c2, 38, 28, 5);
      ctx.fillRect(c2 + 5, 35, 16, 3);

      ctx.fillStyle = '#1d3c34';
      ctx.fillRect(140, 82, 130, 26);
      ctx.fillRect(160, 72, 90, 12);
      ctx.fillStyle = '#2d4745';
      ctx.fillRect(204, 58, 38, 16);
      ctx.fillRect(212, 48, 22, 10);
      ctx.fillStyle = '#f59e0b';
      ctx.fillRect(221, 52, 4, 4);

      ctx.fillStyle = '#2c5e2e';
      ctx.fillRect(110, 96, 175, 18);
      ctx.fillStyle = '#498c3c';
      ctx.fillRect(122, 94, 152, 6);
      ctx.fillStyle = '#54351e';
      ctx.fillRect(148, 84, 20, 12);
      ctx.fillStyle = '#d99b2e';
      ctx.fillRect(144, 78, 28, 8);
      ctx.fillStyle = '#fde68a';
      ctx.fillRect(156, 88, 4, 4);

      ctx.fillStyle = '#12738c';
      ctx.fillRect(0, 108, w, 72);
      ctx.fillStyle = '#1893b0';
      ctx.fillRect(0, 114, w, 40);

      for (let i = 0; i < 16; i++) {
        const wy = 114 + (i % 6) * 10;
        const wx = Math.floor(((i * 43 + sec * (10 + (i % 3) * 4)) % (w + 30)) - 20);
        ctx.fillStyle = i % 2 === 0 ? '#5ce1f5' : '#2bb8d4';
        ctx.fillRect(wx, wy, 14, 2);
      }

      fireflies.forEach((f) => {
        const fx = f.x + Math.sin(sec * 1.4 + f.phase) * 8;
        const fy = f.y + Math.cos(sec * 1.8 + f.phase) * 5;
        const alpha = 0.45 + 0.55 * Math.sin(sec * 3 + f.phase);
        ctx.fillStyle = `rgba(253, 224, 71, ${alpha.toFixed(2)})`;
        ctx.fillRect(Math.floor(fx), Math.floor(fy), 2, 2);
      });

      rafId = requestAnimationFrame(render);
    };

    rafId = requestAnimationFrame(render);
    return () => cancelAnimationFrame(rafId);
  }, []);

  return (
    <div className="screen-scroll-shell relative bg-[#0d1d2e] select-none">
      {/* Live Pixel Island Panorama */}
      <canvas
        ref={canvasRef}
        className="fixed inset-0 w-full h-full object-cover pointer-events-none"
        style={{ imageRendering: 'pixelated' }}
      />

      {/* Contrast Scrim on left negative-space side for crisp readability */}
      <div className="fixed inset-0 bg-gradient-to-r from-[#09121c]/90 via-[#09121c]/60 to-transparent pointer-events-none" />

      <div className="relative z-10 flex-1 w-full max-w-6xl mx-auto px-4 sm:px-10 py-4 sm:py-8 safe-inset-padded flex flex-col justify-between gap-6">
        {/* Top Utility Row: PWA Install + Fullscreen */}
        <div className="flex flex-wrap items-center justify-end gap-2">
          <PWAInstallButton />
          <FullscreenButton
            isFullscreen={isFullscreen}
            isStandalone={isStandalone}
            lockLandscape={true}
            onToggle={onToggleFullscreen}
          />
        </div>

        {fullscreenNotice && (
          <div className="pixel-panel px-3.5 py-2.5 text-xs text-amber-200 flex items-center justify-between gap-3 max-w-lg self-end">
            <span>{fullscreenNotice}</span>
            <button
              type="button"
              onClick={onDismissFullscreenNotice}
              className="p-1 text-slate-300 hover:text-white cursor-pointer shrink-0"
              aria-label="Tutup pemberitahuan"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        {/* Focal Title Lockup + Primary Menu */}
        <div className="my-auto max-w-lg space-y-4 sm:space-y-6">
          <div className="space-y-2.5 sm:space-y-3">
            <svg
              viewBox="0 0 420 92"
              className="w-full max-w-[340px] sm:max-w-[400px] h-auto drop-shadow-[0_4px_12px_rgba(0,0,0,0.85)]"
              role="img"
              aria-label="TREASUREBOUND: The Lost Secret"
            >
              <defs>
                <linearGradient id="goldTitle" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#fef08a" />
                  <stop offset="50%" stopColor="#f59e0b" />
                  <stop offset="100%" stopColor="#b45309" />
                </linearGradient>
              </defs>
              <polygon
                points="24,10 30,24 44,24 33,33 37,47 24,38 11,47 15,33 4,24 18,24"
                fill="#fbbf24"
                stroke="#451a03"
                strokeWidth="2"
              />
              <text
                x="54"
                y="42"
                fontFamily="Cinzel, Georgia, serif"
                fontWeight="700"
                fontSize="36"
                letterSpacing="2"
                fill="url(#goldTitle)"
                stroke="#231204"
                strokeWidth="4"
                paintOrder="stroke"
              >
                TREASUREBOUND
              </text>
              <text
                x="56"
                y="72"
                fontFamily="Cinzel, Georgia, serif"
                fontWeight="600"
                fontSize="16"
                letterSpacing="5"
                fill="#e2e8f0"
              >
                THE LOST SECRET
              </text>
            </svg>

            <p className="text-sm sm:text-base text-slate-200 leading-relaxed max-w-md">
              Explore a seeded pixel-art island, outsmart rival treasure hunters in real-time, and
              crack academic knowledge trials to claim the lost crown.
            </p>
          </div>

          <div className="flex flex-col sm:flex-row sm:items-center gap-3">
            <button
              type="button"
              onClick={() => {
                soundSystem.playClick();
                onPlay();
              }}
              className="pixel-btn inline-flex items-center justify-center gap-2.5 min-h-[48px] px-7 py-3 bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-base border-2 border-amber-200 shadow-lg cursor-pointer whitespace-nowrap shrink-0"
            >
              <Play className="w-5 h-5 fill-current" />
              Play Adventure
            </button>

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  soundSystem.playClick();
                  setModal('howto');
                }}
                className="pixel-btn inline-flex items-center justify-center gap-2 min-h-[44px] px-4 py-2.5 bg-slate-900/90 hover:bg-slate-800 border border-slate-600 text-slate-100 text-sm font-medium cursor-pointer whitespace-nowrap shrink-0"
              >
                <BookOpen className="w-4 h-4 text-amber-400" />
                How to Play
              </button>

              <button
                type="button"
                onClick={() => {
                  soundSystem.playClick();
                  setModal('settings');
                }}
                className="pixel-btn inline-flex items-center justify-center gap-2 min-h-[44px] px-3.5 py-2.5 bg-slate-900/90 hover:bg-slate-800 border border-slate-600 text-slate-100 text-sm font-medium cursor-pointer whitespace-nowrap shrink-0"
                aria-label="Settings"
              >
                <Settings className="w-4 h-4 text-slate-300" />
                Settings
              </button>

              <button
                type="button"
                onClick={() => {
                  soundSystem.playClick();
                  setModal('credits');
                }}
                className="pixel-btn inline-flex items-center justify-center gap-2 min-h-[44px] px-3.5 py-2.5 bg-slate-900/90 hover:bg-slate-800 border border-slate-600 text-slate-100 text-sm font-medium cursor-pointer whitespace-nowrap shrink-0"
                aria-label="Credits"
              >
                <Info className="w-4 h-4 text-slate-300" />
                Credits
              </button>
            </div>
          </div>
        </div>

        {/* Single flat control-hint line */}
        <div className="text-xs text-slate-400 tracking-wide">
          WASD Move · Mouse Aim · E Attack · F Interact · Touch Controls Supported on Mobile
        </div>
      </div>

      {modal === 'howto' && <HowToPlayModal onClose={() => setModal(null)} />}
      {modal === 'settings' && (
        <SettingsModal
          settings={settings}
          onChange={onUpdateSettings}
          onClose={() => setModal(null)}
        />
      )}
      {modal === 'credits' && <CreditsModal onClose={() => setModal(null)} />}
    </div>
  );
}
