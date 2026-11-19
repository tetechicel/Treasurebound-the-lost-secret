import { generateMatchConfiguration } from '../game/maps/MapGenerator';
import { generateMatchSeed } from '../game/systems/RandomizationSystem';
import { getPlayerSessionToken } from '../services/playerSession';
import { requireSupabase } from '../services/supabase';
import {
  EducationLevel,
  LargeTreasureUnlockResult,
  MatchPlayerState,
  MatchRecord,
} from '../types/game';

export async function startMultiplayerMatch(
  roomId: string,
  hostPlayerId: string,
  difficulty: EducationLevel = 'SMA'
): Promise<MatchRecord> {
  const client = requireSupabase();
  const seed = generateMatchSeed();
  const mapConfiguration = generateMatchConfiguration(seed, difficulty);
  const sessionToken = getPlayerSessionToken(hostPlayerId);

  const { data, error } = await client.rpc('start_match', {
    p_room_id: roomId,
    p_host_player_id: hostPlayerId,
    p_seed: seed,
    p_map_configuration: mapConfiguration,
    p_session_token: sessionToken,
  });

  if (error) {
    throw new Error(error.message || 'Gagal memulai pertandingan');
  }
  return data as MatchRecord;
}

export async function playAgainMultiplayerMatch(
  roomId: string,
  hostPlayerId: string,
  difficulty: EducationLevel = 'SMA'
): Promise<MatchRecord> {
  const client = requireSupabase();
  const seed = generateMatchSeed();
  const mapConfiguration = generateMatchConfiguration(seed, difficulty);
  const sessionToken = getPlayerSessionToken(hostPlayerId);

  const { data, error } = await client.rpc('play_again', {
    p_room_id: roomId,
    p_host_player_id: hostPlayerId,
    p_seed: seed,
    p_map_configuration: mapConfiguration,
    p_session_token: sessionToken,
  });

  if (error) {
    throw new Error(error.message || 'Gagal memulai ulang pertandingan');
  }
  return data as MatchRecord;
}

