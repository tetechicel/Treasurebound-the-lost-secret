import { useEffect, useRef } from 'react';
import {
  Apple,
  Backpack,
  Compass,
  Key,
  Pause,
  Trophy,
  Volume2,
  VolumeX,
} from 'lucide-react';
import {
  BIOME_LABELS,
  BiomeId,
  CHUNK_GRID_COLS,
  CHUNK_GRID_ROWS,
  ChunkCoord,
  COMBAT_CONFIG,
  WORLD_PIXEL_H,
  WORLD_PIXEL_W,
  WORLD_TILES_H,
  WORLD_TILES_W,
  ZONE_BOUNDS,
} from '../../game/maps/MapConfig';
import { MinimapSnapshot } from '../../game/GameBridge';
import { EducationLevel, GameSettings, MapConfiguration, MatchPlayerState } from '../../types/game';

import { FullscreenButton } from '../ui/FullscreenButton';

interface InGameHudProps {
  username: string;
  difficulty: EducationLevel;
  localState: MatchPlayerState;
  biome: BiomeId;
  chunkCoord: ChunkCoord;
  discoveredBiomes: BiomeId[];
  minimap: MinimapSnapshot;
  mapConfig: MapConfiguration;
  settings: GameSettings;
  respawnSecondsLeft: number;
  npcDialogue: { name: string; role: string; dialogue: string } | null;
  toastMessage: string | null;
  proximityHint: { label: string; kind: string } | null;
  isTouchUi: boolean;
  isFullscreen: boolean;
  isStandalone: boolean;
  onToggleFullscreen: (lockLandscape?: boolean) => void;
  onUseApple: () => void;
  onOpenInventory: () => void;
  onTogglePause: () => void;
  onToggleMute: () => void;
  onDismissNpc: () => void;
}

