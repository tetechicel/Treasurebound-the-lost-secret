import { Crown, Home, RotateCcw, Trophy } from 'lucide-react';
import { MatchPlayerState, MatchRecord } from '../types/game';
import { PixelCharacterPreview } from '../components/ui/PixelCharacterPreview';
import { soundSystem } from '../game/systems/SoundSystem';

interface ResultPageProps {
  match: MatchRecord;
  players: MatchPlayerState[];
  localPlayerId: string;
  isHost: boolean;
  isSoloPractice: boolean;
  isBusy: boolean;
  errorMessage?: string | null;
  onPlayAgain: () => void;
  onBackToMenu: () => void;
}

function formatDuration(startIso: string, endIso: string | null): string {
  const start = new Date(startIso).getTime();
  const end = endIso ? new Date(endIso).getTime() : Date.now();
  const totalSec = Math.max(0, Math.floor((end - start) / 1000));
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function calcAccuracy(correct: number, incorrect: number): string {
  const total = correct + incorrect;
  if (total === 0) return '0%';
  return `${Math.round((correct / total) * 100)}%`;
}

export function ResultPage({
  match,
  players,
  localPlayerId,
  isHost,
  isSoloPractice,
  isBusy,
  errorMessage,
  onPlayAgain,
  onBackToMenu,
}: ResultPageProps) {
  const winner = players.find((p) => p.player_id === match.winner_player_id) ?? players[0];

  // Leaderboard sorted by highest score descending (winner breaks ties)
  const sorted = [...players].sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    if (a.player_id === match.winner_player_id) return -1;
    if (b.player_id === match.winner_player_id) return 1;
    return b.correct_answers - a.correct_answers;
  });

  return (
    <div className="screen-scroll-shell bg-[#0b1218] text-[#f5efe0] safe-inset-padded">
      <div className="pixel-panel-gold w-full max-w-5xl my-auto mx-auto p-4 sm:p-6 lg:p-8 space-y-6">
        {/* Winner Showcase */}
        <div className="flex flex-col sm:flex-row items-center justify-between gap-5 border-b border-amber-500/25 pb-5">
          <div className="flex items-center gap-4">
            <div className="p-3 bg-amber-500/15 border border-amber-400/50">
              <PixelCharacterPreview characterId={winner?.character_id ?? 'kai'} size={72} />
            </div>
            <div>
              <div className="inline-flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-amber-300">
                <Trophy className="w-4 h-4" />
                PEMENANG EKSPEDISI · JENJANG {match.difficulty}
              </div>
              <h1 className="font-display text-2xl sm:text-3xl font-bold text-white mt-0.5">
                {winner?.username ?? 'Penjelajah Juara'}
              </h1>
              <div className="text-xs text-slate-300 mt-1">
                Berhasil mengklaim Secret Treasure ({winner?.score ?? 0} Poin) · Durasi{' '}
                <span className="font-mono-num text-amber-300">
                  {formatDuration(match.started_at, match.finished_at)}
                </span>{' '}
                · Seed <span className="font-mono-num text-slate-400">{match.seed}</span>
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3 shrink-0">
            {(isHost || isSoloPractice) && (
              <button
                type="button"
                disabled={isBusy}
                onClick={() => {
                  soundSystem.playClick();
                  onPlayAgain();
                }}
                className="pixel-btn inline-flex items-center justify-center gap-2 min-h-[44px] px-5 py-2.5 bg-amber-500 hover:bg-amber-400 disabled:opacity-50 text-slate-950 font-bold text-sm cursor-pointer whitespace-nowrap"
              >
                <RotateCcw className="w-4 h-4" />
                {isBusy ? 'Menyiapkan Pulau Baru...' : 'Main Lagi'}
              </button>
            )}

            <button
              type="button"
              onClick={() => {
                soundSystem.playClick();
                onBackToMenu();
              }}
              className="pixel-btn inline-flex items-center justify-center gap-2 min-h-[44px] px-4 py-2.5 bg-slate-800 hover:bg-slate-700 border border-slate-600 text-slate-100 font-medium text-sm cursor-pointer whitespace-nowrap"
            >
              <Home className="w-4 h-4" />
              Menu Utama
            </button>
          </div>
        </div>

        {errorMessage && (
          <div className="p-3 bg-red-950/70 border border-red-500/60 text-xs sm:text-sm text-red-200">
            {errorMessage}
          </div>
        )}

        {/* Full Ranked Leaderboard */}
        <div>
          <div className="text-xs font-bold uppercase tracking-wider text-amber-300 mb-3">
            Papan Peringkat Akhir ({sorted.length} Penjelajah · Diurutkan dari Skor Tertinggi)
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-sm">
              <thead>
                <tr className="border-b border-slate-700 text-xs uppercase tracking-wider text-slate-400">
                  <th className="py-2.5 px-3">Peringkat</th>
                  <th className="py-2.5 px-3">Penjelajah</th>
                  <th className="py-2.5 px-3 text-right">Skor</th>
                  <th className="py-2.5 px-3 text-right">Akurasi Kuis</th>
                  <th className="py-2.5 px-3 text-right">Tantangan</th>
                  <th className="py-2.5 px-3 text-right">Benar / Salah</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800">
                {sorted.map((p, rankIdx) => {
                  const isWinner = p.player_id === match.winner_player_id;
                  const isMe = p.player_id === localPlayerId;
                  const completedCount =
                    (p.completed_small_chests?.length ?? 0) +
                    (p.completed_challenges?.length ?? 0) +
                    (p.large_treasure_completed ? 1 : 0);

                  return (
                    <tr key={p.player_id} className={isMe ? 'bg-amber-500/10' : ''}>
                      <td className="py-3 px-3 font-mono-num font-bold text-amber-300">
                        #{rankIdx + 1}
                      </td>
                      <td className="py-3 px-3">
                        <div className="flex items-center gap-2.5">
                          <PixelCharacterPreview characterId={p.character_id ?? 'kai'} size={34} />
                          <div>
                            <div className="font-semibold text-white flex items-center gap-1.5">
                              {p.username ?? 'Penjelajah'}
                              {isWinner && (
                                <Crown
                                  className="w-3.5 h-3.5 text-amber-400"
                                  aria-label="Pengklaim Secret Treasure"
                                />
                              )}
                            </div>
                            <div className="text-[11px] text-slate-400">
                              {isWinner ? 'Pengklaim Secret Treasure · ' : ''}
                              {isMe ? 'Anda' : 'Rekan / Lawan'}
                            </div>
                          </div>
                        </div>
                      </td>
                      <td className="py-3 px-3 text-right font-mono-num text-amber-300 font-bold text-base">
                        {p.score}
                      </td>
                      <td className="py-3 px-3 text-right font-mono-num text-sky-300 font-semibold">
                        {calcAccuracy(p.correct_answers, p.incorrect_answers)}
                      </td>
                      <td className="py-3 px-3 text-right font-mono-num text-slate-200">
                        {completedCount}
                      </td>
                      <td className="py-3 px-3 text-right font-mono-num">
                        <span className="text-emerald-400 font-semibold">{p.correct_answers}</span>
                        <span className="text-slate-500"> / </span>
                        <span className="text-rose-400 font-semibold">{p.incorrect_answers}</span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        {!isHost && !isSoloPractice && (
          <div className="text-xs text-slate-400 text-center">
            Menunggu Host room untuk memulai pertandingan baru dengan pulau acak berikutnya...
          </div>
        )}
      </div>
    </div>
  );
}
