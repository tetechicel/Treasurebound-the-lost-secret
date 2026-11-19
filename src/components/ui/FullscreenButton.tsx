import { Maximize2, Minimize2 } from 'lucide-react';
import { soundSystem } from '../../game/systems/SoundSystem';

interface FullscreenButtonProps {
  isFullscreen: boolean;
  isStandalone?: boolean;
  lockLandscape?: boolean;
  compact?: boolean;
  onToggle: (lockLandscape?: boolean) => void;
}

export function FullscreenButton({
  isFullscreen,
  isStandalone = false,
  lockLandscape = true,
  compact = false,
  onToggle,
}: FullscreenButtonProps) {
  if (isStandalone) return null;

  return (
    <button
      type="button"
      onClick={() => {
        soundSystem.playClick();
        onToggle(lockLandscape);
      }}
      className={`pixel-btn inline-flex items-center justify-center gap-2 min-h-[44px] ${
        compact ? 'min-w-[44px] px-2.5' : 'px-3.5 py-2.5'
      } bg-slate-900/90 hover:bg-slate-800 border border-slate-600 text-slate-100 text-xs sm:text-sm font-medium cursor-pointer whitespace-nowrap shrink-0`}
      aria-label={isFullscreen ? 'Keluar Layar Penuh' : 'Masuk Layar Penuh'}
      title={isFullscreen ? 'Keluar Layar Penuh' : 'Masuk Layar Penuh'}
    >
      {isFullscreen ? (
        <Minimize2 className="w-4 h-4 text-amber-300 shrink-0" />
      ) : (
        <Maximize2 className="w-4 h-4 text-amber-300 shrink-0" />
      )}
      {!compact && <span>{isFullscreen ? 'Keluar Penuh' : 'Layar Penuh'}</span>}
    </button>
  );
}