export async function fetchLatestMatchForRoom(roomId: string): Promise<MatchRecord | null> {
  const client = requireSupabase();
  const { data, error } = await client
    .from('matches')
    .select('*')
    .eq('room_id', roomId)
    .order('started_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw new Error(error.message);
  return (data as MatchRecord | null) ?? null;
}

function normalizeMatchPlayer(row: Record<string, unknown>): MatchPlayerState {
  const p = row.player as { username?: string; character_id?: string } | undefined;
  return {
    ...(row as unknown as MatchPlayerState),
    username: p?.username ?? (row.username as string | undefined) ?? 'Penjelajah',
    character_id:
      (p?.character_id as MatchPlayerState['character_id']) ??
      (row.character_id as MatchPlayerState['character_id']) ??
      'kai',
    score: Number(row.score ?? 0),
    completed_small_chests: Array.isArray(row.completed_small_chests)
      ? (row.completed_small_chests as string[])
      : [],
    collected_fragments: Array.isArray(row.collected_fragments)
      ? (row.collected_fragments as MatchPlayerState['collected_fragments'])
      : [],
    completed_challenges: Array.isArray(row.completed_challenges)
      ? (row.completed_challenges as string[])
      : [],
    unlocked_gates: Array.isArray(row.unlocked_gates) ? (row.unlocked_gates as string[]) : [],
    activated_switches: Array.isArray(row.activated_switches)
      ? (row.activated_switches as string[])
      : [],
    has_secret_key: Boolean(row.has_secret_key),
    large_treasure_unlocked: Boolean(row.large_treasure_unlocked),
    large_treasure_completed: Boolean(row.large_treasure_completed),
    challenge_progress:
      row.challenge_progress && typeof row.challenge_progress === 'object' && !Array.isArray(row.challenge_progress)
        ? (row.challenge_progress as Record<string, number>)
        : {},
  };
}

export async function fetchMatchBundle(matchId: string): Promise<{
  match: MatchRecord;
  players: MatchPlayerState[];
  claimedItems: Record<string, string>;
}> {
  const client = requireSupabase();
  const [{ data: match, error: mErr }, { data: mpRows, error: mpErr }, { data: itemRows, error: iErr }] =
    await Promise.all([
      client.from('matches').select('*').eq('id', matchId).single(),
      client.from('match_players').select('*, player:players(username, character_id)').eq('match_id', matchId),
      client
        .from('match_world_items')
        .select('item_key, claimed_by')
        .eq('match_id', matchId)
        .not('claimed_by', 'is', null),
    ]);

  if (mErr) throw new Error(mErr.message);
  if (mpErr) throw new Error(mpErr.message);
  if (iErr) throw new Error(iErr.message);

  const players: MatchPlayerState[] = (mpRows ?? []).map((row) =>
    normalizeMatchPlayer(row as Record<string, unknown>)
  );

  const claimedItems: Record<string, string> = {};
  for (const item of itemRows ?? []) {
    if (item.claimed_by) {
      claimedItems[item.item_key as string] = item.claimed_by as string;
    }
  }

  return {
    match: match as MatchRecord,
    players,
    claimedItems,
  };
}

export async function unlockLargeTreasureRpc(
  matchId: string,
  playerId: string,
  submittedCodes: string[]
): Promise<LargeTreasureUnlockResult> {
  const client = requireSupabase();
  const sessionToken = getPlayerSessionToken(playerId);
  const { data, error } = await client.rpc('unlock_large_treasure', {
    p_match_id: matchId,
    p_player_id: playerId,
    p_submitted_codes: submittedCodes,
    p_session_token: sessionToken,
  });
  if (error) throw new Error(error.message);
  return data as LargeTreasureUnlockResult;
}

export async function activateSwitchOrKeyRpc(
  matchId: string,
  playerId: string,
  kind: 'switch' | 'secret_key',
  itemKey: string
) {
  const client = requireSupabase();
  const sessionToken = getPlayerSessionToken(playerId);
  const { data, error } = await client.rpc('activate_switch_or_key', {
    p_match_id: matchId,
    p_player_id: playerId,
    p_kind: kind,
    p_item_key: itemKey,
    p_session_token: sessionToken,
  });
  if (error) throw new Error(error.message);
  return data as {
    applied: boolean;
    has_secret_key?: boolean;
    activated_switches?: string[];
  };
}

export async function recordAttackHitRpc(params: {
  matchId: string;
  attackerId: string;
  targetId: string;
  attackerPos: { x: number; y: number };
  targetPos: { x: number; y: number };
}): Promise<{
  applied: boolean;
  reason?: string;
  target_id?: string;
  new_hp?: number;
  is_dead?: boolean;
  respawn_at?: string | null;
}> {
  const client = requireSupabase();
  const sessionToken = getPlayerSessionToken(params.attackerId);
  const { data, error } = await client.rpc('record_attack_hit', {
    p_match_id: params.matchId,
    p_attacker_id: params.attackerId,
    p_target_id: params.targetId,
    p_attacker_pos: params.attackerPos,
    p_target_pos: params.targetPos,
    p_session_token: sessionToken,
  });
  if (error) throw new Error(error.message);
  return data;
}

export async function completeRespawnRpc(matchId: string, playerId: string) {
  const client = requireSupabase();
  const sessionToken = getPlayerSessionToken(playerId);
  const { data, error } = await client.rpc('complete_respawn', {
    p_match_id: matchId,
    p_player_id: playerId,
    p_session_token: sessionToken,
  });
  if (error) throw new Error(error.message);
  return data as {
    respawned: boolean;
    health?: number;
    reason?: string;
    invulnerable_until?: string;
  };
}

export async function collectAppleRpc(matchId: string, playerId: string, itemKey: string) {
  const client = requireSupabase();
  const sessionToken = getPlayerSessionToken(playerId);
  const { data, error } = await client.rpc('collect_apple', {
    p_match_id: matchId,
    p_player_id: playerId,
    p_item_key: itemKey,
    p_session_token: sessionToken,
  });
  if (error) throw new Error(error.message);
  return data as { collected: boolean; reason?: string; apples?: number };
}

export async function useAppleRpc(matchId: string, playerId: string) {
  const client = requireSupabase();
  const sessionToken = getPlayerSessionToken(playerId);
  const { data, error } = await client.rpc('use_apple', {
    p_match_id: matchId,
    p_player_id: playerId,
    p_session_token: sessionToken,
  });
  if (error) throw new Error(error.message);
  return data as { used: boolean; reason?: string; health?: number; apples?: number };
}

export async function applyTrapDamageRpc(matchId: string, playerId: string) {
  const client = requireSupabase();
  const sessionToken = getPlayerSessionToken(playerId);
  const { data, error } = await client.rpc('apply_trap_damage', {
    p_match_id: matchId,
    p_player_id: playerId,
    p_session_token: sessionToken,
  });
  if (error) throw new Error(error.message);
  return data as { applied: boolean; new_hp?: number; is_dead?: boolean; respawn_at?: string | null };
}

export async function updatePlayerPositionRpc(
  matchId: string,
  playerId: string,
  x: number,
  y: number
) {
  const client = requireSupabase();
  const sessionToken = getPlayerSessionToken(playerId);
  const { data, error } = await client.rpc('update_player_position', {
    p_match_id: matchId,
    p_player_id: playerId,
    p_x: x,
    p_y: y,
    p_session_token: sessionToken,
  });
  if (error) throw new Error(error.message);
  return data as { accepted: boolean; reason?: string };
}

export async function claimSecretTreasureRpc(
  matchId: string,
  playerId: string,
  playerPos: { x: number; y: number }
) {
  const client = requireSupabase();
  const sessionToken = getPlayerSessionToken(playerId);
  const { data, error } = await client.rpc('claim_secret_treasure', {
    p_match_id: matchId,
    p_player_id: playerId,
    p_player_pos: playerPos,
    p_session_token: sessionToken,
  });
  if (error) throw new Error(error.message);
  return data as { claimed: boolean; winner_player_id?: string; reason?: string; finished_at?: string };
}
