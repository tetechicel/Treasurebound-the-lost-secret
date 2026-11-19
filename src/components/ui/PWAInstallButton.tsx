import { useState } from 'react';
import { Download, Share, X } from 'lucide-react';
import { usePWAInstall } from '../../hooks/usePWAInstall';
import { soundSystem } from '../../game/systems/SoundSystem';

interface PWAInstallButtonProps {
  compact?: boolean;
}

export function PWAInstallButton({ compact = false }: PWAInstallButtonProps) {
  const { isInstallable, isInstalled, isIOS, promptInstall } = usePWAInstall();
  const [showIOSGuide, setShowIOSGuide] = useState(false);

  if (isInstalled || (!isInstallable && !isIOS)) {
    return null;
  }

  const handleClick = async () => {
    soundSystem.playClick();
    if (isIOS) {
      setShowIOSGuide(true);
      return;
    }
    await promptInstall();
  };

  return (
    <>
      <button
        type="button"
        onClick={handleClick}
        className="pixel-btn inline-flex items-center justify-center gap-2 min-h-[44px] px-3.5 py-2.5 bg-amber-500/15 hover:bg-amber-500/25 border border-amber-400/70 text-amber-200 text-xs sm:text-sm font-semibold cursor-pointer whitespace-nowrap shrink-0"
        aria-label="Pasang Aplikasi TREASUREBOUND"
      >
        <Download className="w-4 h-4 text-amber-300 shrink-0" />
        <span>{compact ? 'Pasang App' : 'Pasang Aplikasi'}</span>
      </button>

      {showIOSGuide && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4">
          <div className="pixel-panel-gold w-full max-w-sm p-5 text-[#f5efe0] space-y-4">
            <div className="flex items-center justify-between border-b border-amber-500/25 pb-2.5">
              <h3 className="font-display text-lg font-bold text-amber-300">
                Pasang TREASUREBOUND
              </h3>
              <button
                type="button"
                onClick={() => setShowIOSGuide(false)}
                className="pixel-btn min-w-[44px] min-h-[44px] flex items-center justify-center bg-slate-800 hover:bg-slate-700 border border-slate-600 text-slate-200 cursor-pointer"
                aria-label="Tutup panduan instalasi"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <p className="text-xs sm:text-sm text-slate-200 leading-relaxed">
              Mainkan dalam mode layar penuh di iOS Safari dengan menambahkannya ke Layar Utama:
            </p>

            <ol className="space-y-2 text-xs sm:text-sm text-slate-200 list-decimal pl-5">
              <li>
                Ketuk ikon{' '}
                <span className="inline-flex items-center gap-1 font-semibold text-amber-300">
                  Bagikan <Share className="w-3.5 h-3.5 inline" />
                </span>{' '}
                pada bilah browser Safari.
              </li>
              <li>
                Gulir lalu pilih{' '}
                <span className="font-semibold text-amber-300">
                  Tambah ke Layar Utama (Add to Home Screen)
                </span>
                .
              </li>
              <li>Buka ikon TREASURE dari Layar Utama untuk pengalaman penuh.</li>
            </ol>

            <button
              type="button"
              onClick={() => setShowIOSGuide(false)}
              className="pixel-btn w-full min-h-[44px] bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-sm cursor-pointer"
            >
              Mengerti
            </button>
          </div>
        </div>
      )}
    </>
  );
}
