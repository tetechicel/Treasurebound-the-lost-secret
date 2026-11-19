import { useCallback, useEffect, useRef, useState } from 'react';
import { BookOpen, LogOut, Play, RotateCw, Settings, X } from 'lucide-react';
import { PhaserGame } from '../game/PhaserGame';
import { gameBridge, MinimapSnapshot } from '../game/GameBridge';
import {
  BIOME_LABELS,
  BiomeId,
  ChunkCoord,
  COMBAT_CONFIG,
  DISCOVERABLE_ZONES,
  SCORE_CONFIG,
} from '../game/maps/MapConfig';
import { soundSystem } from '../game/systems/SoundSystem';
import { tryLockLandscapeOrientation } from '../hooks/useFullscreen';
import { useVisualViewport } from '../hooks/useVisualViewport';
import {
  fetchChallengeQuestions,
  getQuestionTierForChallenge,
  submitChallengeAnswer,
} from '../services/questionService';
import {
  activateSwitchOrKeyRpc,
  applyTrapDamageRpc,
  claimSecretTreasureRpc,
  collectAppleRpc,
  completeRespawnRpc,
  fetchMatchBundle,
  recordAttackHitRpc,
  unlockLargeTreasureRpc,
  updatePlayerPositionRpc,
  useAppleRpc,
} from '../multiplayer/matchService';
import { realtimeService } from '../multiplayer/realtimeService';
import {
  ActiveQuizSeriesChallenge,
  GameSettings,
  MatchPlayerState,
  MatchRecord,
  PlayerProfile,
  QuizChallengeKind,
  QuizSubmissionResult,
} from '../types/game';
import { InGameHud } from '../components/game/InGameHud';
import { MobileControls } from '../components/game/MobileControls';
import { QuizModal } from '../components/quiz/QuizModal';
import { LargeTreasureModal } from '../components/quiz/LargeTreasureModal';
import { InventoryModal } from '../components/inventory/InventoryModal';
import { SettingsModal } from '../components/ui/SettingsModal';
import { HowToPlayModal } from '../components/ui/HowToPlayModal';
import { FullscreenButton } from '../components/ui/FullscreenButton';

interface GamePageProps {
  localProfile: PlayerProfile;
  match: MatchRecord;
  initialPlayers: MatchPlayerState[];
  isSoloPractice: boolean;
  settings: GameSettings;
  isFullscreen: boolean;
  isStandalone: boolean;
  onToggleFullscreen: (lockLandscape?: boolean) => void;
  onEnterFullscreenLandscape: () => Promise<boolean>;
  onUpdateSettings: (next: GameSettings) => void;
  onMatchFinished: (winnerPlayerId: string, finalPlayers: MatchPlayerState[]) => void;
  onExitMatch: () => void;
}

