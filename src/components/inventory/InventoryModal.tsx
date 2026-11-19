import { Apple, CheckCircle2, Circle, Compass, Key, Lock, Trophy, X } from 'lucide-react';
import { BIOME_LABELS, BiomeId, COMBAT_CONFIG, DISCOVERABLE_ZONES } from '../../game/maps/MapConfig';
import { soundSystem } from '../../game/systems/SoundSystem';
import { MapConfiguration, MatchPlayerState } from '../../types/game';

interface InventoryModalProps {
  localState: MatchPlayerState;
  allPlayers: MatchPlayerState[];
  mapConfig: MapConfiguration;
  discoveredBiomes: BiomeId[];
  onUseApple: () => void;
  onClose: () => void;
}

export function InventoryModal({
  localState,
  allPlayers,
  mapConfig,
  discoveredBiomes,
  onUseApple,
  onClose,
}: InventoryModalProps) {
  const canUseApple =
    !localState.is_dead &&
    localState.apples > 0 &&
    localState.health < COMBAT_CONFIG.MAX_HEALTH;

  const sortedStandings = [...allPlayers].sort((a, b) => b.score - a.score);
  const totalSmall = mapConfig.smallChests.length;
  const doneSmall = localState.completed_small_chests.length;

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/75 p-4">
      <div className="pixel-panel w-full max-w-3xl max-h-[88dvh] overflow-y-auto p-6 text-[#f5efe0] space-y-6">
        <div className="flex items-center justify-between border-b border-slate-700 pb-3">
          <h2 className="font-display text-xl font-bold text-amber-300">
            Jurnal Petualangan & Tas Penjelajah
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="pixel-btn p-2 bg-slate-800 hover:bg-slate-700 border border-slate-600 text-slate-200 cursor-pointer"
            aria-label="Tutup"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Top Supplies & Key Items */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3.5">
          <div className="bg-slate-900/80 border border-slate-700 p-3.5 flex items-center justify-between gap-2">
            <div className="flex items-center gap-2.5">
              <div className="p-2 bg-rose-950/70 border border-rose-500/40 text-rose-400">
                <Apple className="w-4 h-4" />
              </div>
              <div>
                <div className="text-xs font-semibold">
                  Apel ({localState.apples}/{COMBAT_CONFIG.MAX_APPLES})
                </div>
                <div className="text-[11px] text-slate-400">+{COMBAT_CONFIG.APPLE_HEAL} HP</div>
              </div>
            </div>
            <button
              type="button"
              disabled={!canUseApple}
              onClick={() => {
                soundSystem.playClick();
                onUseApple();
              }}
              className="pixel-btn px-2.5 py-1.5 bg-emerald-500 hover:bg-emerald-400 disabled:opacity-40 text-slate-950 font-bold text-xs cursor-pointer"
            >
              Pakai
            </button>
          </div>

          <div className="bg-slate-900/80 border border-slate-700 p-3.5 flex items-center gap-2.5">
            <div className="p-2 bg-amber-950/70 border border-amber-500/40 text-amber-300">
              <Trophy className="w-4 h-4" />
            </div>
            <div>
              <div className="text-sm font-bold font-mono-num text-amber-300">
                {localState.score} Poin
              </div>
              <div className="text-[11px] text-slate-400">
                {localState.correct_answers} Benar · {localState.incorrect_answers} Salah
              </div>
            </div>
          </div>

          <div className="bg-slate-900/80 border border-slate-700 p-3.5 flex items-center gap-2.5">
            <div
              className={`p-2 border ${
                localState.has_secret_key
                  ? 'bg-amber-500/20 border-amber-400 text-amber-300'
                  : 'bg-slate-950 border-slate-700 text-slate-500'
              }`}
            >
              <Key className="w-4 h-4" />
            </div>
            <div>
              <div className="text-xs font-semibold">Kunci Emas Hutan</div>
              <div className="text-[11px] text-slate-400">
                {localState.has_secret_key ? 'Tersimpan di Tas' : 'Belum ditemukan'}
              </div>
            </div>
          </div>
        </div>

        {/* 4-Stage Treasure Progression Tracker */}
        <div className="bg-slate-950/60 border border-slate-800 p-4 space-y-3">
          <div className="text-xs font-bold uppercase tracking-wider text-amber-300 flex items-center gap-2">
            <Compass className="w-4 h-4" />
            Progres Misi 4 Tahap
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 text-xs">
            <div className="p-3 bg-slate-900/80 border border-slate-700 flex items-center justify-between">
              <span>Stage 1: Peti Kecil ({doneSmall}/{totalSmall})</span>
              {doneSmall >= totalSmall ? (
                <CheckCircle2 className="w-4 h-4 text-emerald-400" />
              ) : (
                <span className="font-mono-num text-amber-300">{doneSmall}/{totalSmall}</span>
              )}
            </div>
            <div className="p-3 bg-slate-900/80 border border-slate-700 flex items-center justify-between">
              <span>Stage 2: Segel Large Treasure</span>
              {localState.large_treasure_unlocked ? (
                <CheckCircle2 className="w-4 h-4 text-emerald-400" />
              ) : (
                <Lock className="w-4 h-4 text-slate-500" />
              )}
            </div>
            <div className="p-3 bg-slate-900/80 border border-slate-700 flex items-center justify-between">
              <span>Stage 3: Ujian Large Treasure</span>
              {localState.large_treasure_completed ? (
                <CheckCircle2 className="w-4 h-4 text-emerald-400" />
              ) : (
                <Circle className="w-4 h-4 text-slate-500" />
              )}
            </div>
            <div className="p-3 bg-slate-900/80 border border-slate-700 flex items-center justify-between">
              <span>Stage 4: Klaim Secret Treasure</span>
              <span className="text-slate-400">
                {localState.large_treasure_completed ? 'Siap Diklaim!' : 'Terkunci'}
              </span>
            </div>
          </div>
        </div>

        {/* Small Chests & Collected Code Fragments */}
        <div>
          <div className="text-xs font-bold uppercase tracking-wider text-amber-300 mb-2">
            Fragmen Kode Small Chest ({localState.collected_fragments.length}/{totalSmall})
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {mapConfig.smallChests.map((chest) => {
              const frag = localState.collected_fragments.find((f) => f.chestId === chest.id);
              return (
                <div
                  key={chest.id}
                  className={`p-3 border flex items-center justify-between gap-2 text-xs ${
                    frag
                      ? 'bg-emerald-950/30 border-emerald-500/40'
                      : 'bg-slate-950/50 border-slate-800 text-slate-400'
                  }`}
                >
                  <div>
                    <div className="font-semibold text-slate-100">{chest.name}</div>
                    <div className="text-[11px] text-slate-400">{chest.zone}</div>
                  </div>
                  <span className="font-mono-num font-bold text-amber-300 bg-slate-950 px-2.5 py-1 border border-slate-700">
                    {frag ? frag.code : '????'}
                  </span>
                </div>
              );
            })}
          </div>
        </div>

        {/* Discovered Map Zones (6 Zones) */}
        <div>
          <div className="text-xs font-bold uppercase tracking-wider text-sky-300 mb-2">
            Zona Pulau Terjelajahi ({discoveredBiomes.length}/{DISCOVERABLE_ZONES.length})
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-xs">
            {DISCOVERABLE_ZONES.map((z) => {
              const found = discoveredBiomes.includes(z);
              return (
                <div
                  key={z}
                  className={`p-2.5 border flex items-center gap-2 ${
                    found
                      ? 'bg-sky-950/40 border-sky-500/40 text-sky-100'
                      : 'bg-slate-950/50 border-slate-800 text-slate-500'
                  }`}
                >
                  {found ? (
                    <CheckCircle2 className="w-3.5 h-3.5 text-sky-400 shrink-0" />
                  ) : (
                    <Circle className="w-3.5 h-3.5 text-slate-600 shrink-0" />
                  )}
                  <span className="truncate">{BIOME_LABELS[z]}</span>
                </div>
              );
            })}
          </div>
        </div>

        {/* Live Match Standings */}
        <div>
          <div className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-2">
            Klasemen Sementara ({sortedStandings.length} Penjelajah)
          </div>
          <div className="divide-y divide-slate-800 border border-slate-800 bg-slate-950/50 text-xs sm:text-sm">
            {sortedStandings.map((p, rank) => (
              <div key={p.player_id} className="px-3.5 py-2 flex items-center justify-between gap-3">
                <span className="font-medium text-slate-100 truncate">
                  #{rank + 1} {p.username ?? 'Penjelajah'}
                  {p.player_id === localState.player_id ? ' (Anda)' : ''}
                </span>
                <span className="font-mono-num text-slate-300 shrink-0">
                  {p.score} Poin · {p.completed_small_chests.length}/{totalSmall} Peti · HP {p.health}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
