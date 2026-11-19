import { useState } from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  Check,
  Copy,
  Crown,
  GraduationCap,
  Lock,
  LogOut,
  Play,
  Plus,
  RefreshCw,
  Users,
  X,
} from 'lucide-react';
import {
  EDUCATION_LEVELS,
  EducationLevel,
  PlayerProfile,
  RoomPlayerRecord,
  RoomRecord,
} from '../types/game';
import { PixelCharacterPreview } from '../components/ui/PixelCharacterPreview';
import { FullscreenButton } from '../components/ui/FullscreenButton';
import { scrollInputIntoView } from '../hooks/useVisualViewport';
import { SupabaseConfigReason } from '../services/supabase';
import { soundSystem } from '../game/systems/SoundSystem';

interface LobbyProps {
  localPlayer: PlayerProfile;
  room: RoomRecord | null;
  roomPlayers: RoomPlayerRecord[];
  onlinePlayerIds: string[];
  hasPresenceSynced: boolean;
  realtimeState?: 'connected' | 'reconnecting' | 'disconnected';
  countdownSeconds: number | null;
  isBusy: boolean;
  isSupabaseConfigured: boolean;
  isCheckingSupabase: boolean;
  supabaseConfigReason?: SupabaseConfigReason;
  onRetrySupabaseCheck: () => void;
  errorMessage: string | null;
  isFullscreen: boolean;
  isStandalone: boolean;
  fullscreenNotice: string | null;
  onDismissFullscreenNotice: () => void;
  onToggleFullscreen: (lockLandscape?: boolean) => void;
  onBackToSetup: () => void;
  onCreateRoom: (difficulty: EducationLevel) => void;
  onChangeDifficulty: (difficulty: EducationLevel) => void;
  onJoinRoom: (roomCode: string) => void;
  onLeaveRoom: () => void;
  onStartGame: () => void;
}