export function InGameHud({
  username,
  difficulty,
  localState,
  biome,
  chunkCoord,
  discoveredBiomes,
  minimap,
  mapConfig,
  settings,
  respawnSecondsLeft,
  npcDialogue,
  toastMessage,
  proximityHint,
  isTouchUi,
  isFullscreen,
  isStandalone,
  onToggleFullscreen,
  onUseApple,
  onOpenInventory,
  onTogglePause,
  onToggleMute,
  onDismissNpc,
}: InGameHudProps) {
  const miniCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const totalSmall = mapConfig.smallChests.length;
  const doneSmall = localState.completed_small_chests.length;

  // Draw crisp 6-zone minimap canvas over 5x5 chunk grid
  useEffect(() => {
    const canvas = miniCanvasRef.current;
    if (!canvas || !settings.showMinimap) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const w = 144;
    const h = 108;
    ctx.clearRect(0, 0, w, h);

    // Ocean base
    ctx.fillStyle = '#0d4a5e';
    ctx.fillRect(0, 0, w, h);

    // 6 Zones dynamically scaled from ZONE_BOUNDS (200x150 / 5x5 chunks)
    for (const z of Object.values(ZONE_BOUNDS)) {
      const zx = (z.minX / WORLD_TILES_W) * w;
      const zy = (z.minY / WORLD_TILES_H) * h;
      const zw = ((z.maxX - z.minX + 1) / WORLD_TILES_W) * w;
      const zh = ((z.maxY - z.minY + 1) / WORLD_TILES_H) * h;
      ctx.fillStyle = z.minimapColor;
      ctx.globalAlpha = discoveredBiomes.includes(z.id) ? 1 : 0.45;
      ctx.fillRect(zx, zy, zw, zh);
      ctx.globalAlpha = 1;
    }

    // Subtle 5x5 chunk grid overlay
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.12)';
    ctx.lineWidth = 0.75;
    for (let cx = 1; cx < CHUNK_GRID_COLS; cx++) {
      const gx = Math.round((cx / CHUNK_GRID_COLS) * w) + 0.5;
      ctx.beginPath();
      ctx.moveTo(gx, 0);
      ctx.lineTo(gx, h);
      ctx.stroke();
    }
    for (let cy = 1; cy < CHUNK_GRID_ROWS; cy++) {
      const gy = Math.round((cy / CHUNK_GRID_ROWS) * h) + 0.5;
      ctx.beginPath();
      ctx.moveTo(0, gy);
      ctx.lineTo(w, gy);
      ctx.stroke();
    }

    // Uncompleted Small Chest markers
    for (const sc of mapConfig.smallChests) {
      if (localState.completed_small_chests.includes(sc.id)) continue;
      const cx = ((sc.tileX * mapConfig.tileSize) / WORLD_PIXEL_W) * w;
      const cy = ((sc.tileY * mapConfig.tileSize) / WORLD_PIXEL_H) * h;
      ctx.fillStyle = '#38bdf8';
      ctx.fillRect(cx - 2, cy - 2, 4, 4);
    }

    // Large Treasure marker
    if (!localState.large_treasure_completed) {
      const ltx = ((mapConfig.largeTreasure.tileX * mapConfig.tileSize) / WORLD_PIXEL_W) * w;
      const lty = ((mapConfig.largeTreasure.tileY * mapConfig.tileSize) / WORLD_PIXEL_H) * h;
      ctx.fillStyle = localState.large_treasure_unlocked ? '#c084fc' : '#a855f7';
      ctx.fillRect(ltx - 2.5, lty - 2.5, 5, 5);
    }

    // Secret Treasure pin once Large Treasure is completed
    if (localState.large_treasure_completed) {
      const tx = ((mapConfig.secretTreasure.tileX * mapConfig.tileSize) / WORLD_PIXEL_W) * w;
      const ty = ((mapConfig.secretTreasure.tileY * mapConfig.tileSize) / WORLD_PIXEL_H) * h;
      ctx.fillStyle = '#fbbf24';
      ctx.fillRect(tx - 3, ty - 3, 6, 6);
    }

    // Remote explorers
    minimap.others.forEach((o) => {
      const ox = (o.x / WORLD_PIXEL_W) * w;
      const oy = (o.y / WORLD_PIXEL_H) * h;
      ctx.fillStyle = '#ef4444';
      ctx.fillRect(ox - 2, oy - 2, 4, 4);
    });

    // Local explorer
    const px = (minimap.playerX / WORLD_PIXEL_W) * w;
    const py = (minimap.playerY / WORLD_PIXEL_H) * h;
    ctx.fillStyle = '#fef08a';
    ctx.fillRect(px - 2.5, py - 2.5, 5, 5);
  }, [minimap, mapConfig, settings.showMinimap, discoveredBiomes, localState]);

  const canUseApple =
    !localState.is_dead &&
    localState.apples > 0 &&
    localState.health < COMBAT_CONFIG.MAX_HEALTH;

  const hpPct = Math.max(0, Math.min(100, localState.health));

  const objectiveLabel = localState.large_treasure_completed
    ? 'Tahap 4: Masuk Gerbang Kuil Dalam & klaim Secret Treasure (+100 Poin)!'
    : localState.large_treasure_unlocked
      ? 'Tahap 3: Selesaikan Ujian 3 Soal di Large Treasure (Kuil Timur Laut)!'
      : doneSmall >= totalSmall
        ? 'Tahap 2: Pergi ke Pelataran Kuil Timur Laut & masukkan 5 Fragmen Kode Large Treasure!'
        : `Tahap 1: Selesaikan Peti Kecil di seluruh pulau (${doneSmall}/${totalSmall})`;

  return (
    <div className="pointer-events-none fixed inset-0 z-20 flex flex-col justify-between safe-inset-padded">
      {/* TOP PERIMETER BAR */}
      <div className="flex items-start justify-between gap-2 sm:gap-3">
        {/* Top-Left: Explorer Status Cluster */}
        <div className="pointer-events-auto pixel-panel px-2.5 py-2 sm:px-3.5 sm:py-2.5 flex flex-col gap-1.5 sm:gap-2 min-w-[175px] sm:min-w-[255px] max-w-[58vw] sm:max-w-none">
          <div className="flex items-center justify-between gap-2 sm:gap-3">
            <span className="font-semibold text-xs sm:text-sm text-amber-200 truncate max-w-[100px] sm:max-w-[130px]">
              {username}
            </span>
            <span className="text-[11px] text-slate-300 whitespace-nowrap">
              {BIOME_LABELS[biome]} ({chunkCoord.chunkX + 1},{chunkCoord.chunkY + 1}) ·{' '}
              <span className="text-amber-300 font-bold">{difficulty}</span>
            </span>
          </div>

          {/* HP & Score */}
          <div className="space-y-1">
            <div className="flex items-center justify-between text-[11px] font-mono-num">
              <span className={hpPct <= 30 ? 'text-rose-400 font-bold' : 'text-emerald-300'}>
                HP {localState.health}/{COMBAT_CONFIG.MAX_HEALTH}
              </span>
              <span className="text-amber-300 inline-flex items-center gap-1 font-bold">
                <Trophy className="w-3 h-3" />
                {localState.score} Poin
              </span>
            </div>
            <div className="w-full h-2 bg-slate-950 border border-slate-700 overflow-hidden">
              <div
                className={`h-full transition-all duration-150 ${
                  hpPct <= 30 ? 'bg-rose-500' : 'bg-emerald-500'
                }`}
                style={{ width: `${hpPct}%` }}
              />
            </div>
          </div>

          {/* Quick Inventory & Progress Strip */}
          <div className="flex items-center justify-between gap-1.5 pt-0.5">
            <button
              type="button"
              disabled={!canUseApple}
              onClick={onUseApple}
              title="Pakai Apel (+25 HP) [Tombol: 1]"
              className="pixel-btn inline-flex items-center gap-1 min-h-[34px] px-2 py-1 bg-slate-900 hover:bg-slate-800 disabled:opacity-45 border border-slate-600 text-xs font-mono-num text-rose-300 cursor-pointer disabled:cursor-default whitespace-nowrap"
            >
              <Apple className="w-3.5 h-3.5" />
              <span>
                {localState.apples}/{COMBAT_CONFIG.MAX_APPLES}
              </span>
            </button>

            {localState.has_secret_key && (
              <div
                className="px-2 py-1 bg-amber-500/15 border border-amber-400/60 text-amber-300 inline-flex items-center gap-1 text-[11px]"
                title="Kunci Emas Hutan Utara"
              >
                <Key className="w-3 h-3" />
                <span>Kunci</span>
              </div>
            )}

            <button
              type="button"
              onClick={onOpenInventory}
              className="pixel-btn inline-flex items-center gap-1.5 min-h-[34px] px-2.5 py-1 bg-slate-900 hover:bg-slate-800 border border-slate-600 text-xs text-amber-200 cursor-pointer whitespace-nowrap"
            >
              <Compass className="w-3.5 h-3.5 text-amber-400" />
              <span className="font-mono-num">
                {doneSmall}/{totalSmall} Peti
              </span>
            </button>
          </div>
        </div>

        {/* Top-Right: Minimap & Horizontal Utility Buttons */}
        <div className="pointer-events-auto flex items-start gap-2">
          {settings.showMinimap && !isTouchUi && (
            <div className="pixel-panel p-1.5 hidden sm:block">
              <canvas
                ref={miniCanvasRef}
                width={144}
                height={108}
                className="block border border-slate-700"
              />
            </div>
          )}

          <div className="flex flex-row items-center gap-1.5">
            <button
              type="button"
              onClick={onOpenInventory}
              className="pixel-btn min-w-[44px] min-h-[44px] flex items-center justify-center p-2 bg-slate-900/95 hover:bg-slate-800 border border-slate-600 text-amber-200 cursor-pointer"
              aria-label="Buka Jurnal"
              title="Jurnal & Tas [I]"
            >
              <Backpack className="w-4 h-4" />
            </button>

            <button
              type="button"
              onClick={onToggleMute}
              className="pixel-btn min-w-[44px] min-h-[44px] flex items-center justify-center p-2 bg-slate-900/95 hover:bg-slate-800 border border-slate-600 text-slate-200 cursor-pointer"
              aria-label={settings.muted ? 'Nyalakan Audio' : 'Bisukan Audio'}
            >
              {settings.muted ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
            </button>

            <FullscreenButton
              isFullscreen={isFullscreen}
              isStandalone={isStandalone}
              lockLandscape={true}
              compact={true}
              onToggle={onToggleFullscreen}
            />

            <button
              type="button"
              onClick={onTogglePause}
              className="pixel-btn min-w-[44px] min-h-[44px] flex items-center justify-center p-2 bg-slate-900/95 hover:bg-slate-800 border border-slate-600 text-slate-200 cursor-pointer"
              aria-label="Jeda Game"
              title="Jeda [Esc]"
            >
              <Pause className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>

      {/* CENTER RESPAWN BANNER */}
      {localState.is_dead && (
        <div className="self-center pixel-panel-gold px-6 py-4 text-center">
          <div className="font-display text-lg font-bold text-rose-300">Tumbang dalam Pertarungan</div>
          <div className="text-xs sm:text-sm text-slate-200 mt-1 font-mono-num">
            Bangkit kembali dalam {respawnSecondsLeft}d...
          </div>
        </div>
      )}

      {/* BOTTOM DIALOGUE / OBJECTIVE STRIP */}
      <div className="flex flex-col items-center gap-2 mb-1 sm:mb-0">
        {npcDialogue && (
          <div className="pointer-events-auto pixel-panel-gold w-full max-w-lg p-4 text-sm">
            <div className="flex items-center justify-between gap-2 mb-1">
              <span className="font-bold text-amber-300">
                {npcDialogue.name} ·{' '}
                <span className="font-normal text-slate-400">{npcDialogue.role}</span>
              </span>
              <button
                type="button"
                onClick={onDismissNpc}
                className="text-xs text-amber-200 underline cursor-pointer"
              >
                Tutup
              </button>
            </div>
            <p className="text-xs sm:text-sm text-slate-100 leading-relaxed">
              {npcDialogue.dialogue}
            </p>
          </div>
        )}

        {toastMessage && (
          <div className="pixel-panel px-4 py-2 text-xs sm:text-sm font-medium text-amber-200 text-center">
            {toastMessage}
          </div>
        )}

        {!isTouchUi && (
          <div className="bg-slate-950/85 border border-slate-800 px-3.5 py-1.5 text-[11px] text-slate-200">
            {proximityHint ? `Tekan [F] — ${proximityHint.label}` : objectiveLabel}
          </div>
        )}
      </div>
    </div>
  );
}
