import { useCallback, useEffect, useRef, useState } from 'react';
import { gameBridge } from './game/GameBridge';
import { generateMatchConfiguration } from './game/maps/MapGenerator';
import { generateMatchSeed } from './game/systems/RandomizationSystem';
import { soundSystem } from './game/systems/SoundSystem';
import { useFullscreen } from './hooks/useFullscreen';
import { useVisualViewport } from './hooks/useVisualViewport';
import {
  fetchLatestMatchForRoom,
  fetchMatchBundle,
  playAgainMultiplayerMatch,
  startMultiplayerMatch,
} from './multiplayer/matchService';
import { realtimeService } from './multiplayer/realtimeService';
import {
  createPlayerProfile,
  createRoom,
  fetchRoomState,
  joinRoom,
  leaveRoom,
  rejoinSession,
  setRoomDifficulty,
  setRoomPlayerConnected,
  transferHostOnDisconnect,
} from './multiplayer/roomService';
import { CharacterSetup } from './pages/CharacterSetup';
import { GamePage } from './pages/GamePage';
import { Lobby } from './pages/Lobby';
import { MainMenu } from './pages/MainMenu';
import { ResultPage } from './pages/ResultPage';
import {
  clearPlayerSession,
  restorePlayerSession,
  setPlayerSession,
  tryGetPlayerSessionToken,
} from './services/playerSession';
import { resetSoloQuestionHistory } from './services/questionService';
import {
  ensureSupabaseReady,
  getIsSupabaseConfigured,
  initSupabaseRuntime,
  SupabaseConfigReason,
} from './services/supabase';
import {
  AppScreen,
  CharacterId,
  EducationLevel,
  GameSettings,
  MatchPlayerState,
  MatchRecord,
  PlayerProfile,
  RoomPlayerRecord,
  RoomRecord,
} from './types/game';

const SESSION_STORAGE_KEY = 'treasurebound_session_v1';

interface PersistedSession {
  profile: PlayerProfile;
  sessionToken?: string;
  roomId: string;
  roomCode: string;
  matchId: string | null;
  screen: 'LOBBY' | 'PLAYING' | 'RESULTS';
}

function savePersistedSession(session: PersistedSession) {
  try {
    window.sessionStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(session));
  } catch {
    // ignore storage quota errors
  }
}

