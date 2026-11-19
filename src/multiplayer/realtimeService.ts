import { RealtimeChannel } from '@supabase/supabase-js';
import { requireSupabase } from '../services/supabase';
import { CharacterId, ProjectileBroadcast, RemotePlayerSync } from '../types/game';

export interface PresencePayload {
  playerId: string;
  username: string;
  characterId: CharacterId;
  onlineAt: string;
}

export interface RoomRealtimeCallbacks {
  onPresenceSync?: (onlinePlayerIds: string[]) => void;
  onPlayerJoinPresence?: (playerId: string, onlinePlayerIds: string[]) => void;
  onPlayerLeavePresence?: (playerId: string) => void;
  onDbRoomUpdated?: () => void;
  onDbMatchUpdated?: (matchId: string, status: string, winnerPlayerId: string | null) => void;
  onDbMatchPlayersUpdated?: () => void;
  onPlayerMove?: (payload: RemotePlayerSync) => void;
  onPlayerAttack?: (payload: ProjectileBroadcast) => void;
  onPlayerHit?: (payload: {
    targetId: string;
    attackerId: string;
    newHp: number;
    isDead: boolean;
    respawnAt: string | null;
  }) => void;
  onPlayerRespawn?: (payload: { playerId: string; health: number }) => void;
  onItemClaimed?: (payload: { itemKey: string; itemType: string; claimedBy: string }) => void;
  onMatchCountdown?: (payload: { countdownSeconds: number; startedBy: string }) => void;
  onMatchStarted?: (payload: { matchId: string }) => void;
  onMatchFinished?: (payload: { matchId: string; winnerPlayerId: string }) => void;
  onPlayerScoreUpdate?: () => void;
  onReconnected?: () => void;
  onConnectionStateChange?: (state: 'connected' | 'reconnecting' | 'disconnected') => void;
}

class RealtimeService {
  private channel: RealtimeChannel | null = null;
  private matchChannel: RealtimeChannel | null = null;
  private currentRoomId: string | null = null;
  private currentRoomCode: string | null = null;
  private currentMatchId: string | null = null;
  private localPlayer: { playerId: string; username: string; characterId: CharacterId } | null = null;
  private callbacks: RoomRealtimeCallbacks = {};
  private manualDisconnect = false;
  private reconnectTimer: number | null = null;
  private reconnectAttempt = 0;
  private connectGeneration = 0;
  private onlinePlayerIds: string[] = [];

  updateCallbacks(next: Partial<RoomRealtimeCallbacks>) {
    this.callbacks = { ...this.callbacks, ...next };
  }

  getOnlinePlayerIds(): string[] {
    return this.onlinePlayerIds;
  }

  private readPresenceIds(channel: RealtimeChannel): string[] {
    const state = channel.presenceState<PresencePayload>();
    const ids = new Set<string>();
    for (const [key, metas] of Object.entries(state)) {
      if (key) ids.add(key);
      if (Array.isArray(metas)) {
        for (const meta of metas) {
          if (meta?.playerId) ids.add(meta.playerId);
        }
      }
    }
    return Array.from(ids);
  }

  private syncPresenceFromChannel(channel: RealtimeChannel): string[] {
    const onlineIds = this.readPresenceIds(channel);
    this.onlinePlayerIds = onlineIds;
    this.callbacks.onPresenceSync?.(onlineIds);
    return onlineIds;
  }