export function Lobby({
  localPlayer,
  room,
  roomPlayers,
  onlinePlayerIds,
  hasPresenceSynced,
  realtimeState = 'connected',
  countdownSeconds,
  isBusy,
  isSupabaseConfigured,
  isCheckingSupabase,
  supabaseConfigReason,
  onRetrySupabaseCheck,
  errorMessage,
  isFullscreen,
  isStandalone,
  fullscreenNotice,
  onDismissFullscreenNotice,
  onToggleFullscreen,
  onBackToSetup,
  onCreateRoom,
  onChangeDifficulty,
  onJoinRoom,
  onLeaveRoom,
  onStartGame,
}: LobbyProps) {
  const [selectedDifficulty, setSelectedDifficulty] = useState<EducationLevel>('SMA');
  const [roomCodeInput, setRoomCodeInput] = useState('');
  const [copied, setCopied] = useState(false);

  const isHost = room?.host_player_id === localPlayer.id;
  const connectedPlayers = roomPlayers.filter((rp) => rp.is_connected);
  const connectedCount = connectedPlayers.length;
  const isRoomFull = Boolean(room && connectedCount >= room.max_players);
  const canStart = isHost && connectedCount >= 2 && !isBusy && countdownSeconds === null;

  const activeLevelInfo =
    EDUCATION_LEVELS.find((lvl) => lvl.id === (room?.difficulty ?? selectedDifficulty)) ??
    EDUCATION_LEVELS[2];

  const handleCopyCode = async () => {
    if (!room) return;
    try {
      await navigator.clipboard.writeText(room.room_code);
      setCopied(true);
      soundSystem.playClick();
      setTimeout(() => setCopied(false), 1800);
    } catch {
      // Clipboard fallback not needed
    }
  };

  return (
    <div className="screen-scroll-shell bg-[#0c141d] text-[#f5efe0] safe-inset-padded">
      <div className="pixel-panel w-full max-w-4xl my-auto mx-auto p-4 sm:p-6 lg:p-8 relative">
        {/* Synchronized 3-2-1 Countdown Overlay */}
        {countdownSeconds !== null && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4">
            <div className="pixel-panel-gold px-10 py-8 text-center space-y-3 max-w-sm w-full">
              <div className="text-xs uppercase tracking-widest text-amber-300 font-bold">
                Ekspedisi Dimulai · Jenjang {room?.difficulty ?? 'SMA'}
              </div>
              <div className="font-mono-num text-6xl font-bold text-white">
                {countdownSeconds}
              </div>
              <p className="text-xs text-slate-300">
                Menyiapkan pulau 6 zona dan soal teracak untuk seluruh penjelajah...
              </p>
            </div>
          </div>
        )}

        {/* Header */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-700/80 pb-3 sm:pb-4 mb-4 sm:mb-6">
          <div className="flex items-center gap-3 min-w-0">
            <PixelCharacterPreview characterId={localPlayer.character_id} size={44} />
            <div className="min-w-0">
              <h1 className="font-display text-lg sm:text-2xl font-bold text-amber-300 truncate">
                {room ? 'Lobi Ekspedisi Multiplayer' : 'Room Multiplayer (Maks. 10 Pemain)'}
              </h1>
              <div className="text-xs text-slate-400 truncate">
                Bermain sebagai{' '}
                <span className="text-slate-200 font-semibold">{localPlayer.username}</span>
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <FullscreenButton
              isFullscreen={isFullscreen}
              isStandalone={isStandalone}
              lockLandscape={true}
              onToggle={onToggleFullscreen}
            />

            {!room ? (
              <button
                type="button"
                onClick={() => {
                  soundSystem.playClick();
                  onBackToSetup();
                }}
                className="pixel-btn inline-flex items-center justify-center gap-2 min-h-[44px] px-3.5 py-2 bg-slate-800 hover:bg-slate-700 border border-slate-600 text-xs sm:text-sm font-medium cursor-pointer whitespace-nowrap"
              >
                <ArrowLeft className="w-4 h-4" />
                Ganti Penjelajah
              </button>
            ) : (
              <button
                type="button"
                disabled={countdownSeconds !== null}
                onClick={() => {
                  soundSystem.playClick();
                  onLeaveRoom();
                }}
                className="pixel-btn inline-flex items-center justify-center gap-2 min-h-[44px] px-3.5 py-2 bg-red-950/70 hover:bg-red-900/80 disabled:opacity-50 border border-red-700/70 text-red-200 text-xs sm:text-sm font-medium cursor-pointer whitespace-nowrap"
              >
                <LogOut className="w-4 h-4" />
                Keluar Room
              </button>
            )}
          </div>
        </div>

        {fullscreenNotice && (
          <div className="mb-4 p-3 bg-slate-900/90 border border-amber-500/40 text-xs text-amber-200 flex items-center justify-between gap-3">
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

        {/* Supabase Setup Notice when runtime secrets are missing or invalid */}
        {!isSupabaseConfigured && (
          <div className="mb-5 p-4 bg-amber-950/40 border border-amber-500/50 text-xs sm:text-sm text-amber-100 space-y-2.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="font-bold text-amber-300">
                {isCheckingSupabase
                  ? 'Memeriksa Koneksi Supabase...'
                  : supabaseConfigReason === 'invalid_key_type'
                    ? 'Kunci Rahasia Terdeteksi — Gunakan Publishable Key'
                    : 'Konfigurasi Supabase Diperlukan untuk Multiplayer Live'}
              </div>
              <button
                type="button"
                disabled={isCheckingSupabase || isBusy}
                onClick={() => {
                  soundSystem.playClick();
                  onRetrySupabaseCheck();
                }}
                className="pixel-btn inline-flex items-center gap-1.5 px-3 py-1.5 bg-amber-500/20 hover:bg-amber-500/30 disabled:opacity-50 border border-amber-400/50 text-amber-200 text-xs font-semibold cursor-pointer"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${isCheckingSupabase ? 'animate-spin' : ''}`} />
                {isCheckingSupabase ? 'Memeriksa...' : 'Cek Ulang Koneksi'}
              </button>
            </div>
            {supabaseConfigReason === 'invalid_key_type' ? (
              <p className="text-slate-200 leading-relaxed">
                Nilai <code className="font-mono-num text-amber-300">SUPABASE_PUBLISHABLE_KEY</code>{' '}
                berisi kunci privat (<code className="font-mono-num">service_role</code> /{' '}
                <code className="font-mono-num">sb_secret_</code>) dan diblokir demi keamanan.
                Ganti dengan <strong>Publishable / Anon Key</strong> dari Supabase Project Settings.
              </p>
            ) : (
              <p className="text-slate-200 leading-relaxed">
                Tambahkan <code className="font-mono-num text-amber-300">SUPABASE_URL</code> dan{' '}
                <code className="font-mono-num text-amber-300">SUPABASE_PUBLISHABLE_KEY</code> di{' '}
                <strong>Google AI Studio Settings → Secrets</strong> (atau file{' '}
                <code className="font-mono-num">.env</code> lokal), lalu pastikan migrasi SQL di{' '}
                <code className="font-mono-num">supabase/migrations/</code> sudah dijalankan.
              </p>
            )}
          </div>
        )}

        {room && realtimeState === 'reconnecting' && (
          <div className="mb-4 p-3 bg-amber-950/70 border border-amber-500/50 text-xs sm:text-sm text-amber-200 flex items-center gap-2">
            <RefreshCw className="w-4 h-4 animate-spin shrink-0" />
            <span>Koneksi Realtime terganggu, mencoba menyambung kembali...</span>
          </div>
        )}

        {errorMessage && (
          <div className="mb-4 p-3 bg-red-950/70 border border-red-500/60 text-xs sm:text-sm text-red-200">
            {errorMessage}
          </div>
        )}

        {/* VIEW 1: CREATE OR JOIN ROOM */}
        {!room && (
          <div className="grid grid-cols-1 md:grid-cols-12 gap-5">
            <div className="md:col-span-7 bg-slate-900/80 border border-slate-700 p-5 flex flex-col justify-between space-y-4">
              <div className="space-y-3">
                <div>
                  <h2 className="font-display text-lg font-bold text-amber-200">Buat Room Baru</h2>
                  <p className="text-xs sm:text-sm text-slate-400 mt-1 leading-relaxed">
                    Pilih jenjang pendidikan soal untuk pertandingan, lalu undang hingga 10 penjelajah.
                  </p>
                </div>

                {/* Education Level Selection */}
                <div className="space-y-2">
                  <div className="text-xs font-bold uppercase tracking-wider text-slate-300 flex items-center gap-1.5">
                    <GraduationCap className="w-3.5 h-3.5 text-amber-300" />
                    Pilih Tingkat Pendidikan Soal
                  </div>
                  <div className="grid grid-cols-1 gap-2">
                    {EDUCATION_LEVELS.map((lvl) => {
                      const active = lvl.id === selectedDifficulty;
                      return (
                        <button
                          key={lvl.id}
                          type="button"
                          onClick={() => {
                            soundSystem.playClick();
                            setSelectedDifficulty(lvl.id);
                          }}
                          className={`pixel-btn text-left p-3 border cursor-pointer ${
                            active
                              ? 'bg-amber-500/15 border-amber-400 text-white'
                              : 'bg-slate-950/70 border-slate-700 hover:border-slate-500 text-slate-300'
                          }`}
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className="font-bold text-sm text-amber-200">{lvl.label}</span>
                            <span className="font-mono-num text-xs font-bold text-amber-300">
                              {lvl.id}
                            </span>
                          </div>
                          <p className="text-[11px] text-slate-300 mt-1 leading-snug">
                            {lvl.description}
                          </p>
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>

              <button
                type="button"
                disabled={isBusy || !isSupabaseConfigured}
                onClick={() => {
                  soundSystem.playClick();
                  onCreateRoom(selectedDifficulty);
                }}
                className="pixel-btn w-full min-h-[44px] inline-flex items-center justify-center gap-2 px-5 py-3 bg-amber-500 hover:bg-amber-400 disabled:opacity-50 text-slate-950 font-bold text-sm cursor-pointer whitespace-nowrap"
              >
                <Plus className="w-4 h-4" />
                {isBusy ? 'Membuat Room...' : `Buat Room (${selectedDifficulty})`}
              </button>
            </div>

            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (!roomCodeInput.trim() || !isSupabaseConfigured) return;
                soundSystem.playClick();
                onJoinRoom(roomCodeInput.trim().toUpperCase());
              }}
              className="md:col-span-5 bg-slate-900/80 border border-slate-700 p-4 sm:p-5 flex flex-col justify-between space-y-4"
            >
              <div>
                <h2 className="font-display text-lg font-bold text-sky-200">Gabung Room</h2>
                <p className="text-xs sm:text-sm text-slate-400 mt-1.5 leading-relaxed">
                  Masukkan 6 karakter Kode Room dari Host. Tingkat pendidikan soal akan mengikuti
                  pengaturan Host room tersebut.
                </p>
                <input
                  type="text"
                  maxLength={6}
                  enterKeyHint="go"
                  value={roomCodeInput}
                  onFocus={(e) => scrollInputIntoView(e.currentTarget)}
                  onChange={(e) => setRoomCodeInput(e.target.value.toUpperCase())}
                  placeholder="K7M4P9"
                  className="mt-4 w-full min-h-[48px] px-4 py-3 bg-slate-950 border border-slate-600 focus:border-sky-400 focus:outline-none font-mono-num text-xl tracking-[0.25em] uppercase text-center text-white"
                />
              </div>
              <button
                type="submit"
                disabled={isBusy || roomCodeInput.trim().length < 6 || !isSupabaseConfigured}
                className="pixel-btn w-full min-h-[44px] inline-flex items-center justify-center gap-2 px-5 py-3 bg-sky-500 hover:bg-sky-400 disabled:opacity-50 text-slate-950 font-bold text-sm cursor-pointer whitespace-nowrap"
              >
                <Users className="w-4 h-4" />
                {isBusy ? 'Bergabung...' : 'Gabung dengan Kode Room'}
              </button>
            </form>
          </div>
        )}

        {/* VIEW 2: WAITING LOBBY */}
        {room && (
          <div className="space-y-5">
            {/* Room Code & Slot Counter */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-slate-900/85 border border-amber-500/35 p-4">
              <div>
                <div className="text-xs uppercase tracking-wider text-slate-400">Kode Room</div>
                <div className="font-mono-num text-3xl font-bold tracking-[0.22em] text-amber-300 mt-0.5">
                  {room.room_code}
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-3">
                <span className="text-xs sm:text-sm text-slate-200 font-mono-num font-semibold">
                  {connectedCount} / {room.max_players} Penjelajah
                </span>
                {isRoomFull && (
                  <span className="inline-flex items-center gap-1 px-2.5 py-1 bg-rose-950/80 border border-rose-500/60 text-rose-200 text-xs font-bold">
                    <AlertTriangle className="w-3.5 h-3.5" />
                    Room Penuh
                  </span>
                )}
                <button
                  type="button"
                  onClick={handleCopyCode}
                  className="pixel-btn inline-flex items-center gap-2 px-4 py-2.5 bg-slate-800 hover:bg-slate-700 border border-slate-600 text-xs font-semibold text-slate-100 cursor-pointer whitespace-nowrap"
                >
                  {copied ? (
                    <>
                      <Check className="w-4 h-4 text-emerald-400" />
                      Tersalin
                    </>
                  ) : (
                    <>
                      <Copy className="w-4 h-4 text-amber-300" />
                      Salin Kode
                    </>
                  )}
                </button>
              </div>
            </div>

            {/* Active Education Difficulty Panel (Visible to All, Editable by Host before Start) */}
            <div className="bg-slate-900/80 border border-slate-700 p-4 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2 text-xs sm:text-sm font-bold text-amber-300">
                  <GraduationCap className="w-4 h-4" />
                  <span>Tingkat Pendidikan Soal: {activeLevelInfo.label}</span>
                </div>
                <span className="inline-flex items-center gap-1 text-[11px] text-slate-400">
                  {room.status !== 'WAITING' ? (
                    <>
                      <Lock className="w-3 h-3" />
                      Terkunci selama pertandingan
                    </>
                  ) : isHost ? (
                    'Host dapat mengubah sebelum mulai'
                  ) : (
                    'Dipilih oleh Host · Terkunci saat mulai'
                  )}
                </span>
              </div>

              <p className="text-xs text-slate-300 leading-relaxed">
                {activeLevelInfo.description}
              </p>

              {isHost && room.status === 'WAITING' && (
                <div className="grid grid-cols-3 gap-2 pt-1">
                  {EDUCATION_LEVELS.map((lvl) => {
                    const active = lvl.id === room.difficulty;
                    return (
                      <button
                        key={lvl.id}
                        type="button"
                        disabled={isBusy || countdownSeconds !== null}
                        onClick={() => {
                          if (!active) {
                            soundSystem.playClick();
                            onChangeDifficulty(lvl.id);
                          }
                        }}
                        className={`pixel-btn py-2 px-3 text-xs font-bold border cursor-pointer disabled:opacity-50 ${
                          active
                            ? 'bg-amber-500/20 border-amber-400 text-amber-200'
                            : 'bg-slate-950/70 border-slate-700 hover:border-slate-500 text-slate-300'
                        }`}
                      >
                        {lvl.id} · {lvl.id === 'SD' ? 'Dasar' : lvl.id === 'SMP' ? 'Menengah' : 'Atas'}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            {/* 10-Player Grid */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 max-h-[340px] overflow-y-auto pr-1">
              {Array.from({ length: room.max_players }).map((_, slotIdx) => {
                const rp = connectedPlayers[slotIdx];
                if (!rp) {
                  return (
                    <div
                      key={`empty-${slotIdx}`}
                      className="p-3 bg-slate-950/50 border border-dashed border-slate-800 flex items-center justify-center text-xs text-slate-500 min-h-[68px]"
                    >
                      Slot #{slotIdx + 1} · Menunggu penjelajah...
                    </div>
                  );
                }
                const playerProfile = rp.player ?? {
                  id: rp.player_id,
                  username: rp.player_id === localPlayer.id ? localPlayer.username : 'Penjelajah',
                  character_id:
                    rp.player_id === localPlayer.id ? localPlayer.character_id : ('kai' as const),
                };
                const isPresenceOnline = hasPresenceSynced && onlinePlayerIds.includes(rp.player_id);
                const isSlotHost = rp.player_id === room.host_player_id || rp.is_host;
                const isMe = rp.player_id === localPlayer.id;

                return (
                  <div
                    key={rp.player_id}
                    className={`p-3 border flex items-center justify-between gap-3 ${
                      isMe
                        ? 'bg-amber-500/10 border-amber-400/60'
                        : 'bg-slate-900/80 border-slate-700'
                    }`}
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <PixelCharacterPreview characterId={playerProfile.character_id} size={42} />
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5 font-semibold text-sm text-white truncate">
                          <span className="font-mono-num text-xs text-slate-400">
                            #{slotIdx + 1}
                          </span>
                          <span className="truncate">{playerProfile.username}</span>
                          {isSlotHost && (
                            <Crown className="w-3.5 h-3.5 text-amber-400 shrink-0" aria-label="Host" />
                          )}
                        </div>
                        <div className="text-xs text-slate-400">
                          {isSlotHost ? 'Host' : 'Penjelajah'} ·{' '}
                          <span
                            className={
                              isPresenceOnline || !hasPresenceSynced
                                ? 'text-emerald-400'
                                : 'text-sky-300'
                            }
                          >
                            {isPresenceOnline
                              ? 'Terhubung'
                              : hasPresenceSynced
                                ? 'Terhubung (Sinkronisasi...)'
                                : 'Terhubung'}
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Footer Actions */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-t border-slate-800 pt-4">
              <div className="text-xs text-slate-400 flex items-center gap-2">
                {!isHost ? (
                  <>
                    <RefreshCw className="w-3.5 h-3.5 animate-spin text-sky-400" />
                    Menunggu Host memulai ekspedisi (jenjang {room.difficulty})...
                  </>
                ) : connectedCount < 2 ? (
                  'Bagikan Kode Room. Minimal 2 penjelajah terhubung diperlukan untuk memulai.'
                ) : (
                  `Siap dimulai! Pulau 6 zona dan soal ${room.difficulty} akan dibuat untuk ${connectedCount} penjelajah aktif.`
                )}
              </div>

              {isHost && (
                <button
                  type="button"
                  disabled={!canStart}
                  onClick={() => {
                    soundSystem.playClick();
                    onStartGame();
                  }}
                  className="pixel-btn min-h-[46px] inline-flex items-center justify-center gap-2 px-6 py-3 bg-amber-500 hover:bg-amber-400 disabled:opacity-45 text-slate-950 font-bold text-sm cursor-pointer whitespace-nowrap"
                >
                  <Play className="w-4 h-4 fill-current" />
                  {countdownSeconds !== null
                    ? `Memulai (${countdownSeconds})...`
                    : isBusy
                      ? 'Menyiapkan Pulau...'
                      : 'START GAME'}
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