function loadPersistedSession(): PersistedSession | null {
  try {
    const raw = window.sessionStorage.getItem(SESSION_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<PersistedSession>;
    if (!parsed.profile?.id || !parsed.roomId || !parsed.roomCode) return null;
    return {
      profile: parsed.profile,
      sessionToken: parsed.sessionToken,
      roomId: parsed.roomId,
      roomCode: parsed.roomCode,
      matchId: parsed.matchId ?? null,
      screen: parsed.screen ?? 'LOBBY',
    };
  } catch {
    return null;
  }
}

function clearPersistedSession() {
  try {
    window.sessionStorage.removeItem(SESSION_STORAGE_KEY);
  } catch {
    // ignore
  }
}

export default function App() {
  const [screen, setScreen] = useState<AppScreen>('MAIN_MENU');
  const [settings, setSettings] = useState<GameSettings>({
    muted: false,
    showMinimap: true,
    forceMobileControls: false,
  });

  useVisualViewport();
  const fullscreen = useFullscreen();

  useEffect(() => {
    const isPlaying = screen === 'PLAYING';
    document.documentElement.classList.toggle('gameplay-lock', isPlaying);
    document.body.classList.toggle('gameplay-lock', isPlaying);
    return () => {
      document.documentElement.classList.remove('gameplay-lock');
      document.body.classList.remove('gameplay-lock');
    };
  }, [screen]);

  const [savedName, setSavedName] = useState('');
  const [savedChar, setSavedChar] = useState<CharacterId>('kai');

  const [localProfile, setLocalProfile] = useState<PlayerProfile | null>(null);
  const [room, setRoom] = useState<RoomRecord | null>(null);
  const [roomPlayers, setRoomPlayers] = useState<RoomPlayerRecord[]>([]);
  const [onlinePlayerIds, setOnlinePlayerIds] = useState<string[]>([]);
  const [hasPresenceSynced, setHasPresenceSynced] = useState(false);
  const [realtimeState, setRealtimeState] = useState<'connected' | 'reconnecting' | 'disconnected'>(
    'connected'
  );
  const [countdownSeconds, setCountdownSeconds] = useState<number | null>(null);

  const [activeMatch, setActiveMatch] = useState<MatchRecord | null>(null);
  const [matchPlayers, setMatchPlayers] = useState<MatchPlayerState[]>([]);
  const [isSoloPractice, setIsSoloPractice] = useState(false);

  const [isBusy, setIsBusy] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const [supabaseReady, setSupabaseReady] = useState(false);
  const [supabaseConfigured, setSupabaseConfigured] = useState(false);
  const [supabaseConfigReason, setSupabaseConfigReason] = useState<SupabaseConfigReason | undefined>(
    undefined
  );

  const countdownTimerRef = useRef<number | null>(null);
  const countdownSecondsRef = useRef<number | null>(null);
  countdownSecondsRef.current = countdownSeconds;
  const lastLaunchedMatchIdRef = useRef<string | null>(null);
  const disconnectTimersRef = useRef<Map<string, number>>(new Map());
  const roomPlayersRef = useRef<RoomPlayerRecord[]>([]);
  roomPlayersRef.current = roomPlayers;
  const sessionRestoreAttemptedRef = useRef(false);

  const refreshSupabaseStatus = useCallback(async (forceRefresh = false) => {
    setSupabaseReady(false);
    const result = await initSupabaseRuntime(forceRefresh);
    setSupabaseConfigured(result.configured);
    setSupabaseConfigReason(result.reason);
    setSupabaseReady(true);
    return result;
  }, []);

  useEffect(() => {
    void refreshSupabaseStatus(false);
  }, [refreshSupabaseStatus]);

  const clearCountdownTimer = useCallback(() => {
    if (countdownTimerRef.current) {
      window.clearInterval(countdownTimerRef.current);
      countdownTimerRef.current = null;
    }
    setCountdownSeconds(null);
  }, []);

  const clearDisconnectTimers = useCallback(() => {
    disconnectTimersRef.current.forEach((timerId) => window.clearTimeout(timerId));
    disconnectTimersRef.current.clear();
  }, []);

  const handleUpdateSettings = useCallback((next: GameSettings) => {
    setSettings(next);
    soundSystem.setMuted(next.muted);
  }, []);

  const launchMatchIntoBridge = useCallback(
    (
      match: MatchRecord,
      players: MatchPlayerState[],
      claimedItems: Record<string, string>,
      profile: PlayerProfile,
      solo: boolean
    ) => {
      if (!solo && lastLaunchedMatchIdRef.current === match.id) {
        return;
      }
      if (!solo) {
        lastLaunchedMatchIdRef.current = match.id;
      }
      clearCountdownTimer();
      const sorted = [...players].sort((a, b) => a.player_id.localeCompare(b.player_id));
      const localIdx = Math.max(
        0,
        sorted.findIndex((p) => p.player_id === profile.id)
      );
      const localState = sorted.find((p) => p.player_id === profile.id);

      gameBridge.setConfig({
        matchId: match.id,
        playerId: profile.id,
        username: profile.username,
        characterId: profile.character_id,
        spawnIndex: localIdx,
        mapConfig: match.map_configuration,
        initialClaimedItems: claimedItems,
        initialProgress: {
          completedSmallChests: localState?.completed_small_chests ?? [],
          completedChallenges: localState?.completed_challenges ?? [],
          unlockedGates: localState?.unlocked_gates ?? [],
          activatedSwitches: localState?.activated_switches ?? [],
          hasSecretKey: Boolean(localState?.has_secret_key),
          largeTreasureUnlocked: Boolean(localState?.large_treasure_unlocked),
          largeTreasureCompleted: Boolean(localState?.large_treasure_completed),
        },
        initialPosition:
          typeof localState?.last_x === 'number' && typeof localState?.last_y === 'number'
            ? { x: localState.last_x, y: localState.last_y }
            : null,
        initialPlayers: sorted.map((p, idx) => ({
          playerId: p.player_id,
          username: p.username ?? 'Penjelajah',
          characterId: p.character_id ?? 'kai',
          health: p.health,
          isDead: p.is_dead,
          spawnIndex: idx,
        })),
        isSoloPractice: solo,
      });

      setActiveMatch(match);
      setMatchPlayers(players);
      setIsSoloPractice(solo);
      setScreen('PLAYING');
    },
    [clearCountdownTimer]
  );

  const connectRoomChannel = useCallback(
    async (targetRoom: RoomRecord, profile: PlayerProfile) => {
      setHasPresenceSynced(false);
      setRealtimeState('connected');
      clearDisconnectTimers();

      const enterMatchById = async (matchId: string) => {
        if (lastLaunchedMatchIdRef.current === matchId) return;
        try {
          const bundle = await fetchMatchBundle(matchId);
          if (bundle.match.status === 'PLAYING') {
            launchMatchIntoBridge(
              bundle.match,
              bundle.players,
              bundle.claimedItems,
              profile,
              false
            );
          }
        } catch (err) {
          console.warn('enterMatchById warning:', err);
        }
      };

      const refreshRoom = async () => {
        try {
          const state = await fetchRoomState(targetRoom.id, { onlyConnected: true });
          if (state.room) {
            setRoom(state.room);
            if (state.room.status === 'PLAYING' && !lastLaunchedMatchIdRef.current) {
              const latest = await fetchLatestMatchForRoom(targetRoom.id).catch(() => null);
              if (latest && latest.status === 'PLAYING') {
                await enterMatchById(latest.id);
              }
            }
          }
          setRoomPlayers(state.players.filter((rp) => rp.is_connected));
        } catch (err) {
          console.warn('refreshRoom warning:', err);
        }
      };

      // Load initial database room_players immediately without waiting for Realtime WebSocket handshake
      await refreshRoom();

      const handlePresenceLeave = (leftId: string, isRetry = false) => {
        const existingTimer = disconnectTimersRef.current.get(leftId);
        if (existingTimer) window.clearTimeout(existingTimer);

        const delayMs = isRetry ? 11500 : 1500;
        const timerId = window.setTimeout(async () => {
          disconnectTimersRef.current.delete(leftId);
          if (realtimeService.getOnlinePlayerIds().includes(leftId)) {
            return;
          }
          try {
            const latest = await fetchRoomState(targetRoom.id).catch(() => null);
            if (
              countdownSecondsRef.current !== null &&
              latest?.room?.host_player_id === leftId
            ) {
              clearCountdownTimer();
              setIsBusy(false);
              setErrorMessage('Host terputus saat hitung mundur. Silakan mulai ulang.');
            }
            const nextHostId = await transferHostOnDisconnect(targetRoom.id, leftId, profile.id);
            await refreshRoom();

            // If target was still inside the 12s server liveness grace window (e.g. abrupt crash
            // without pagehide), schedule one follow-up check after the grace window expires.
            if (!isRetry && latest?.room?.host_player_id === leftId && nextHostId === leftId) {
              handlePresenceLeave(leftId, true);
            }
          } catch (err) {
            console.warn('presence leave recovery warning:', err);
          }
        }, delayMs);

        disconnectTimersRef.current.set(leftId, timerId);
      };

      try {
        await realtimeService.connect(
          targetRoom.id,
          targetRoom.room_code,
          {
            playerId: profile.id,
            username: profile.username,
            characterId: profile.character_id,
          },
          {
            onPresenceSync: (ids) => {
              setHasPresenceSynced(true);
              setOnlinePlayerIds(ids);
              ids.forEach((onlineId) => {
                const t = disconnectTimersRef.current.get(onlineId);
                if (t) {
                  window.clearTimeout(t);
                  disconnectTimersRef.current.delete(onlineId);
                }
              });
              const meRow = roomPlayersRef.current.find((rp) => rp.player_id === profile.id);
              if (ids.includes(profile.id) && (!meRow || !meRow.is_connected)) {
                void setRoomPlayerConnected(targetRoom.id, profile.id, true).then((updated) => {
                  if (updated) {
                    void refreshRoom();
                  }
                });
              }
            },
            onPlayerJoinPresence: () => {
              void refreshRoom();
            },
            onPlayerLeavePresence: handlePresenceLeave,
            onDbRoomUpdated: refreshRoom,
            onMatchCountdown: ({ countdownSeconds: sec }) => {
              setCountdownSeconds(sec > 0 ? sec : null);
            },
            onMatchStarted: async ({ matchId }) => {
              await enterMatchById(matchId);
            },
            onDbMatchUpdated: async (matchId, status) => {
              if (status === 'PLAYING') {
                await enterMatchById(matchId);
              }
            },
            onConnectionStateChange: (state) => {
              setRealtimeState(state);
            },
            onReconnected: async () => {
              await refreshRoom();
              const latest = await fetchLatestMatchForRoom(targetRoom.id).catch(() => null);
              if (
                latest &&
                latest.status === 'PLAYING' &&
                lastLaunchedMatchIdRef.current !== latest.id
              ) {
                await enterMatchById(latest.id);
              }
            },
          }
        );

        await refreshRoom();
      } catch (err) {
        console.warn('Realtime connect fallback warning:', err);
        setRealtimeState('reconnecting');
      }
    },
    [clearCountdownTimer, clearDisconnectTimers, launchMatchIntoBridge]
  );

  // Persist active multiplayer session in sessionStorage for refresh recovery
  useEffect(() => {
    if (
      !isSoloPractice &&
      localProfile &&
      localProfile.id !== 'unconfigured' &&
      room &&
      (screen === 'LOBBY' || screen === 'PLAYING' || screen === 'RESULTS')
    ) {
      savePersistedSession({
        profile: localProfile,
        sessionToken: tryGetPlayerSessionToken(localProfile.id) ?? undefined,
        roomId: room.id,
        roomCode: room.room_code,
        matchId: activeMatch?.id ?? null,
        screen,
      });
    }
  }, [isSoloPractice, localProfile, room, activeMatch?.id, screen]);

  // Reliable DB refetch fallback while waiting in Lobby so room_players stays in sync even if Realtime misses an event
  const activeRoomId = room?.id ?? null;
  const activeProfileId = localProfile?.id ?? null;
  useEffect(() => {
    if (
      screen !== 'LOBBY' ||
      isSoloPractice ||
      !activeRoomId ||
      !localProfile ||
      localProfile.id === 'unconfigured'
    ) {
      return;
    }

    let cancelled = false;
    const syncLobbyState = async () => {
      if (cancelled || document.visibilityState === 'hidden') return;
      try {
        const state = await fetchRoomState(activeRoomId, { onlyConnected: true });
        if (cancelled) return;
        const fetchedRoom = state.room;
        if (fetchedRoom) {
          setRoom((prev) => {
            if (
              prev &&
              prev.id === fetchedRoom.id &&
              prev.status === fetchedRoom.status &&
              prev.host_player_id === fetchedRoom.host_player_id &&
              prev.difficulty === fetchedRoom.difficulty &&
              prev.max_players === fetchedRoom.max_players &&
              prev.expires_at === fetchedRoom.expires_at
            ) {
              return prev;
            }
            return fetchedRoom;
          });
          if (fetchedRoom.status === 'PLAYING' && !lastLaunchedMatchIdRef.current) {
            const latest = await fetchLatestMatchForRoom(activeRoomId).catch(() => null);
            if (!cancelled && latest && latest.status === 'PLAYING') {
              const bundle = await fetchMatchBundle(latest.id);
              if (!cancelled && bundle.match.status === 'PLAYING') {
                launchMatchIntoBridge(
                  bundle.match,
                  bundle.players,
                  bundle.claimedItems,
                  localProfile,
                  false
                );
              }
            }
          }
        }
        setRoomPlayers(state.players.filter((rp) => rp.is_connected));
      } catch {
        // ignore transient fallback poll error
      }
    };

    void syncLobbyState();
    const timer = window.setInterval(() => {
      void syncLobbyState();
    }, 2500);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [screen, isSoloPractice, activeRoomId, localProfile, launchMatchIntoBridge]);

  // Authenticated heartbeat & graceful disconnect reporting so active hosts cannot be hijacked
  useEffect(() => {
    if (isSoloPractice || !activeRoomId || !activeProfileId || activeProfileId === 'unconfigured') {
      return;
    }

    const sendHeartbeat = () => {
      if (document.visibilityState === 'hidden') return;
      void setRoomPlayerConnected(activeRoomId, activeProfileId, true);
    };

    sendHeartbeat();
    const heartbeatTimer = window.setInterval(sendHeartbeat, 5000);
    const onVisibility = () => {
      if (document.visibilityState === 'visible') {
        sendHeartbeat();
      }
    };
    const onPageHide = () => {
      void setRoomPlayerConnected(activeRoomId, activeProfileId, false);
    };

    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pagehide', onPageHide);
    return () => {
      window.clearInterval(heartbeatTimer);
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pagehide', onPageHide);
    };
  }, [isSoloPractice, activeRoomId, activeProfileId]);

  // Recover multiplayer session automatically after page reload when Supabase is configured
  useEffect(() => {
    if (!supabaseReady || !supabaseConfigured || sessionRestoreAttemptedRef.current) return;
    sessionRestoreAttemptedRef.current = true;

    const saved = loadPersistedSession();
    if (!saved) return;

    const storedAuth = restorePlayerSession();
    const tokenForProfile =
      storedAuth && storedAuth.playerId === saved.profile.id
        ? storedAuth.sessionToken
        : saved.sessionToken;

    if (!tokenForProfile) {
      clearPersistedSession();
      clearPlayerSession();
      return;
    }

    setPlayerSession(saved.profile.id, tokenForProfile);

    let cancelled = false;
    (async () => {
      setIsBusy(true);
      try {
        let restoredRoom: RoomRecord | null = null;
        let latestMatchId: string | null = saved.matchId;
        let latestMatchStatus: string | null = null;

        const rejoinRes = await rejoinSession(saved.roomId, saved.profile.id);
        if (rejoinRes.ok && rejoinRes.room) {
          restoredRoom = rejoinRes.room;
          latestMatchId = rejoinRes.latest_match_id ?? saved.matchId;
          latestMatchStatus = rejoinRes.latest_match_status ?? null;
        } else {
          clearPersistedSession();
          clearPlayerSession();
          return;
        }

        if (cancelled) return;
        if (!restoredRoom) {
          clearPersistedSession();
          return;
        }

        setSavedName(saved.profile.username);
        setSavedChar(saved.profile.character_id);
        setLocalProfile(saved.profile);
        setRoom(restoredRoom);
        await connectRoomChannel(restoredRoom, saved.profile);

        if (cancelled) return;

        if (latestMatchId && latestMatchStatus === 'PLAYING') {
          const bundle = await fetchMatchBundle(latestMatchId);
          if (!cancelled) {
            launchMatchIntoBridge(
              bundle.match,
              bundle.players,
              bundle.claimedItems,
              saved.profile,
              false
            );
          }
          return;
        }

        if (latestMatchId && latestMatchStatus === 'FINISHED' && saved.screen === 'RESULTS') {
          const bundle = await fetchMatchBundle(latestMatchId);
          if (!cancelled) {
            setActiveMatch(bundle.match);
            setMatchPlayers(bundle.players);
            setIsSoloPractice(false);
            setScreen('RESULTS');
          }
          return;
        }

        setScreen('LOBBY');
      } catch {
        clearPersistedSession();
      } finally {
        if (!cancelled) setIsBusy(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [supabaseReady, supabaseConfigured, connectRoomChannel, launchMatchIntoBridge]);

  // Character setup -> Multiplayer Lobby
  const handleContinueMultiplayer = async (username: string, characterId: CharacterId) => {
    setSavedName(username);
    setSavedChar(characterId);
    setErrorMessage(null);
    setIsBusy(true);

    try {
      const runtimeStatus = supabaseReady
        ? { configured: supabaseConfigured, reason: supabaseConfigReason }
        : await ensureSupabaseReady();

      setSupabaseConfigured(runtimeStatus.configured);
      setSupabaseConfigReason(runtimeStatus.reason);
      setSupabaseReady(true);

      if (!runtimeStatus.configured) {
        setLocalProfile({ id: 'unconfigured', username, character_id: characterId });
        setScreen('LOBBY');
        return;
      }

      const profile = await createPlayerProfile(username, characterId);
      setLocalProfile(profile);
      setScreen('LOBBY');
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Gagal membuat profil penjelajah');
    } finally {
      setIsBusy(false);
    }
  };

  // Character setup -> Solo Offline Training
  const handleStartSoloPractice = (
    username: string,
    characterId: CharacterId,
    difficulty: EducationLevel = 'SMA'
  ) => {
    clearPersistedSession();
    clearPlayerSession();
    lastLaunchedMatchIdRef.current = null;
    setSavedName(username);
    setSavedChar(characterId);
    resetSoloQuestionHistory();

    const profile: PlayerProfile = {
      id: `solo_${Date.now()}`,
      username,
      character_id: characterId,
    };
    const seed = generateMatchSeed();
    const mapConfig = generateMatchConfiguration(seed, difficulty);
    const soloMatch: MatchRecord = {
      id: `solo_match_${Date.now()}`,
      room_id: 'solo',
      seed,
      difficulty,
      status: 'PLAYING',
      winner_player_id: null,
      started_at: new Date().toISOString(),
      finished_at: null,
      map_configuration: mapConfig,
    };
    const soloPlayer: MatchPlayerState = {
      id: 'mp_solo',
      match_id: soloMatch.id,
      player_id: profile.id,
      username: profile.username,
      character_id: profile.character_id,
      health: 100,
      apples: 0,
      coins: 0,
      score: 0,
      correct_answers: 0,
      incorrect_answers: 0,
      total_attacks: 0,
      opened_chests: 0,
      completed_small_chests: [],
      collected_fragments: [],
      completed_challenges: [],
      unlocked_gates: [],
      activated_switches: [],
      has_secret_key: false,
      large_treasure_unlocked: false,
      large_treasure_completed: false,
      clues_found: 0,
      is_dead: false,
      respawn_at: null,
      invulnerable_until: null,
    };

    setLocalProfile(profile);
    launchMatchIntoBridge(soloMatch, [soloPlayer], {}, profile, true);
  };

  const handleCreateRoom = async (difficulty: EducationLevel) => {
    if (!localProfile) return;
    setIsBusy(true);
    setErrorMessage(null);
    try {
      const newRoom = await createRoom(localProfile.id, difficulty);
      setRoom(newRoom);
      await connectRoomChannel(newRoom, localProfile);
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Gagal membuat room');
    } finally {
      setIsBusy(false);
    }
  };

  const handleChangeDifficulty = async (difficulty: EducationLevel) => {
    if (!room || !localProfile) return;
    setErrorMessage(null);
    try {
      const updated = await setRoomDifficulty(room.id, localProfile.id, difficulty);
      setRoom(updated);
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Gagal mengubah tingkat pendidikan');
    }
  };

  const handleJoinRoom = async (roomCode: string) => {
    if (!localProfile) return;
    setIsBusy(true);
    setErrorMessage(null);
    try {
      const joined = await joinRoom(roomCode, localProfile.id);
      setRoom(joined);
      await connectRoomChannel(joined, localProfile);
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Gagal bergabung ke room');
    } finally {
      setIsBusy(false);
    }
  };

  const handleLeaveRoom = async () => {
    clearCountdownTimer();
    clearDisconnectTimers();
    clearPersistedSession();
    lastLaunchedMatchIdRef.current = null;
    await realtimeService.unsubscribeFromMatch();
    if (room && localProfile && getIsSupabaseConfigured()) {
      await leaveRoom(room.id, localProfile.id);
    }
    await realtimeService.disconnect();
    setRoom(null);
    setRoomPlayers([]);
    setOnlinePlayerIds([]);
    setHasPresenceSynced(false);
    setRealtimeState('connected');
    setErrorMessage(null);
  };

  const handleStartMultiplayerMatch = async () => {
    if (!room || !localProfile || isBusy || countdownSeconds !== null) return;
    setIsBusy(true);
    setErrorMessage(null);

    try {
      // Synchronized 3-2-1 countdown across all players in the lobby
      let remaining = 3;
      setCountdownSeconds(remaining);
      await realtimeService.send('match:countdown', {
        countdownSeconds: remaining,
        startedBy: localProfile.id,
      });

      await new Promise<void>((resolve) => {
        countdownTimerRef.current = window.setInterval(async () => {
          remaining -= 1;
          if (remaining <= 0) {
            if (countdownTimerRef.current) {
              window.clearInterval(countdownTimerRef.current);
              countdownTimerRef.current = null;
            }
            resolve();
            return;
          }
          setCountdownSeconds(remaining);
          await realtimeService.send('match:countdown', {
            countdownSeconds: remaining,
            startedBy: localProfile.id,
          });
        }, 850);
      });

      const match = await startMultiplayerMatch(room.id, localProfile.id, room.difficulty);
      await realtimeService.send('match:started', { matchId: match.id });
      const bundle = await fetchMatchBundle(match.id);
      launchMatchIntoBridge(bundle.match, bundle.players, bundle.claimedItems, localProfile, false);
    } catch (err) {
      clearCountdownTimer();
      setErrorMessage(err instanceof Error ? err.message : 'Gagal memulai pertandingan');
    } finally {
      setIsBusy(false);
    }
  };

  const handleMatchFinished = useCallback(
    async (winnerPlayerId: string, fallbackPlayers: MatchPlayerState[]) => {
      if (!activeMatch) return;
      if (isSoloPractice) {
        setActiveMatch({
          ...activeMatch,
          status: 'FINISHED',
          winner_player_id: winnerPlayerId,
          finished_at: new Date().toISOString(),
        });
        setMatchPlayers(fallbackPlayers);
        setScreen('RESULTS');
        return;
      }

      let bundle = await fetchMatchBundle(activeMatch.id).catch(() => null);
      if (!bundle) {
        await new Promise((r) => window.setTimeout(r, 400));
        bundle = await fetchMatchBundle(activeMatch.id).catch(() => null);
      }

      if (bundle) {
        setActiveMatch(bundle.match);
        setMatchPlayers(bundle.players);
      } else {
        setActiveMatch({
          ...activeMatch,
          status: 'FINISHED',
          winner_player_id: winnerPlayerId,
          finished_at: new Date().toISOString(),
        });
        setMatchPlayers(fallbackPlayers);
      }
      setScreen('RESULTS');
    },
    [activeMatch, isSoloPractice]
  );

  // Listen on ResultPage for host triggering Play Again & preserve room/host updates
  useEffect(() => {
    if (screen !== 'RESULTS' || isSoloPractice || !room || !localProfile) return;

    const refreshRoom = async () => {
      try {
        const state = await fetchRoomState(room.id);
        if (state.room) setRoom(state.room);
        setRoomPlayers(state.players);
      } catch (err) {
        console.warn('ResultPage refreshRoom warning:', err);
      }
    };

    const launchNextMatch = async (matchId: string) => {
      if (lastLaunchedMatchIdRef.current === matchId) return;
      try {
        const bundle = await fetchMatchBundle(matchId);
        if (bundle.match.status === 'PLAYING') {
          launchMatchIntoBridge(
            bundle.match,
            bundle.players,
            bundle.claimedItems,
            localProfile,
            false
          );
        }
      } catch (err) {
        setErrorMessage(err instanceof Error ? err.message : 'Gagal memuat pertandingan baru');
      }
    };

    realtimeService.updateCallbacks({
      onDbRoomUpdated: refreshRoom,
      onPlayerLeavePresence: async (leftId) => {
        try {
          const nextHostId = await transferHostOnDisconnect(room.id, leftId, localProfile.id);
          await refreshRoom();
          if (room.host_player_id === leftId && nextHostId === leftId) {
            window.setTimeout(async () => {
              if (!realtimeService.getOnlinePlayerIds().includes(leftId)) {
                await transferHostOnDisconnect(room.id, leftId, localProfile.id);
                await refreshRoom();
              }
            }, 12500);
          }
        } catch (err) {
          console.warn('ResultPage host transfer warning:', err);
        }
      },
      onMatchStarted: async ({ matchId }) => {
        await launchNextMatch(matchId);
      },
      onDbMatchUpdated: async (matchId, status) => {
        if (status === 'PLAYING') {
          await launchNextMatch(matchId);
        }
      },
      onReconnected: async () => {
        await refreshRoom();
        const latest = await fetchLatestMatchForRoom(room.id).catch(() => null);
        if (latest && latest.status === 'PLAYING') {
          await launchNextMatch(latest.id);
        }
      },
    });
  }, [screen, isSoloPractice, room, localProfile, launchMatchIntoBridge]);

  const handlePlayAgain = async () => {
    if (!localProfile) return;
    setErrorMessage(null);
    const diff: EducationLevel = activeMatch?.difficulty ?? room?.difficulty ?? 'SMA';
    if (isSoloPractice) {
      handleStartSoloPractice(localProfile.username, localProfile.character_id, diff);
      return;
    }
    if (!room) return;
    setIsBusy(true);
    try {
      const nextMatch = await playAgainMultiplayerMatch(room.id, localProfile.id, diff);
      await realtimeService.send('match:started', { matchId: nextMatch.id });
      const bundle = await fetchMatchBundle(nextMatch.id);
      launchMatchIntoBridge(bundle.match, bundle.players, bundle.claimedItems, localProfile, false);
    } catch (err) {
      const latest = await fetchLatestMatchForRoom(room.id).catch(() => null);
      if (latest && latest.status === 'PLAYING') {
        try {
          const bundle = await fetchMatchBundle(latest.id);
          launchMatchIntoBridge(
            bundle.match,
            bundle.players,
            bundle.claimedItems,
            localProfile,
            false
          );
        } catch (innerErr) {
          setErrorMessage(
            innerErr instanceof Error ? innerErr.message : 'Gagal memuat pertandingan baru'
          );
        }
      } else {
        setErrorMessage(err instanceof Error ? err.message : 'Gagal memulai ulang pertandingan');
      }
    } finally {
      setIsBusy(false);
    }
  };

  const handleBackToMainMenu = async () => {
    await handleLeaveRoom();
    clearPlayerSession();
    gameBridge.setConfig(null);
    setLocalProfile(null);
    setActiveMatch(null);
    setMatchPlayers([]);
    setIsSoloPractice(false);
    setScreen('MAIN_MENU');
  };

  // Cleanup realtime & timers on unmount
  useEffect(() => {
    return () => {
      clearCountdownTimer();
      clearDisconnectTimers();
      void realtimeService.disconnect();
    };
  }, [clearCountdownTimer, clearDisconnectTimers]);

  if (screen === 'MAIN_MENU') {
    return (
      <MainMenu
        settings={settings}
        isFullscreen={fullscreen.isFullscreen}
        isStandalone={fullscreen.isStandalone}
        fullscreenNotice={fullscreen.notice}
        onDismissFullscreenNotice={fullscreen.dismissNotice}
        onToggleFullscreen={fullscreen.toggleFullscreen}
        onUpdateSettings={handleUpdateSettings}
        onPlay={() => {
          setErrorMessage(null);
          setScreen('CHARACTER_SETUP');
        }}
      />
    );
  }

  if (screen === 'CHARACTER_SETUP') {
    return (
      <CharacterSetup
        initialName={savedName}
        initialCharacter={savedChar}
        isSubmitting={isBusy}
        errorMessage={errorMessage}
        onBack={() => setScreen('MAIN_MENU')}
        onContinueMultiplayer={handleContinueMultiplayer}
        onStartSoloPractice={handleStartSoloPractice}
      />
    );
  }

  if (screen === 'LOBBY' && localProfile) {
    return (
      <Lobby
        localPlayer={localProfile}
        room={room}
        roomPlayers={roomPlayers}
        onlinePlayerIds={onlinePlayerIds}
        hasPresenceSynced={hasPresenceSynced}
        realtimeState={realtimeState}
        countdownSeconds={countdownSeconds}
        isBusy={isBusy}
        isSupabaseConfigured={supabaseConfigured}
        isCheckingSupabase={!supabaseReady}
        supabaseConfigReason={supabaseConfigReason}
        onRetrySupabaseCheck={async () => {
          const result = await refreshSupabaseStatus(true);
          if (result.configured && localProfile.id === 'unconfigured') {
            setIsBusy(true);
            setErrorMessage(null);
            try {
              const profile = await createPlayerProfile(
                localProfile.username,
                localProfile.character_id
              );
              setLocalProfile(profile);
            } catch (err) {
              setErrorMessage(
                err instanceof Error ? err.message : 'Gagal membuat profil penjelajah'
              );
            } finally {
              setIsBusy(false);
            }
          }
        }}
        errorMessage={errorMessage}
        isFullscreen={fullscreen.isFullscreen}
        isStandalone={fullscreen.isStandalone}
        fullscreenNotice={fullscreen.notice}
        onDismissFullscreenNotice={fullscreen.dismissNotice}
        onToggleFullscreen={fullscreen.toggleFullscreen}
        onBackToSetup={() => {
          clearPlayerSession();
          setLocalProfile(null);
          setErrorMessage(null);
          setScreen('CHARACTER_SETUP');
        }}
        onCreateRoom={handleCreateRoom}
        onChangeDifficulty={handleChangeDifficulty}
        onJoinRoom={handleJoinRoom}
        onLeaveRoom={handleLeaveRoom}
        onStartGame={handleStartMultiplayerMatch}
      />
    );
  }

  if (screen === 'PLAYING' && localProfile && activeMatch) {
    return (
      <GamePage
        localProfile={localProfile}
        match={activeMatch}
        initialPlayers={matchPlayers}
        isSoloPractice={isSoloPractice}
        settings={settings}
        isFullscreen={fullscreen.isFullscreen}
        isStandalone={fullscreen.isStandalone}
        onToggleFullscreen={fullscreen.toggleFullscreen}
        onEnterFullscreenLandscape={() => fullscreen.enterFullscreen(true)}
        onUpdateSettings={handleUpdateSettings}
        onMatchFinished={handleMatchFinished}
        onExitMatch={handleBackToMainMenu}
      />
    );
  }

  if (screen === 'RESULTS' && localProfile && activeMatch) {
    return (
      <ResultPage
        match={activeMatch}
        players={matchPlayers}
        localPlayerId={localProfile.id}
        isHost={room?.host_player_id === localProfile.id}
        isSoloPractice={isSoloPractice}
        isBusy={isBusy}
        errorMessage={errorMessage}
        onPlayAgain={handlePlayAgain}
        onBackToMenu={handleBackToMainMenu}
      />
    );
  }

  return null;
}
