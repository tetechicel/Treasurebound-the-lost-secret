import { useEffect, useState } from 'react';
import { CheckCircle2, Clock, KeyRound, RefreshCw, Sparkles, XCircle } from 'lucide-react';
import { ActiveQuizSeriesChallenge, QuizSubmissionResult } from '../../types/game';
import { soundSystem } from '../../game/systems/SoundSystem';

interface QuizModalProps {
  challenge: ActiveQuizSeriesChallenge;
  isSubmitting: boolean;
  result: QuizSubmissionResult | null;
  onSelectAnswer: (index: number) => void;
  onNextQuestion: () => void;
  onRetryWrongQuestion: () => void;
  onClose: () => void;
}

const OPTION_LETTERS = ['A', 'B', 'C', 'D'];

export function QuizModal({
  challenge,
  isSubmitting,
  result,
  onSelectAnswer,
  onNextQuestion,
  onRetryWrongQuestion,
  onClose,
}: QuizModalProps) {
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const [secondsLeft, setSecondsLeft] = useState(35);

  const q = challenge.questions[challenge.currentIndex];

  useEffect(() => {
    setSelectedIndex(null);
    setSecondsLeft(35);
  }, [q?.id, challenge.currentIndex, challenge.attemptNonce]);

  useEffect(() => {
    if (!q || result || isSubmitting) return;
    const timer = window.setInterval(() => {
      setSecondsLeft((prev) => {
        if (prev <= 1) {
          window.clearInterval(timer);
          onSelectAnswer(-1);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => window.clearInterval(timer);
  }, [q, result, isSubmitting, onSelectAnswer]);

  if (!q) return null;

  const isMultiQuestion = challenge.totalRequired > 1;
  const solvedCount = challenge.correctInSeries;
  const isSeriesDone = Boolean(result?.challenge_completed) || (Boolean(result?.is_correct) && solvedCount >= challenge.totalRequired);
  const canAdvanceNext = Boolean(result?.is_correct) && !isSeriesDone;
  const needsRetry = Boolean(result && !result.is_correct);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-3 sm:p-6">
      <div className="pixel-panel-gold w-full max-w-2xl max-h-[92dvh] overflow-y-auto p-5 sm:p-6 text-[#f5efe0]">
        {/* Header Metadata */}
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-amber-500/25 pb-3 mb-4">
          <div>
            <div className="flex items-center gap-2 font-display text-lg sm:text-xl font-bold text-amber-300">
              <span>{challenge.title}</span>
              {isMultiQuestion && (
                <span className="font-mono-num text-xs bg-amber-500/20 border border-amber-400/50 px-2 py-0.5 text-amber-200">
                  Progres {Math.min(challenge.totalRequired, solvedCount)}/{challenge.totalRequired}
                </span>
              )}
            </div>
            <div className="text-xs text-slate-300 mt-0.5">
              Jenjang {q.education_level} · {q.subject} · {q.topic} · {challenge.region}
            </div>
          </div>

          <div
            className={`inline-flex items-center gap-1.5 font-mono-num text-sm font-bold ${
              secondsLeft <= 8 && !result ? 'text-rose-400' : 'text-amber-300'
            }`}
          >
            <Clock className="w-4 h-4" />
            {secondsLeft}d
          </div>
        </div>

        {/* Multi-question progress bar */}
        {isMultiQuestion && (
          <div className="grid grid-cols-3 gap-1.5 mb-4" style={{ gridTemplateColumns: `repeat(${challenge.totalRequired}, minmax(0, 1fr))` }}>
            {Array.from({ length: challenge.totalRequired }).map((_, idx) => (
              <div
                key={idx}
                className={`h-1.5 border ${
                  idx < solvedCount
                    ? 'bg-emerald-400 border-emerald-300'
                    : idx === solvedCount
                      ? 'bg-amber-400/60 border-amber-300'
                      : 'bg-slate-900 border-slate-700'
                }`}
              />
            ))}
          </div>
        )}

        {/* Question Prompt */}
        <div className="text-sm sm:text-base font-medium text-white leading-relaxed mb-5 bg-slate-950/60 border border-slate-700/80 p-4">
          {q.question_text}
        </div>

        {/* 4 Answer Options */}
        <div className="grid grid-cols-1 gap-2.5">
          {q.options.map((opt, idx) => {
            const isChosen = selectedIndex === idx;
            const isCorrectOpt = result?.correct_index === idx;

            let btnStyle =
              'bg-slate-900/90 hover:bg-slate-800 border-slate-600 text-slate-100';
            if (result) {
              if (isCorrectOpt) {
                btnStyle = 'bg-emerald-950/80 border-emerald-400 text-emerald-100';
              } else if (isChosen && !result.is_correct) {
                btnStyle = 'bg-rose-950/80 border-rose-400 text-rose-100';
              } else {
                btnStyle = 'bg-slate-950/60 border-slate-800 text-slate-400';
              }
            } else if (isChosen) {
              btnStyle = 'bg-amber-500/20 border-amber-400 text-amber-100';
            }

            return (
              <button
                key={idx}
                type="button"
                disabled={Boolean(result) || isSubmitting}
                onClick={() => {
                  soundSystem.playClick();
                  setSelectedIndex(idx);
                  onSelectAnswer(idx);
                }}
                className={`pixel-btn w-full text-left px-4 py-3 border flex items-start gap-3 cursor-pointer disabled:cursor-default ${btnStyle}`}
              >
                <span className="font-mono-num font-bold text-amber-300 shrink-0">
                  {OPTION_LETTERS[idx]}.
                </span>
                <span className="text-sm leading-snug">{opt}</span>
              </button>
            );
          })}
        </div>

        {/* Answer Feedback & Explanation */}
        {result && (
          <div
            className={`mt-5 p-4 border ${
              result.is_correct
                ? 'bg-emerald-950/55 border-emerald-500/60'
                : 'bg-rose-950/55 border-rose-500/60'
            }`}
          >
            <div className="flex items-center justify-between gap-2 mb-1.5">
              <div className="flex items-center gap-2 font-bold text-sm">
                {result.is_correct ? (
                  <>
                    <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                    <span className="text-emerald-300">
                      Benar! +{result.points_delta} Poin
                      {result.bonus_points_delta > 0
                        ? ` (+${result.bonus_points_delta} Bonus Selesai)`
                        : ''}
                    </span>
                  </>
                ) : (
                  <>
                    <XCircle className="w-4 h-4 text-rose-400 shrink-0" />
                    <span className="text-rose-300">
                      Jawaban Kurang Tepat (0 Poin · {result.hp_delta} HP)
                    </span>
                  </>
                )}
              </div>
              {result.challenge_completed && <Sparkles className="w-4 h-4 text-amber-300 shrink-0" />}
            </div>

            <p className="text-xs sm:text-sm text-slate-200 leading-relaxed">
              {result.explanation}
            </p>

            {result.fragment_awarded && (
              <div className="mt-3 p-3 bg-amber-500/15 border border-amber-400/60 flex items-center justify-between gap-3">
                <div className="flex items-center gap-2 text-xs sm:text-sm text-amber-100">
                  <KeyRound className="w-4 h-4 text-amber-300 shrink-0" />
                  <span>Fragmen Kode Large Treasure Diperoleh:</span>
                </div>
                <span className="font-mono-num text-base font-bold tracking-widest text-amber-300 bg-slate-950/80 px-3 py-1 border border-amber-400/50">
                  {result.fragment_awarded.code}
                </span>
              </div>
            )}

            {result.unlocked_gate_id && (
              <div className="mt-3 p-2.5 bg-sky-500/15 border border-sky-400/50 text-xs sm:text-sm text-sky-200">
                Gerbang batu telah terbuka! Jalan menuju area berikutnya kini dapat dilalui.
              </div>
            )}

            <div className="mt-4 flex flex-wrap justify-end gap-2.5">
              {needsRetry && (
                <>
                  <button
                    type="button"
                    disabled={isSubmitting}
                    onClick={() => {
                      soundSystem.playClick();
                      onRetryWrongQuestion();
                    }}
                    className="pixel-btn inline-flex items-center gap-2 px-4 py-2.5 bg-amber-500 hover:bg-amber-400 disabled:opacity-60 text-slate-950 font-bold text-sm cursor-pointer"
                  >
                    <RefreshCw className="w-4 h-4" />
                    {isSubmitting ? 'Memuat Soal...' : 'Coba Soal Pengganti'}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      soundSystem.playClick();
                      onClose();
                    }}
                    className="pixel-btn px-4 py-2.5 bg-slate-800 hover:bg-slate-700 border border-slate-600 text-slate-200 font-medium text-sm cursor-pointer"
                  >
                    Tutup
                  </button>
                </>
              )}

              {canAdvanceNext && (
                <button
                  type="button"
                  onClick={() => {
                    soundSystem.playClick();
                    onNextQuestion();
                  }}
                  className="pixel-btn px-5 py-2.5 bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-sm cursor-pointer"
                >
                  Pertanyaan Berikutnya ({solvedCount}/{challenge.totalRequired})
                </button>
              )}

              {isSeriesDone && (
                <button
                  type="button"
                  onClick={() => {
                    soundSystem.playClick();
                    onClose();
                  }}
                  className="pixel-btn px-5 py-2.5 bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-sm cursor-pointer"
                >
                  Selesai & Lanjut Menjelajah
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
