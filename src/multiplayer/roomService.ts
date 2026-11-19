import {
  CharacterId,
  EducationLevel,
  PlayerProfile,
  RoomPlayerRecord,
  RoomRecord,
} from '../types/game';
import { requireSupabase } from '../services/supabase';
import {
  getPlayerSessionToken,
  setPlayerSession,
  tryGetPlayerSessionToken,
} from '../services/playerSession';

export async function createPlayerProfile(
  username: string,
  characterId: CharacterId
): Promise<PlayerProfile> {
  const client = requireSupabase();
  const { data, error } = await client.rpc('create_player_session', {
    p_username: username.trim(),
    p_character_id: characterId,
  });

  if (error) {
    throw new Error(error.message || 'Gagal membuat profil penjelajah');
  }
  const payload = data as { player?: PlayerProfile; session_token?: string } | null;
  if (!payload?.player?.id || !payload.session_token) {
    throw new Error('Respons sesi pemain dari server tidak lengkap');
  }
  setPlayerSession(payload.player.id, payload.session_token);
  return payload.player;
}

export async function createRoom(
  playerId: string,
  difficulty: EducationLevel = 'SMA'
): Promise<RoomRecord> {
  const client = requireSupabase();
  const sessionToken = getPlayerSessionToken(playerId);
  const { data, error } = await client.rpc('create_room', {
    p_player_id: playerId,
    p_difficulty: difficulty,
    p_session_token: sessionToken,
  });

  if (error) {
    throw new Error(error.message || 'Gagal membuat room');
  }
  return (data as { room: RoomRecord }).room;
}

export async function setRoomDifficulty(
  roomId: string,
  hostPlayerId: string,
  difficulty: EducationLevel
): Promise<RoomRecord> {
  const client = requireSupabase();
  const sessionToken = getPlayerSessionToken(hostPlayerId);
  const { data, error } = await client.rpc('set_room_difficulty', {
    p_room_id: roomId,
    p_host_player_id: hostPlayerId,
    p_difficulty: difficulty,
    p_session_token: sessionToken,
  });

  if (error) {
    throw new Error(error.message || 'Gagal mengubah tingkat kesulitan');
  }
  return (data as { room: RoomRecord }).room;
}

export async function joinRoom(roomCode: string, playerId: string): Promise<RoomRecord> {
  const client = requireSupabase();
  const sessionToken = getPlayerSessionToken(playerId);
  const { data, error } = await client.rpc('join_room', {
    p_room_code: roomCode.trim().toUpperCase(),
    p_player_id: playerId,
    p_session_token: sessionToken,
  });

  if (error) {
    throw new Error(error.message || 'Gagal bergabung ke room');
  }
  return (data as { room: RoomRecord }).room;
}

export async function leaveRoom(roomId: string, playerId: string): Promise<void> {
  const sessionToken = tryGetPlayerSessionToken(playerId);
  if (!sessionToken) return;
  const client = requireSupabase();
  const { error } = await client.rpc('leave_room', {
    p_room_id: roomId,
    p_player_id: playerId,
    p_session_token: sessionToken,
  });
  if (error) {
    console.warn('leave_room warning:', error.message);
  }
}

export async function transferHostOnDisconnect(
  roomId: string,
  disconnectedPlayerId: string,
  callerPlayerId: string
): Promise<string | null> {
  const sessionToken = tryGetPlayerSessionToken(callerPlayerId);
  if (!sessionToken) return null;
  const client = requireSupabase();
  const { data, error } = await client.rpc('transfer_host', {
    p_room_id: roomId,
    p_disconnected_player_id: disconnectedPlayerId,
    p_caller_player_id: callerPlayerId,
    p_session_token: sessionToken,
  });
  if (error) {
    console.warn('transfer_host warning:', error.message);
    return null;
  }
  return (data as string | null) ?? null;
}

export async function setRoomPlayerConnected(
  roomId: string,
  playerId: string,
  isConnected: boolean
): Promise<boolean> {
  const sessionToken = tryGetPlayerSessionToken(playerId);
  if (!sessionToken) return false;
  const client = requireSupabase();
  const { data, error } = await client.rpc('set_room_player_connected', {
    p_room_id: roomId,
    p_player_id: playerId,
    p_is_connected: isConnected,
    p_session_token: sessionToken,
  });
  if (error) {
    console.warn('set_room_player_connected warning:', error.message);
    return false;
  }
  return Boolean(data);
}

export async function rejoinSession(
  roomId: string,
  playerId: string
): Promise<{
  ok: boolean;
  reason?: string;
  room?: RoomRecord;
  latest_match_id?: string | null;
  latest_match_status?: string | null;
}> {
  const sessionToken = tryGetPlayerSessionToken(playerId);
  if (!sessionToken) {
    return { ok: false, reason: 'missing_session_token' };
  }
  const client = requireSupabase();
  const { data, error } = await client.rpc('rejoin_session', {
    p_room_id: roomId,
    p_player_id: playerId,
    p_session_token: sessionToken,
  });
  if (error) {
    return { ok: false, reason: error.message };
  }
  return (data ?? { ok: false, reason: 'empty_response' }) as {
    ok: boolean;
    reason?: string;
    room?: RoomRecord;
    latest_match_id?: string | null;
    latest_match_status?: string | null;
  };
}

export async function fetchRoomState(
  roomId: string,
  options: { onlyConnected?: boolean } = {}
): Promise<{
  room: RoomRecord | null;
  players: RoomPlayerRecord[];
}> {
  const onlyConnected = options.onlyConnected ?? true;
  const client = requireSupabase();

  let playersQuery = client
    .from('room_players')
    .select('*, player:players(*)')
    .eq('room_id', roomId);

  if (onlyConnected) {
    playersQuery = playersQuery.eq('is_connected', true);
  }

  const [{ data: room, error: roomErr }, { data: rpRows, error: rpErr }] = await Promise.all([
    client.from('rooms').select('*').eq('id', roomId).maybeSingle(),
    playersQuery.order('joined_at', { ascending: true }),
  ]);

  if (roomErr) throw new Error(roomErr.message);
  if (rpErr) throw new Error(rpErr.message);

  const normalizedPlayers = (rpRows ?? []) as unknown as RoomPlayerRecord[];
  const missingPlayerIds = Array.from(
    new Set(
      normalizedPlayers
        .filter((rp) => !rp.player && rp.player_id)
        .map((rp) => rp.player_id)
    )
  );

  if (missingPlayerIds.length > 0) {
    const { data: fallbackProfiles } = await client
      .from('players')
      .select('*')
      .in('id', missingPlayerIds);

    if (fallbackProfiles && fallbackProfiles.length > 0) {
      const profileMap = new Map<string, PlayerProfile>();
      for (const p of fallbackProfiles as PlayerProfile[]) {
        profileMap.set(p.id, p);
      }
      for (const rp of normalizedPlayers) {
        if (!rp.player) {
          rp.player = profileMap.get(rp.player_id);
        }
      }
    }
  }

  return {
    room: (room as RoomRecord | null) ?? null,
    players: normalizedPlayers,
  };
}