export function GamePage({
  localProfile,
  match,
  initialPlayers,
  isSoloPractice,
  settings,
  isFullscreen,
  isStandalone,
  onToggleFullscreen,
  onEnterFullscreenLandscape,
  onUpdateSettings,
  onMatchFinished,
  onExitMatch,
}: GamePageProps) {
  const viewport = useVisualViewport();
  const [players, setPlayers] = useState<MatchPlayerState[]>(initialPlayers);
  const [biome, setBiome] = useState<BiomeId>('VILLAGE');
  const [chunkCoord, setChunkCoord] = useState<ChunkCoord>({
    chunkX: 0,
    chunkY: 3,
    chunkIndex: 15,
  });
  const [discoveredBiomes, setDiscoveredBiomes] = useState<BiomeId[]>(['VILLAGE']);
  const [minimap, setMinimap] = useState<MinimapSnapshot>({
    playerX: match.map_configuration.spawnPoints[0]?.x ?? 1040,
    playerY: match.map_configuration.spawnPoints[0]?.y ?? 3600,
    others: [],
    revealedTreasure: false,
  });

  const [activeQuiz, setActiveQuiz] = useState<ActiveQuizSeriesChallenge | null>(null);
  const [quizSubmitting, setQuizSubmitting] = useState(false);
  const [quizResult, setQuizResult] = useState<QuizSubmissionResult | null>(null);

  const [largeTreasureLockOpen, setLargeTreasureLockOpen] = useState(false);
  const [largeLockSubmitting, setLargeLockSubmitting] = useState(false);
  const [largeLockError, setLargeLockError] = useState<string | null>(null);

  const [inventoryOpen, setInventoryOpen] = useState(false);
  const [pauseOpen, setPauseOpen] = useState(false);
  const [subModal, setSubModal] = useState<'settings' | 'howto' | null>(null);
  const [npcDialogue, setNpcDialogue] = useState<{
    name: string;
    role: string;
    dialogue: string;
  } | null>(null);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [proximityHint, setProximityHint] = useState<{ label: string; kind: string } | null>(null);
  const [respawnSecondsLeft, setRespawnSecondsLeft] = useState(0);
  const [isTouchDevice, setIsTouchDevice] = useState(false);
  const [landscapeHintDismissed, setLandscapeHintDismissed] = useState(false);

  const toastTimerRef = useRef<number | null>(null);
  const matchEndedRef = useRef(false);
  const respawnInFlightRef = useRef(false);
  const preClaimScoreRef = useRef<number | null>(null);
  const lastServerPosSyncAtRef = useRef(0);
  const lastServerPosRef = useRef<{ x: number; y: number } | null>(null);
  const posSyncInFlightRef = useRef(false);
  const playersRef = useRef<MatchPlayerState[]>(players);
  playersRef.current = players;

  const localState = players.find((p) => p.player_id === localProfile.id) ?? players[0];
  const localStateRef = useRef(localState);
  localStateRef.current = localState;

  const showToast = useCallback((msg: string) => {
    setToastMessage(msg);
    if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current);
    toastTimerRef.current = window.setTimeout(() => {
      setToastMessage(null);
    }, 3400);
  }, []);

  const freezeAndFinish = useCallback(
    (winnerPlayerId: string, finalPlayers: MatchPlayerState[]) => {
      if (matchEndedRef.current) return;
      matchEndedRef.current = true;
      setActiveQuiz(null);
      setQuizResult(null);
      setLargeTreasureLockOpen(false);
      setInventoryOpen(false);
      setPauseOpen(false);
      setSubModal(null);
      gameBridge.emit('match:freeze', { frozen: true });
      soundSystem.playVictory();
      onMatchFinished(winnerPlayerId, finalPlayers);
    },
    [onMatchFinished]
  );

  useEffect(() => {
    const touchCapable =
      typeof window !== 'undefined' &&
      ('ontouchstart' in window || navigator.maxTouchPoints > 0 || window.innerWidth < 900);
    setIsTouchDevice(touchCapable);
  }, []);

  // Attempt safe landscape lock during active fullscreen/PWA mobile gameplay
  useEffect(() => {
    if (isTouchDevice && (isFullscreen || isStandalone)) {
      void tryLockLandscapeOrientation();
    }
  }, [isTouchDevice, isFullscreen, isStandalone]);

  // Sync Phaser pause state whenever any modal opens
  useEffect(() => {
    const shouldPause = Boolean(
      activeQuiz || largeTreasureLockOpen || inventoryOpen || pauseOpen || subModal
    );
    gameBridge.emit('input:pause', { paused: shouldPause });
  }, [activeQuiz, largeTreasureLockOpen, inventoryOpen, pauseOpen, subModal]);

  // Keep Phaser local stats & 4-stage world progression synchronized
  useEffect(() => {
    if (!localState) return;
    const invulnMsLeft = localState.invulnerable_until
      ? Math.max(0, new Date(localState.invulnerable_until).getTime() - Date.now())
      : 0;
    const isInvuln = invulnMsLeft > 0;

    gameBridge.emit('local:stats_updated', {
      health: localState.health,
      apples: localState.apples,
      coins: localState.coins,
      score: localState.score,
      isDead: localState.is_dead,
      isInvulnerable: isInvuln,
      cluesFound: localState.clues_found,
    });
    gameBridge.emit('world:progress_updated', {
      completedSmallChests: localState.completed_small_chests ?? [],
      completedChallenges: localState.completed_challenges ?? [],
      unlockedGates: localState.unlocked_gates ?? [],
      activatedSwitches: localState.activated_switches ?? [],
      hasSecretKey: Boolean(localState.has_secret_key),
      largeTreasureUnlocked: Boolean(localState.large_treasure_unlocked),
      largeTreasureCompleted: Boolean(localState.large_treasure_completed),
    });

    if (invulnMsLeft > 0) {
      const timer = window.setTimeout(() => {
        const cur = localStateRef.current;
        if (!cur) return;
        gameBridge.emit('local:stats_updated', {
          health: cur.health,
          apples: cur.apples,
          coins: cur.coins,
          score: cur.score,
          isDead: cur.is_dead,
          isInvulnerable: false,
          cluesFound: cur.clues_found,
        });
      }, invulnMsLeft + 50);
      return () => window.clearTimeout(timer);
    }
  }, [localState]);

  const openQuizChallenge = useCallback(
    async (params: {
      itemKey: string;
      challengeKind: QuizChallengeKind;
      title: string;
      region: string;
      questionCount: number;
    }) => {
      if (localStateRef.current?.is_dead) {
        showToast('Kamu sedang pingsan! Tunggu respawn selesai.');
        return;
      }
      try {
        soundSystem.playClick();
        setQuizResult(null);
        const progressKey = `${params.challengeKind}:${params.itemKey}`;
        const savedCorrect =
          params.challengeKind === 'small_chest' || params.challengeKind === 'large_treasure'
            ? (localStateRef.current?.challenge_progress?.[progressKey] ??
                localStateRef.current?.challenge_progress?.[params.itemKey] ??
                0)
            : 0;
        const clampedSaved = Math.min(
          Math.max(0, params.questionCount - 1),
          Math.max(0, savedCorrect)
        );
        const remainingCount = Math.max(1, params.questionCount - clampedSaved);

        const questions = await fetchChallengeQuestions({
          matchId: match.id,
          playerId: localProfile.id,
          educationLevel: match.difficulty,
          tier: getQuestionTierForChallenge(params.challengeKind),
          count: remainingCount,
          isSoloPractice,
        });
        if (!questions || questions.length === 0) {
          showToast('Tidak ada soal tersedia untuk tantangan ini.');
          return;
        }
        setActiveQuiz({
          itemKey: params.itemKey,
          challengeKind: params.challengeKind,
          title: params.title,
          region: params.region,
          questions,
          currentIndex: 0,
          correctInSeries: clampedSaved,
          totalRequired: params.questionCount,
          attemptNonce: Date.now(),
        });
      } catch (err) {
        showToast(err instanceof Error ? err.message : 'Gagal memuat pertanyaan tantangan');
      }
    },
    [isSoloPractice, localProfile.id, match.difficulty, match.id, showToast]
  );

  // Handle Respawn Countdown & Completion
  useEffect(() => {
    if (!localState?.is_dead) {
      setRespawnSecondsLeft(0);
      respawnInFlightRef.current = false;
      return;
    }

    const targetMs = localState.respawn_at
      ? new Date(localState.respawn_at).getTime()
      : Date.now() + COMBAT_CONFIG.RESPAWN_DELAY_MS;

    const tick = window.setInterval(async () => {
      const rem = Math.max(0, Math.ceil((targetMs - Date.now()) / 1000));
      setRespawnSecondsLeft(rem);
      if (Date.now() < targetMs || respawnInFlightRef.current) return;

      respawnInFlightRef.current = true;
      try {
        let newHp = COMBAT_CONFIG.MAX_HEALTH;
        let invulnIso = new Date(Date.now() + COMBAT_CONFIG.INVULNERABILITY_MS).toISOString();

        if (!isSoloPractice) {
          const res = await completeRespawnRpc(match.id, localProfile.id);
          const alreadyAlive =
            !res.respawned &&
            (res.reason === 'already_alive' || (!res.reason && res.health !== undefined));
          if (!res.respawned && !alreadyAlive) {
            if (res.reason === 'respawn_timer_active') {
              return; // keep polling until server clock allows respawn
            }
            if (res.reason === 'player_not_found') {
              window.clearInterval(tick);
            }
            return;
          }
          newHp = res.health ?? COMBAT_CONFIG.MAX_HEALTH;
          if (res.invulnerable_until) invulnIso = res.invulnerable_until;
          if (res.respawned) {
            await realtimeService.send('player:respawn', {
              playerId: localProfile.id,
              health: newHp,
            });
          }
        }

        window.clearInterval(tick);
        setPlayers((prev) =>
          prev.map((p) =>
            p.player_id === localProfile.id
              ? {
                  ...p,
                  health: newHp,
                  is_dead: false,
                  respawn_at: null,
                  invulnerable_until: invulnIso,
                }
              : p
          )
        );
        showToast('Bangkit kembali! Kebal serangan selama 2 detik.');
      } catch (err) {
        console.warn('complete_respawn retry warning:', err);
      } finally {
        respawnInFlightRef.current = false;
      }
    }, 300);

    return () => {
      window.clearInterval(tick);
      respawnInFlightRef.current = false;
    };
  }, [
    localState?.is_dead,
    localState?.respawn_at,
    isSoloPractice,
    match.id,
    localProfile.id,
    showToast,
  ]);

  const handleUseApple = useCallback(async () => {
    const cur = localStateRef.current;
    if (!cur || cur.is_dead) return;
    if (cur.apples <= 0) {
      showToast('Tas kosong! Tidak ada apel.');
      return;
    }
    if (cur.health >= COMBAT_CONFIG.MAX_HEALTH) {
      showToast('HP sudah penuh!');
      return;
    }

    if (isSoloPractice) {
      soundSystem.playHeal();
      const nextHp = Math.min(COMBAT_CONFIG.MAX_HEALTH, cur.health + COMBAT_CONFIG.APPLE_HEAL);
      setPlayers((prev) =>
        prev.map((p) =>
          p.player_id === localProfile.id ? { ...p, health: nextHp, apples: p.apples - 1 } : p
        )
      );
      showToast(`Memakan Apel! +${COMBAT_CONFIG.APPLE_HEAL} HP`);
      return;
    }

    try {
      const res = await useAppleRpc(match.id, localProfile.id);
      if (res.used) {
        soundSystem.playHeal();
        setPlayers((prev) =>
          prev.map((p) =>
            p.player_id === localProfile.id
              ? { ...p, health: res.health ?? cur.health, apples: res.apples ?? cur.apples - 1 }
              : p
          )
        );
        showToast(`Memakan Apel! +${COMBAT_CONFIG.APPLE_HEAL} HP`);
      }
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Gagal memakai apel');
    }
  }, [isSoloPractice, localProfile.id, match.id, showToast]);

  // Keyboard shortcuts for HUD actions
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (activeQuiz || largeTreasureLockOpen) return;
      if (e.key === '1') {
        handleUseApple();
      } else if (e.key.toLowerCase() === 'i' || e.key === 'Tab') {
        e.preventDefault();
        setInventoryOpen((v) => !v);
      } else if (e.key === 'Escape') {
        if (inventoryOpen) {
          setInventoryOpen(false);
        } else if (subModal) {
          setSubModal(null);
        } else if (npcDialogue) {
          setNpcDialogue(null);
        } else {
          setPauseOpen((v) => !v);
        }
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [activeQuiz, largeTreasureLockOpen, inventoryOpen, subModal, npcDialogue, handleUseApple]);

  // Subscribe to Phaser GameBridge events & wire Multiplayer Realtime
  useEffect(() => {
    const syncRemoteStandings = async () => {
      if (isSoloPractice || matchEndedRef.current) return;
      try {
        const bundle = await fetchMatchBundle(match.id);
        setPlayers(bundle.players);
        if (bundle.match.status === 'FINISHED' && bundle.match.winner_player_id) {
          freezeAndFinish(bundle.match.winner_player_id, bundle.players);
        }
      } catch {
        // ignore transient refresh failure
      }
    };

    if (!isSoloPractice) {
      void realtimeService.subscribeToMatch(match.id);
      realtimeService.updateCallbacks({
        onPlayerMove: (sync) => gameBridge.emit('remote:move', sync),
        onPlayerAttack: (proj) => gameBridge.emit('remote:attack', proj),
        onPlayerHit: ({ targetId, attackerId, newHp, isDead, respawnAt }) => {
          gameBridge.emit('remote:hit', { targetId, attackerId, newHp, isDead, respawnAt });
          setPlayers((prev) =>
            prev.map((p) => {
              if (p.player_id === targetId) {
                return { ...p, health: newHp, is_dead: isDead, respawn_at: respawnAt };
              }
              if (p.player_id === attackerId) {
                return { ...p, total_attacks: p.total_attacks + 1 };
              }
              return p;
            })
          );
          if (targetId === localProfile.id) {
            soundSystem.playHit();
          }
        },
        onPlayerRespawn: ({ playerId, health }) => {
          gameBridge.emit('remote:respawn', { playerId, health });
          setPlayers((prev) =>
            prev.map((p) =>
              p.player_id === playerId ? { ...p, health, is_dead: false, respawn_at: null } : p
            )
          );
        },
        onItemClaimed: ({ itemKey, itemType, claimedBy }) => {
          gameBridge.emit('world:item_claimed', { itemKey, itemType, claimedBy });
        },
        onPlayerScoreUpdate: syncRemoteStandings,
        onDbMatchPlayersUpdated: syncRemoteStandings,
        onReconnected: syncRemoteStandings,
        onMatchFinished: ({ winnerPlayerId }) => {
          const fallback = playersRef.current.map((p) =>
            p.player_id === winnerPlayerId &&
            winnerPlayerId === localProfile.id &&
            preClaimScoreRef.current !== null &&
            p.score === preClaimScoreRef.current
              ? {
                  ...p,
                  score: p.score + SCORE_CONFIG.CLAIM_SECRET_TREASURE,
                  coins: p.coins + SCORE_CONFIG.CLAIM_SECRET_TREASURE,
                }
              : p
          );
          freezeAndFinish(winnerPlayerId, fallback);
        },
        onDbMatchUpdated: (_id, status, winnerPlayerId) => {
          if (status === 'FINISHED' && winnerPlayerId) {
            const fallback = playersRef.current.map((p) =>
              p.player_id === winnerPlayerId &&
              winnerPlayerId === localProfile.id &&
              preClaimScoreRef.current !== null &&
              p.score === preClaimScoreRef.current
                ? {
                    ...p,
                    score: p.score + SCORE_CONFIG.CLAIM_SECRET_TREASURE,
                    coins: p.coins + SCORE_CONFIG.CLAIM_SECRET_TREASURE,
                  }
                : p
            );
            freezeAndFinish(winnerPlayerId, fallback);
          }
        },
      });
    }

    const unsubs = [
      gameBridge.on('biome:changed', (b) => {
        setBiome(b);
        if (b !== 'OCEAN' && DISCOVERABLE_ZONES.includes(b)) {
          setDiscoveredBiomes((prev) => {
            if (prev.includes(b)) return prev;
            showToast(`Zona baru ditemukan: ${BIOME_LABELS[b]}!`);
            return [...prev, b];
          });
        }
      }),
      gameBridge.on('chunk:changed', (cc) => setChunkCoord(cc)),
      gameBridge.on('minimap:update', (snap) => setMinimap(snap)),
      gameBridge.on('player:proximity_hint', (hint) => setProximityHint(hint)),
      gameBridge.on('player:interact_npc', (npc) => setNpcDialogue(npc)),
      gameBridge.on('player:locked_feedback', ({ message }) => showToast(message)),

      gameBridge.on('player:moved', (m) => {
        if (isSoloPractice) return;
        const cur = localStateRef.current;
        realtimeService.send('player:move', {
          playerId: localProfile.id,
          username: localProfile.username,
          characterId: localProfile.character_id,
          x: m.x,
          y: m.y,
          vx: m.vx,
          vy: m.vy,
          dir: m.dir,
          anim: m.anim,
          health: cur?.health ?? 100,
          isDead: cur?.is_dead ?? false,
          isInvulnerable: false,
          ts: Date.now(),
        });

        if (matchEndedRef.current || cur?.is_dead || posSyncInFlightRef.current) return;
        const now = performance.now();
        const prevPos = lastServerPosRef.current;
        const distMoved = prevPos ? Math.hypot(m.x - prevPos.x, m.y - prevPos.y) : Infinity;
        const shouldSync =
          (distMoved >= 8 && now - lastServerPosSyncAtRef.current >= 450) ||
          now - lastServerPosSyncAtRef.current >= 3000;

        if (shouldSync) {
          lastServerPosSyncAtRef.current = now;
          lastServerPosRef.current = { x: m.x, y: m.y };
          posSyncInFlightRef.current = true;
          void updatePlayerPositionRpc(match.id, localProfile.id, m.x, m.y)
            .catch(() => {
              // ignore transient position sync failure
            })
            .finally(() => {
              posSyncInFlightRef.current = false;
            });
        }
      }),

      gameBridge.on('player:attack_cast', (atk) => {
        if (isSoloPractice) return;
        realtimeService.send('player:attack', {
          projectileId: atk.projectileId,
          attackerId: localProfile.id,
          x: atk.x,
          y: atk.y,
          angle: atk.angle,
          speed: COMBAT_CONFIG.PROJECTILE_SPEED,
          maxRange: COMBAT_CONFIG.PROJECTILE_MAX_RANGE,
          ts: Date.now(),
        });
      }),

      gameBridge.on('player:hit_target', async ({ targetId, attackerPos, targetPos }) => {
        if (isSoloPractice) return;
        try {
          const res = await recordAttackHitRpc({
            matchId: match.id,
            attackerId: localProfile.id,
            targetId,
            attackerPos,
            targetPos,
          });
          if (res.applied && res.target_id !== undefined) {
            const payload = {
              targetId: res.target_id,
              attackerId: localProfile.id,
              newHp: res.new_hp ?? 0,
              isDead: Boolean(res.is_dead),
              respawnAt: res.respawn_at ?? null,
            };
            gameBridge.emit('remote:hit', { ...payload, skipSpark: true });
            await realtimeService.send('player:hit', payload);
            setPlayers((prev) =>
              prev.map((p) => {
                if (p.player_id === payload.targetId) {
                  return {
                    ...p,
                    health: payload.newHp,
                    is_dead: payload.isDead,
                    respawn_at: payload.respawnAt,
                  };
                }
                if (p.player_id === localProfile.id) {
                  return { ...p, total_attacks: p.total_attacks + 1 };
                }
                return p;
              })
            );
          }
        } catch (err) {
          console.warn('record_attack_hit warning:', err);
        }
      }),

      gameBridge.on('player:interact_apple', async ({ itemKey }) => {
        const cur = localStateRef.current;
        if (!cur || cur.apples >= COMBAT_CONFIG.MAX_APPLES) {
          showToast('Tas penuh! Maksimal membawa 3 apel.');
          return;
        }
        if (isSoloPractice) {
          soundSystem.playApplePickup();
          gameBridge.emit('world:item_claimed', {
            itemKey,
            itemType: 'apple',
            claimedBy: localProfile.id,
          });
          setPlayers((prev) =>
            prev.map((p) =>
              p.player_id === localProfile.id ? { ...p, apples: p.apples + 1 } : p
            )
          );
          showToast('Mengambil Apel (+25 HP pemulihan)');
          return;
        }

        try {
          const res = await collectAppleRpc(match.id, localProfile.id, itemKey);
          if (res.collected) {
            soundSystem.playApplePickup();
            gameBridge.emit('world:item_claimed', {
              itemKey,
              itemType: 'apple',
              claimedBy: localProfile.id,
            });
            await realtimeService.send('world:item_claimed', {
              itemKey,
              itemType: 'apple',
              claimedBy: localProfile.id,
            });
            setPlayers((prev) =>
              prev.map((p) =>
                p.player_id === localProfile.id ? { ...p, apples: res.apples ?? p.apples + 1 } : p
              )
            );
            showToast('Mengambil Apel (+25 HP pemulihan)');
          } else if (res.reason === 'already_claimed') {
            gameBridge.emit('world:item_claimed', { itemKey, itemType: 'apple', claimedBy: '' });
            showToast('Penjelajah lain sudah mengambil apel itu!');
          }
        } catch (err) {
          showToast(err instanceof Error ? err.message : 'Gagal mengambil apel');
        }
      }),

      gameBridge.on('player:interact_quiz', (payload) => {
        openQuizChallenge(payload);
      }),

      gameBridge.on('player:interact_large_treasure_lock', () => {
        soundSystem.playClick();
        setLargeLockError(null);
        setLargeTreasureLockOpen(true);
      }),

      gameBridge.on('player:interact_switch', async ({ switchId, title, targetKind }) => {
        const cur = localStateRef.current;
        if (!cur || cur.activated_switches.includes(switchId)) return;

        if (isSoloPractice) {
          soundSystem.playChestOpen();
          setPlayers((prev) =>
            prev.map((p) =>
              p.player_id === localProfile.id
                ? { ...p, activated_switches: [...p.activated_switches, switchId] }
                : p
            )
          );
          showToast(
            targetKind === 'bridge'
              ? `${title} aktif! Jembatan batu membentang di atas rawa.`
              : `${title} aktif! Jalan rahasia di Gua Kristal terbuka.`
          );
          return;
        }

        try {
          const res = await activateSwitchOrKeyRpc(match.id, localProfile.id, 'switch', switchId);
          if (res.applied) {
            soundSystem.playChestOpen();
            setPlayers((prev) =>
              prev.map((p) =>
                p.player_id === localProfile.id
                  ? {
                      ...p,
                      activated_switches:
                        res.activated_switches ?? [...p.activated_switches, switchId],
                    }
                  : p
              )
            );
            showToast(
              targetKind === 'bridge'
                ? `${title} aktif! Jembatan batu membentang di atas rawa.`
                : `${title} aktif! Jalan rahasia di Gua Kristal terbuka.`
            );
          }
        } catch (err) {
          showToast(err instanceof Error ? err.message : 'Gagal mengaktifkan tuas');
        }
      }),

      gameBridge.on('player:interact_secret_key', async ({ keyId, title }) => {
        const cur = localStateRef.current;
        if (!cur || cur.has_secret_key) return;

        if (isSoloPractice) {
          soundSystem.playChestOpen();
          setPlayers((prev) =>
            prev.map((p) =>
              p.player_id === localProfile.id ? { ...p, has_secret_key: true } : p
            )
          );
          showToast(`Menemukan ${title}! Buka Peti Rahasia di Gua Kristal.`);
          return;
        }

        try {
          const res = await activateSwitchOrKeyRpc(match.id, localProfile.id, 'secret_key', keyId);
          if (res.applied) {
            soundSystem.playChestOpen();
            setPlayers((prev) =>
              prev.map((p) =>
                p.player_id === localProfile.id ? { ...p, has_secret_key: true } : p
              )
            );
            showToast(`Menemukan ${title}! Buka Peti Rahasia di Gua Kristal.`);
          }
        } catch (err) {
          showToast(err instanceof Error ? err.message : 'Gagal mengambil kunci emas');
        }
      }),

      gameBridge.on('player:triggered_trap', async () => {
        const cur = localStateRef.current;
        if (!cur || cur.is_dead) return;
        if (isSoloPractice) {
          const newHp = Math.max(0, cur.health - COMBAT_CONFIG.TRAP_DAMAGE);
          const dead = newHp <= 0;
          setPlayers((prev) =>
            prev.map((p) =>
              p.player_id === localProfile.id
                ? {
                    ...p,
                    health: newHp,
                    is_dead: dead,
                    respawn_at: dead
                      ? new Date(Date.now() + COMBAT_CONFIG.RESPAWN_DELAY_MS).toISOString()
                      : null,
                  }
                : p
            )
          );
          showToast(`Jebakan Runa Kuil! -${COMBAT_CONFIG.TRAP_DAMAGE} HP`);
          return;
        }

        try {
          const res = await applyTrapDamageRpc(match.id, localProfile.id);
          if (res.applied) {
            const payload = {
              targetId: localProfile.id,
              attackerId: localProfile.id,
              newHp: res.new_hp ?? cur.health,
              isDead: Boolean(res.is_dead),
              respawnAt: res.respawn_at ?? null,
            };
            await realtimeService.send('player:hit', payload);
            setPlayers((prev) =>
              prev.map((p) =>
                p.player_id === localProfile.id
                  ? {
                      ...p,
                      health: payload.newHp,
                      is_dead: payload.isDead,
                      respawn_at: payload.respawnAt,
                    }
                  : p
              )
            );
            showToast(`Jebakan Runa Kuil! -${COMBAT_CONFIG.TRAP_DAMAGE} HP`);
          }
        } catch (err) {
          console.warn('apply_trap_damage warning:', err);
        }
      }),

      gameBridge.on('player:interact_secret_treasure', async ({ x, y }) => {
        const cur = localStateRef.current;
        if (!cur?.large_treasure_completed) {
          showToast(
            'Secret Treasure masih tersegel! Selesaikan Large Treasure terlebih dahulu.'
          );
          return;
        }

        if (isSoloPractice) {
          const finalPlayers = playersRef.current.map((p) =>
            p.player_id === localProfile.id
              ? {
                  ...p,
                  score: p.score + SCORE_CONFIG.CLAIM_SECRET_TREASURE,
                  coins: p.coins + SCORE_CONFIG.CLAIM_SECRET_TREASURE,
                }
              : p
          );
          freezeAndFinish(localProfile.id, finalPlayers);
          return;
        }

        try {
          preClaimScoreRef.current = cur.score;
          const res = await claimSecretTreasureRpc(match.id, localProfile.id, { x, y });
          if (res.claimed && res.winner_player_id) {
            await realtimeService.send('match:finished', {
              matchId: match.id,
              winnerPlayerId: res.winner_player_id,
            });
            const finalPlayers = playersRef.current.map((p) =>
              p.player_id === localProfile.id && p.score === preClaimScoreRef.current
                ? {
                    ...p,
                    score: p.score + SCORE_CONFIG.CLAIM_SECRET_TREASURE,
                    coins: p.coins + SCORE_CONFIG.CLAIM_SECRET_TREASURE,
                  }
                : p
            );
            freezeAndFinish(res.winner_player_id, finalPlayers);
          } else if (res.winner_player_id) {
            freezeAndFinish(res.winner_player_id, playersRef.current);
          } else if (res.reason === 'large_treasure_incomplete') {
            showToast('Selesaikan Large Treasure terlebih dahulu!');
          } else if (res.reason === 'gate_not_unlocked') {
            showToast('Buka Gerbang Kuil Dalam terlebih dahulu!');
          } else if (res.reason === 'position_desync') {
            showToast('Sinkronisasi posisi belum selesai, coba lagi sebentar.');
          } else {
            showToast('Dekati altar Secret Treasure untuk mengklaimnya.');
          }
        } catch (err) {
          showToast(err instanceof Error ? err.message : 'Gagal mengklaim Secret Treasure');
        }
      }),
    ];

    return () => {
      unsubs.forEach((u) => u());
      if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current);
      if (!isSoloPractice) {
        void realtimeService.unsubscribeFromMatch();
      }
    };
  }, [
    freezeAndFinish,
    isSoloPractice,
    localProfile,
    match,
    openQuizChallenge,
    showToast,
  ]);

  const handleSubmitQuiz = useCallback(
    async (selectedIndex: number) => {
      if (!activeQuiz || quizSubmitting || quizResult) return;
      const cur = localStateRef.current;
      if (cur?.is_dead) {
        showToast('Tidak bisa menjawab kuis saat sedang pingsan!');
        return;
      }
      const currentQuestion = activeQuiz.questions[activeQuiz.currentIndex];
      if (!currentQuestion) return;

      setQuizSubmitting(true);
      try {
        const nextSeriesCorrect = Math.min(activeQuiz.totalRequired, activeQuiz.correctInSeries + 1);

        const res = await submitChallengeAnswer({
          matchId: match.id,
          playerId: localProfile.id,
          questionId: currentQuestion.id,
          selectedIndex,
          itemKey: activeQuiz.itemKey,
          challengeKind: activeQuiz.challengeKind,
          seriesCorrectCount: nextSeriesCorrect,
          seriesTotal: activeQuiz.totalRequired,
          isSoloPractice,
          educationLevel: match.difficulty,
          currentHealth: cur?.health ?? 100,
          currentScore: cur?.score ?? 0,
          currentCoins: cur?.coins ?? 0,
          mapConfig: match.map_configuration,
        });

        setQuizResult(res);

        if (res.is_correct) {
          soundSystem.playQuizCorrect();
          const resolvedCorrectInSeries = res.series_correct_count ?? nextSeriesCorrect;
          setActiveQuiz((prev) =>
            prev ? { ...prev, correctInSeries: resolvedCorrectInSeries } : null
          );

          setPlayers((prev) =>
            prev.map((p) => {
              if (p.player_id !== localProfile.id) return p;

              const nextSmall =
                res.challenge_completed &&
                activeQuiz.challengeKind === 'small_chest' &&
                !p.completed_small_chests.includes(activeQuiz.itemKey)
                  ? [...p.completed_small_chests, activeQuiz.itemKey]
                  : p.completed_small_chests;

              const nextFrags =
                res.fragment_awarded &&
                !p.collected_fragments.some((f) => f.chestId === res.fragment_awarded!.chestId)
                  ? [...p.collected_fragments, res.fragment_awarded]
                  : p.collected_fragments;

              const nextGates =
                res.unlocked_gate_id && !p.unlocked_gates.includes(res.unlocked_gate_id)
                  ? [...p.unlocked_gates, res.unlocked_gate_id]
                  : p.unlocked_gates;

              const nextChallenges =
                res.challenge_completed &&
                activeQuiz.challengeKind !== 'small_chest' &&
                activeQuiz.challengeKind !== 'large_treasure' &&
                !p.completed_challenges.includes(activeQuiz.itemKey)
                  ? [...p.completed_challenges, activeQuiz.itemKey]
                  : p.completed_challenges;

              const nextLargeCompleted =
                p.large_treasure_completed ||
                (res.challenge_completed && activeQuiz.challengeKind === 'large_treasure');

              const progressKey = `${activeQuiz.challengeKind}:${activeQuiz.itemKey}`;

              return {
                ...p,
                score: res.new_score,
                coins: res.new_coins,
                correct_answers: p.correct_answers + (res.already_answered ? 0 : 1),
                clues_found: p.clues_found + (res.challenge_completed ? 1 : 0),
                opened_chests:
                  p.opened_chests +
                  (res.challenge_completed && activeQuiz.challengeKind === 'small_chest' ? 1 : 0),
                completed_small_chests: nextSmall,
                collected_fragments: nextFrags,
                unlocked_gates: nextGates,
                completed_challenges: nextChallenges,
                large_treasure_completed: nextLargeCompleted,
                challenge_progress: {
                  ...(p.challenge_progress ?? {}),
                  [progressKey]: resolvedCorrectInSeries,
                },
              };
            })
          );

          if (!isSoloPractice && !res.already_answered) {
            realtimeService.send('player:score_update', {});
          }

          if (res.challenge_completed && activeQuiz.challengeKind === 'small_chest') {
            showToast(
              `Small Chest selesai! Fragmen kode "${res.fragment_awarded?.code ?? ''}" tersimpan di Jurnal.`
            );
          } else if (res.challenge_completed && activeQuiz.challengeKind === 'large_treasure') {
            showToast('Ujian Large Treasure selesai! Masuk Kuil Dalam & klaim Secret Treasure!');
          } else if (res.unlocked_gate_id) {
            showToast('Gerbang batu berhasil dibuka! (+15 Poin)');
          }
        } else {
          soundSystem.playQuizWrong();
          setPlayers((prev) =>
            prev.map((p) =>
              p.player_id === localProfile.id
                ? {
                    ...p,
                    health: res.new_hp,
                    incorrect_answers: p.incorrect_answers + (res.already_answered ? 0 : 1),
                  }
                : p
            )
          );
        }
      } catch (err) {
        showToast(
          err instanceof Error
            ? `${err.message} — Silakan coba kirim ulang.`
            : 'Koneksi terganggu saat mengirim jawaban. Silakan coba kirim ulang.'
        );
      } finally {
        setQuizSubmitting(false);
      }
    },
    [activeQuiz, quizSubmitting, quizResult, match, localProfile.id, isSoloPractice, showToast]
  );

  const handleNextQuizQuestion = useCallback(() => {
    setQuizResult(null);
    setActiveQuiz((prev) => {
      if (!prev) return null;
      return {
        ...prev,
        currentIndex: Math.min(prev.questions.length - 1, prev.currentIndex + 1),
      };
    });
  }, []);

  const handleRetryWrongQuestion = useCallback(async () => {
    if (!activeQuiz || quizSubmitting) return;
    setQuizSubmitting(true);
    try {
      const replacement = await fetchChallengeQuestions({
        matchId: match.id,
        playerId: localProfile.id,
        educationLevel: match.difficulty,
        tier: getQuestionTierForChallenge(activeQuiz.challengeKind),
        count: 1,
        isSoloPractice,
      });
      if (!replacement || replacement.length === 0) {
        showToast('Tidak ada soal pengganti tersedia.');
        return;
      }
      setQuizResult(null);
      setActiveQuiz((prev) => {
        if (!prev) return null;
        const nextQuestions = [...prev.questions];
        nextQuestions[prev.currentIndex] = replacement[0];
        return {
          ...prev,
          questions: nextQuestions,
          attemptNonce: Date.now(),
        };
      });
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Gagal memuat soal pengganti');
    } finally {
      setQuizSubmitting(false);
    }
  }, [activeQuiz, isSoloPractice, localProfile.id, match.difficulty, match.id, quizSubmitting, showToast]);

  const handleSubmitLargeTreasureCodes = useCallback(
    async (submittedCodes: string[]) => {
      if (!localState || largeLockSubmitting) return;
      setLargeLockSubmitting(true);
      setLargeLockError(null);

      try {
        if (isSoloPractice) {
          const smallChests = match.map_configuration.smallChests;
          if (localState.completed_small_chests.length < smallChests.length) {
            setLargeLockError(
              `Selesaikan semua ${smallChests.length} Small Chest terlebih dahulu (${localState.completed_small_chests.length}/${smallChests.length}).`
            );
            return;
          }
          for (let i = 0; i < smallChests.length; i++) {
            const expected = smallChests[i].fragmentCode.trim().toUpperCase();
            const actual = (submittedCodes[i] ?? '').trim().toUpperCase();
            if (actual !== expected) {
              setLargeLockError(
                `Kode segel ke-${i + 1} (${smallChests[i].name}) belum tepat. Cek Jurnal Petualanganmu!`
              );
              return;
            }
          }

          soundSystem.playQuizCorrect();
          setPlayers((prev) =>
            prev.map((p) =>
              p.player_id === localProfile.id
                ? {
                    ...p,
                    large_treasure_unlocked: true,
                    score: p.score + SCORE_CONFIG.UNLOCK_LARGE_TREASURE,
                    coins: p.coins + SCORE_CONFIG.UNLOCK_LARGE_TREASURE,
                  }
                : p
            )
          );
          setLargeTreasureLockOpen(false);
          showToast(
            `Segel Large Treasure terbuka! (+${SCORE_CONFIG.UNLOCK_LARGE_TREASURE} Poin) — Hadapi 3 soal penentu!`
          );
          await openQuizChallenge({
            itemKey: match.map_configuration.largeTreasure.id,
            challengeKind: 'large_treasure',
            title: match.map_configuration.largeTreasure.name,
            region: match.map_configuration.largeTreasure.zone,
            questionCount: match.map_configuration.largeTreasure.questionCount,
          });
          return;
        }

        const res = await unlockLargeTreasureRpc(match.id, localProfile.id, submittedCodes);
        if (!res.unlocked) {
          soundSystem.playQuizWrong();
          setLargeLockError(res.message);
          return;
        }

        soundSystem.playQuizCorrect();
        setPlayers((prev) =>
          prev.map((p) =>
            p.player_id === localProfile.id
              ? {
                  ...p,
                  large_treasure_unlocked: true,
                  score: res.new_score,
                  coins: p.coins + res.points_awarded,
                }
              : p
          )
        );
        realtimeService.send('player:score_update', {});
        setLargeTreasureLockOpen(false);
        showToast(res.message);

        await openQuizChallenge({
          itemKey: match.map_configuration.largeTreasure.id,
          challengeKind: 'large_treasure',
          title: match.map_configuration.largeTreasure.name,
          region: match.map_configuration.largeTreasure.zone,
          questionCount: match.map_configuration.largeTreasure.questionCount,
        });
      } catch (err) {
        setLargeLockError(err instanceof Error ? err.message : 'Gagal membuka segel');
      } finally {
        setLargeLockSubmitting(false);
      }
    },
    [
      isSoloPractice,
      largeLockSubmitting,
      localProfile.id,
      localState,
      match.id,
      match.map_configuration.largeTreasure,
      match.map_configuration.smallChests,
      openQuizChallenge,
      showToast,
    ]
  );

  const showMobileControls = isTouchDevice || settings.forceMobileControls;
  const showPortraitHint = showMobileControls && viewport.isPortrait && !landscapeHintDismissed;

  return (
    <div className="relative viewport-full overflow-hidden bg-[#136d85] touch-surface select-none">
      {/* Isolated 60fps Phaser World */}
      <PhaserGame matchKey={match.id} />

      {/* Non-blocking Portrait Orientation Hint on Mobile */}
      {showPortraitHint && (
        <div className="fixed bottom-32 left-3 right-3 z-30 flex justify-center pointer-events-none safe-inset">
          <div className="pointer-events-auto pixel-panel px-3 py-2 flex items-center justify-between gap-2.5 max-w-md w-full text-xs text-slate-100">
            <div className="flex items-center gap-2 min-w-0">
              <RotateCw className="w-4 h-4 text-amber-300 shrink-0" />
              <span className="leading-snug">
                Gunakan posisi <strong className="text-amber-300">Landscape</strong> untuk kontrol
                terbaik.
              </span>
            </div>
            <div className="flex items-center gap-1.5 shrink-0">
              {!isFullscreen && !isStandalone && (
                <button
                  type="button"
                  onClick={() => {
                    soundSystem.playClick();
                    void onEnterFullscreenLandscape();
                  }}
                  className="pixel-btn px-2.5 py-1.5 bg-amber-500 text-slate-950 font-bold text-[11px] cursor-pointer whitespace-nowrap"
                >
                  Layar Penuh
                </button>
              )}
              <button
                type="button"
                onClick={() => setLandscapeHintDismissed(true)}
                className="p-1.5 text-slate-400 hover:text-white cursor-pointer"
                aria-label="Tutup saran orientasi"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Non-Occluding Perimeter HUD */}
      {localState && (
        <InGameHud
          username={localProfile.username}
          difficulty={match.difficulty}
          localState={localState}
          biome={biome}
          chunkCoord={chunkCoord}
          discoveredBiomes={discoveredBiomes}
          minimap={minimap}
          mapConfig={match.map_configuration}
          settings={settings}
          respawnSecondsLeft={respawnSecondsLeft}
          npcDialogue={npcDialogue}
          toastMessage={toastMessage}
          proximityHint={proximityHint}
          isTouchUi={showMobileControls}
          isFullscreen={isFullscreen}
          isStandalone={isStandalone}
          onToggleFullscreen={onToggleFullscreen}
          onUseApple={handleUseApple}
          onOpenInventory={() => setInventoryOpen(true)}
          onTogglePause={() => setPauseOpen((p) => !p)}
          onToggleMute={() => {
            const next = { ...settings, muted: !settings.muted };
            soundSystem.setMuted(next.muted);
            onUpdateSettings(next);
          }}
          onDismissNpc={() => setNpcDialogue(null)}
        />
      )}

      {/* Touch Controls for Mobile Landscape */}
      {showMobileControls &&
        !activeQuiz &&
        !largeTreasureLockOpen &&
        !inventoryOpen &&
        !pauseOpen && (
          <MobileControls
            canInteract={Boolean(proximityHint)}
            interactLabel={proximityHint?.label ?? null}
            canUseApple={
              Boolean(localState) &&
              !localState.is_dead &&
              localState.apples > 0 &&
              localState.health < COMBAT_CONFIG.MAX_HEALTH
            }
            applesCount={localState?.apples ?? 0}
            onUseApple={handleUseApple}
          />
        )}

      {/* Multi-Question Educational Quiz Modal */}
      {activeQuiz && (
        <QuizModal
          challenge={activeQuiz}
          isSubmitting={quizSubmitting}
          result={quizResult}
          onSelectAnswer={handleSubmitQuiz}
          onNextQuestion={handleNextQuizQuestion}
          onRetryWrongQuestion={handleRetryWrongQuestion}
          onClose={() => {
            setActiveQuiz(null);
            setQuizResult(null);
          }}
        />
      )}

      {/* Stage 2 Large Treasure Fragment Combination Lock Modal */}
      {largeTreasureLockOpen && localState && (
        <LargeTreasureModal
          smallChests={match.map_configuration.smallChests}
          completedSmallChests={localState.completed_small_chests}
          collectedFragments={localState.collected_fragments}
          isSubmitting={largeLockSubmitting}
          errorMessage={largeLockError}
          onSubmitCodes={handleSubmitLargeTreasureCodes}
          onClose={() => {
            setLargeTreasureLockOpen(false);
            setLargeLockError(null);
          }}
        />
      )}

      {/* Adventure Journal & Inventory Modal */}
      {inventoryOpen && localState && (
        <InventoryModal
          localState={localState}
          allPlayers={players}
          mapConfig={match.map_configuration}
          discoveredBiomes={discoveredBiomes}
          onUseApple={handleUseApple}
          onClose={() => setInventoryOpen(false)}
        />
      )}

      {/* Pause Modal */}
      {pauseOpen && !subModal && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/75 p-4">
          <div className="pixel-panel w-full max-w-sm p-6 text-center space-y-4">
            <h2 className="font-display text-2xl font-bold text-amber-300">Ekspedisi Dijeda</h2>
            <div className="space-y-2.5">
              <button
                type="button"
                onClick={() => setPauseOpen(false)}
                className="pixel-btn w-full min-h-[44px] inline-flex items-center justify-center gap-2 px-4 py-3 bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-sm cursor-pointer"
              >
                <Play className="w-4 h-4 fill-current" />
                Lanjutkan Pertandingan
              </button>
              {!isStandalone && (
                <div className="w-full [&>button]:w-full">
                  <FullscreenButton
                    isFullscreen={isFullscreen}
                    isStandalone={isStandalone}
                    lockLandscape={true}
                    onToggle={onToggleFullscreen}
                  />
                </div>
              )}
              <button
                type="button"
                onClick={() => setSubModal('settings')}
                className="pixel-btn w-full min-h-[44px] inline-flex items-center justify-center gap-2 px-4 py-2.5 bg-slate-800 hover:bg-slate-700 border border-slate-600 text-sm cursor-pointer"
              >
                <Settings className="w-4 h-4" />
                Pengaturan
              </button>
              <button
                type="button"
                onClick={() => setSubModal('howto')}
                className="pixel-btn w-full min-h-[44px] inline-flex items-center justify-center gap-2 px-4 py-2.5 bg-slate-800 hover:bg-slate-700 border border-slate-600 text-sm cursor-pointer"
              >
                <BookOpen className="w-4 h-4" />
                Panduan Bermain
              </button>
              <button
                type="button"
                onClick={onExitMatch}
                className="pixel-btn w-full min-h-[44px] inline-flex items-center justify-center gap-2 px-4 py-2.5 bg-red-950/80 hover:bg-red-900 border border-red-700 text-red-200 text-sm cursor-pointer"
              >
                <LogOut className="w-4 h-4" />
                Keluar Ekspedisi
              </button>
            </div>
          </div>
        </div>
      )}

      {subModal === 'settings' && (
        <SettingsModal
          settings={settings}
          onChange={onUpdateSettings}
          onClose={() => setSubModal(null)}
        />
      )}
      {subModal === 'howto' && <HowToPlayModal onClose={() => setSubModal(null)} />}
    </div>
  );
}