  private clearReconnectTimer() {
    if (this.reconnectTimer !== null) {
      window.clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  private scheduleReconnect() {
    if (
      this.manualDisconnect ||
      this.reconnectTimer !== null ||
      !this.currentRoomId ||
      !this.currentRoomCode ||
      !this.localPlayer
    ) {
      return;
    }

    const delayMs = Math.min(12000, 1500 * Math.pow(2, this.reconnectAttempt));
    this.reconnectAttempt = Math.min(4, this.reconnectAttempt + 1);
    this.callbacks.onConnectionStateChange?.('reconnecting');

    this.reconnectTimer = window.setTimeout(async () => {
      this.reconnectTimer = null;
      if (
        this.manualDisconnect ||
        !this.currentRoomId ||
        !this.currentRoomCode ||
        !this.localPlayer
      ) {
        return;
      }

      const roomId = this.currentRoomId;
      const roomCode = this.currentRoomCode;
      const player = this.localPlayer;
      const savedMatchId = this.currentMatchId;

      try {
        await this.teardownChannelsOnly();
        await this.establishRoomChannel(roomId, roomCode, player, false);
        if (savedMatchId) {
          await this.subscribeToMatch(savedMatchId);
        }
        this.reconnectAttempt = 0;
        this.callbacks.onConnectionStateChange?.('connected');
        this.callbacks.onReconnected?.();
      } catch {
        this.scheduleReconnect();
      }
    }, delayMs);
  }

  private async safeRemoveChannel(channel: RealtimeChannel | null, untrackFirst = false) {
    if (!channel) return;
    if (untrackFirst) {
      try {
        await channel.untrack();
      } catch {
        // ignore untrack errors
      }
    }
    try {
      const client = requireSupabase();
      await client.removeChannel(channel);
    } catch {
      try {
        await channel.unsubscribe();
      } catch {
        // ignore cleanup errors
      }
    }
  }

  private async teardownChannelsOnly() {
    const matchCh = this.matchChannel;
    this.matchChannel = null;
    await this.safeRemoveChannel(matchCh, false);

    const roomCh = this.channel;
    this.channel = null;
    await this.safeRemoveChannel(roomCh, true);
  }

  private async trackLocalPresence(
    channel: RealtimeChannel,
    localPlayer: { playerId: string; username: string; characterId: CharacterId }
  ) {
    const payload = {
      playerId: localPlayer.playerId,
      username: localPlayer.username,
      characterId: localPlayer.characterId,
      onlineAt: new Date().toISOString(),
    };
    try {
      const res = await channel.track(payload);
      if (res !== 'ok') {
        await new Promise((r) => window.setTimeout(r, 250));
        await channel.track({ ...payload, onlineAt: new Date().toISOString() });
      }
    } catch {
      // ignore transient track failure
    }
  }

  private async establishRoomChannel(
    roomId: string,
    roomCode: string,
    localPlayer: { playerId: string; username: string; characterId: CharacterId },
    rejectOnInitialError: boolean
  ) {
    const normalizedCode = roomCode.trim().toUpperCase();
    const generation = ++this.connectGeneration;

    const client = requireSupabase();
    const channel = client.channel(`treasurebound:${normalizedCode}`, {
      config: {
        presence: { key: localPlayer.playerId },
        broadcast: { self: false },
      },
    });

    channel
      .on('presence', { event: 'sync' }, () => {
        if (generation !== this.connectGeneration) return;
        this.syncPresenceFromChannel(channel);
      })
      .on('presence', { event: 'join' }, ({ key }) => {
        if (generation !== this.connectGeneration) return;
        const onlineIds = this.syncPresenceFromChannel(channel);
        if (key) {
          this.callbacks.onPlayerJoinPresence?.(key, onlineIds);
        }
      })
      .on('presence', { event: 'leave' }, ({ key }) => {
        if (generation !== this.connectGeneration) return;
        const onlineIds = this.syncPresenceFromChannel(channel);
        if (key && !onlineIds.includes(key)) {
          this.callbacks.onPlayerLeavePresence?.(key);
        }
      })
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'room_players', filter: `room_id=eq.${roomId}` },
        () => {
          this.callbacks.onDbRoomUpdated?.();
        }
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'rooms', filter: `id=eq.${roomId}` },
        () => {
          this.callbacks.onDbRoomUpdated?.();
        }
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'matches', filter: `room_id=eq.${roomId}` },
        (payload) => {
          const rec = payload.new as
            | { id?: string; status?: string; winner_player_id?: string | null }
            | undefined;
          if (rec?.id && rec?.status) {
            this.callbacks.onDbMatchUpdated?.(rec.id, rec.status, rec.winner_player_id ?? null);
          }
        }
      )
      .on('broadcast', { event: 'player:move' }, ({ payload }) => {
        this.callbacks.onPlayerMove?.(payload as RemotePlayerSync);
      })
      .on('broadcast', { event: 'player:attack' }, ({ payload }) => {
        this.callbacks.onPlayerAttack?.(payload as ProjectileBroadcast);
      })
      .on('broadcast', { event: 'player:hit' }, ({ payload }) => {
        this.callbacks.onPlayerHit?.(
          payload as {
            targetId: string;
            attackerId: string;
            newHp: number;
            isDead: boolean;
            respawnAt: string | null;
          }
        );
      })
      .on('broadcast', { event: 'player:respawn' }, ({ payload }) => {
        this.callbacks.onPlayerRespawn?.(payload as { playerId: string; health: number });
      })
      .on('broadcast', { event: 'world:item_claimed' }, ({ payload }) => {
        this.callbacks.onItemClaimed?.(
          payload as { itemKey: string; itemType: string; claimedBy: string }
        );
      })
      .on('broadcast', { event: 'match:countdown' }, ({ payload }) => {
        this.callbacks.onMatchCountdown?.(
          payload as { countdownSeconds: number; startedBy: string }
        );
      })
      .on('broadcast', { event: 'match:started' }, ({ payload }) => {
        this.callbacks.onMatchStarted?.(payload as { matchId: string });
      })
      .on('broadcast', { event: 'match:finished' }, ({ payload }) => {
        this.callbacks.onMatchFinished?.(payload as { matchId: string; winnerPlayerId: string });
      })
      .on('broadcast', { event: 'player:score_update' }, () => {
        this.callbacks.onPlayerScoreUpdate?.();
      });

    await new Promise<void>((resolve, reject) => {
      let settled = false;
      channel.subscribe(async (status) => {
        if (generation !== this.connectGeneration) {
          if (!settled) {
            settled = true;
            resolve();
          }
          return;
        }

        if (status === 'SUBSCRIBED') {
          this.channel = channel;
          this.reconnectAttempt = 0;
          this.callbacks.onConnectionStateChange?.('connected');
          await this.trackLocalPresence(channel, localPlayer);
          if (generation !== this.connectGeneration) {
            if (!settled) {
              settled = true;
              resolve();
            }
            return;
          }
          // Ensure presence list reflects tracked state immediately after subscription
          this.syncPresenceFromChannel(channel);

          if (!settled) {
            settled = true;
            resolve();
          } else if (!this.manualDisconnect) {
            this.callbacks.onReconnected?.();
          }
        } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
          if (this.channel === channel) {
            this.channel = null;
          }
          if (!settled) {
            settled = true;
            void this.safeRemoveChannel(channel, false);
            if (!this.manualDisconnect) {
              this.scheduleReconnect();
            }
            if (rejectOnInitialError) {
              reject(new Error(`Realtime connection failed (${status})`));
            } else {
              resolve();
            }
          } else if (!this.manualDisconnect) {
            this.scheduleReconnect();
          }
        }
      });
    });
  }

  async connect(
    roomId: string,
    roomCode: string,
    localPlayer: { playerId: string; username: string; characterId: CharacterId },
    callbacks: RoomRealtimeCallbacks
  ) {
    const normalizedCode = roomCode.trim().toUpperCase();
    this.callbacks = callbacks;
    this.manualDisconnect = false;

    if (
      this.channel &&
      this.currentRoomCode === normalizedCode &&
      this.currentRoomId === roomId &&
      this.localPlayer?.playerId === localPlayer.playerId
    ) {
      this.localPlayer = localPlayer;
      const onlineIds = this.syncPresenceFromChannel(this.channel);
      if (!onlineIds.includes(localPlayer.playerId)) {
        await this.trackLocalPresence(this.channel, localPlayer);
        this.syncPresenceFromChannel(this.channel);
      }
      return;
    }

    await this.disconnect();
    this.manualDisconnect = false;
    this.currentRoomId = roomId;
    this.currentRoomCode = normalizedCode;
    this.localPlayer = localPlayer;

    await this.establishRoomChannel(roomId, normalizedCode, localPlayer, true);
  }

  /**
   * Dedicated match-scoped postgres_changes subscription filtered strictly by match_id.
   * Keeps room presence/broadcast channel intact while eliminating cross-room match_players noise.
   */
  async subscribeToMatch(matchId: string) {
    if (!matchId || matchId.startsWith('solo_match_')) return;
    if (this.matchChannel && this.currentMatchId === matchId) return;

    await this.unsubscribeFromMatch();
    this.currentMatchId = matchId;

    const client = requireSupabase();
    const matchChannel = client.channel(`treasurebound:match:${matchId}`);
    matchChannel
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'match_players', filter: `match_id=eq.${matchId}` },
        () => {
          this.callbacks.onDbMatchPlayersUpdated?.();
        }
      )
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'match_world_items', filter: `match_id=eq.${matchId}` },
        (payload) => {
          const rec = payload.new as
            | { item_key?: string; item_type?: string; claimed_by?: string | null }
            | undefined;
          if (rec?.item_key && rec.claimed_by) {
            this.callbacks.onItemClaimed?.({
              itemKey: rec.item_key,
              itemType: rec.item_type ?? 'apple',
              claimedBy: rec.claimed_by,
            });
          }
        }
      );

    matchChannel.subscribe();
    this.matchChannel = matchChannel;
  }

  async unsubscribeFromMatch() {
    this.currentMatchId = null;
    const matchCh = this.matchChannel;
    this.matchChannel = null;
    await this.safeRemoveChannel(matchCh, false);
  }

  async send(event: string, payload: Record<string, unknown>) {
    if (!this.channel) return;
    try {
      await this.channel.send({
        type: 'broadcast',
        event,
        payload,
      });
    } catch {
      // ignore transient broadcast send errors
    }
  }

  async disconnect() {
    this.manualDisconnect = true;
    this.connectGeneration += 1;
    this.clearReconnectTimer();
    await this.teardownChannelsOnly();
    this.currentRoomId = null;
    this.currentRoomCode = null;
    this.currentMatchId = null;
    this.localPlayer = null;
    this.onlinePlayerIds = [];
    this.reconnectAttempt = 0;
  }
}

export const realtimeService = new RealtimeService();
