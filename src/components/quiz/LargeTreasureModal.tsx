import { useState } from 'react';
import { CheckCircle2, KeyRound, Lock, Sparkles, Unlock, X } from 'lucide-react';
import { CollectedFragment, SmallChestSpawn } from '../../types/game';
import { scrollInputIntoView } from '../../hooks/useVisualViewport';
import { soundSystem } from '../../game/systems/SoundSystem';

interface LargeTreasureModalProps {
  smallChests: SmallChestSpawn[];
  completedSmallChests: string[];
  collectedFragments: CollectedFragment[];
  isSubmitting: boolean;
  errorMessage: string | null;
  onSubmitCodes: (codes: string[]) => void;
  onClose: () => void;
}

export function LargeTreasureModal({
  smallChests,
  completedSmallChests,
  collectedFragments,
  isSubmitting,
  errorMessage,
  onSubmitCodes,
  onClose,
}: LargeTreasureModalProps) {
  const [inputs, setInputs] = useState<string[]>(() =>
    smallChests.map((chest) => {
      const found = collectedFragments.find((f) => f.chestId === chest.id);
      return found ? '' : '';
    })
  );

  const allSmallCompleted = smallChests.every((c) => completedSmallChests.includes(c.id));

  const handleAutoFillFromJournal = () => {
    soundSystem.playClick();
    setInputs(
      smallChests.map((chest) => {
        const frag = collectedFragments.find((f) => f.chestId === chest.id);
        return frag ? frag.code : '';
      })
    );
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-3 sm:p-6">
      <div className="pixel-panel-gold w-full max-w-2xl max-h-[92dvh] overflow-y-auto p-5 sm:p-6 text-[#f5efe0]">
        <div className="flex items-center justify-between border-b border-amber-500/25 pb-3 mb-4">
          <div className="flex items-center gap-2.5">
            <Lock className="w-5 h-5 text-amber-300" />
            <div>
              <h2 className="font-display text-lg sm:text-xl font-bold text-amber-300">
                Segel Peti Agung (Stage 2)
              </h2>
              <p className="text-xs text-slate-300">
                Masukkan 5 fragmen kode dari seluruh Small Chest untuk membuka ujian Large Treasure (+50 Poin).
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="pixel-btn p-2 bg-slate-800 hover:bg-slate-700 border border-slate-600 text-slate-200 cursor-pointer"
            aria-label="Tutup"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Collected Fragments Reference */}
        <div className="mb-4 p-3.5 bg-slate-950/70 border border-slate-700 space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="text-xs font-bold uppercase tracking-wider text-amber-300 flex items-center gap-1.5">
              <KeyRound className="w-3.5 h-3.5" />
              Fragmen Terkumpul ({collectedFragments.length}/{smallChests.length})
            </div>
            {allSmallCompleted && collectedFragments.length === smallChests.length && (
              <button
                type="button"
                onClick={handleAutoFillFromJournal}
                className="text-xs text-sky-300 hover:text-sky-200 underline cursor-pointer"
              >
                Isi Otomatis dari Jurnal
              </button>
            )}
          </div>

          {collectedFragments.length === 0 ? (
            <p className="text-xs text-slate-400">
              Belum ada fragmen kode. Temukan dan selesaikan semua 5 Small Chest di berbagai zona pulau!
            </p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {collectedFragments.map((frag) => (
                <div
                  key={frag.chestId}
                  className="px-2.5 py-1 bg-amber-500/15 border border-amber-400/50 text-xs flex items-center gap-2"
                >
                  <span className="text-slate-300">{frag.chestName}:</span>
                  <span className="font-mono-num font-bold text-amber-300">{frag.code}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* 5 Combination Lock Inputs */}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            soundSystem.playClick();
            onSubmitCodes(inputs.map((v) => v.trim().toUpperCase()));
          }}
          className="space-y-3"
        >
          {smallChests.map((chest, idx) => {
            const completed = completedSmallChests.includes(chest.id);
            return (
              <div
                key={chest.id}
                className={`p-3 border flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 ${
                  completed
                    ? 'bg-slate-900/80 border-emerald-500/40'
                    : 'bg-slate-950/60 border-slate-800'
                }`}
              >
                <div className="flex items-center gap-2.5">
                  {completed ? (
                    <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                  ) : (
                    <Lock className="w-4 h-4 text-slate-500 shrink-0" />
                  )}
                  <div>
                    <div className="text-sm font-semibold text-white">
                      {idx + 1}. {chest.name}
                    </div>
                    <div className="text-xs text-slate-400">{chest.zone}</div>
                  </div>
                </div>

                <input
                  type="text"
                  disabled={!completed || isSubmitting}
                  value={inputs[idx] ?? ''}
                  onFocus={(e) => scrollInputIntoView(e.currentTarget)}
                  onChange={(e) => {
                    const next = [...inputs];
                    next[idx] = e.target.value.toUpperCase();
                    setInputs(next);
                  }}
                  placeholder={completed ? 'KODE FRAGMEN' : 'Peti belum selesai'}
                  className="w-full sm:w-44 min-h-[44px] px-3 py-2 bg-slate-950 border border-slate-600 focus:border-amber-400 focus:outline-none font-mono-num text-sm tracking-widest uppercase text-center text-amber-200 disabled:opacity-45"
                />
              </div>
            );
          })}

          {errorMessage && (
            <div className="p-3 bg-rose-950/70 border border-rose-500/60 text-xs sm:text-sm text-rose-200">
              {errorMessage}
            </div>
          )}

          <div className="pt-2 flex flex-wrap items-center justify-between gap-3">
            <div className="text-xs text-slate-400 flex items-center gap-1.5">
              <Sparkles className="w-3.5 h-3.5 text-amber-300" />
              {allSmallCompleted
                ? 'Semua peti kecil selesai! Cocokkan kode untuk membuka segel.'
                : `Selesaikan ${smallChests.length - completedSmallChests.length} peti kecil lagi.`}
            </div>

            <div className="flex items-center gap-2.5">
              <button
                type="button"
                onClick={onClose}
                className="pixel-btn px-4 py-2.5 bg-slate-800 hover:bg-slate-700 border border-slate-600 text-slate-200 text-sm cursor-pointer"
              >
                Tutup
              </button>
              <button
                type="submit"
                disabled={!allSmallCompleted || isSubmitting || inputs.some((v) => !v.trim())}
                className="pixel-btn inline-flex items-center gap-2 px-5 py-2.5 bg-amber-500 hover:bg-amber-400 disabled:opacity-45 text-slate-950 font-bold text-sm cursor-pointer"
              >
                <Unlock className="w-4 h-4" />
                {isSubmitting ? 'Memvalidasi...' : 'Buka Segel Large Treasure'}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
