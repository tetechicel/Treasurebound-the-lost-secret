-- TREASUREBOUND: The Lost Secret — V2.2 Security & Concurrency Follow-up Patch
-- Incremental, non-destructive migration on top of 001–005.
-- Do NOT modify 001–005; apply this file after 005_stabilization_patch.sql.
--
-- Fixes implemented:
--   1. Host migration security: room_players.last_seen_at liveness tracking + anti-hijack
--      validation in transfer_host so connected hosts/players cannot be falsely marked
--      disconnected by another client.
--   2. Server-validated, speed-bounded player position tracking (match_players.last_x, last_y,
--      position_updated_at + update_player_position RPC) cross-checked by record_attack_hit
--      and claim_secret_treasure (plus gate_temple_sanctum progression check).
--      Note: coordinates still originate from client Phaser movement (no server-side physics
--      loop in this architecture), so this provides speed-bounded / target-cross-checked
--      validation rather than full server-authoritative physics simulation.
--   3. Deadlock prevention in record_attack_hit via deterministic UUID row-locking order.
--   4. complete_respawn restricted strictly to PLAYING matches.
--   5. Full map_configuration validation in _validate_map_configuration + safe JSONB type checks
--      on p_submitted_codes, p_player_pos, p_attacker_pos, p_target_pos, and integer casts.
--   6. Username control-character sanitization, stale session cleanup, and burst protection
--      on create_player_session.
--   7. Explicit REVOKE ALL FROM PUBLIC on every SECURITY DEFINER RPC and strict GRANT EXECUTE
--      only to anon, authenticated for active client RPCs (none for internal/legacy RPCs).

-- ============================================================================
-- 1. SCHEMA ADDITIONS (Non-destructive)
-- ============================================================================
ALTER TABLE public.room_players
  ADD COLUMN IF NOT EXISTS last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now();

ALTER TABLE public.match_players
  ADD COLUMN IF NOT EXISTS last_x DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS last_y DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS position_updated_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_player_sessions_created_at
  ON public.player_sessions (created_at);

REVOKE ALL ON TABLE public.player_sessions FROM PUBLIC, anon, authenticated;

-- ============================================================================
-- 2. INTERNAL VALIDATION HELPERS (Never directly callable by clients)
-- ============================================================================
CREATE OR REPLACE FUNCTION public._extract_finite_xy(
  p_pos JSONB,
  p_max_x DOUBLE PRECISION,
  p_max_y DOUBLE PRECISION
)
RETURNS TABLE (ok BOOLEAN, x DOUBLE PRECISION, y DOUBLE PRECISION)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_x DOUBLE PRECISION;
  v_y DOUBLE PRECISION;
BEGIN
  IF p_pos IS NULL OR jsonb_typeof(p_pos) <> 'object' THEN
    RETURN QUERY SELECT false, NULL::double precision, NULL::double precision;
    RETURN;
  END IF;

  IF jsonb_typeof(p_pos->'x') <> 'number' OR jsonb_typeof(p_pos->'y') <> 'number' THEN
    RETURN QUERY SELECT false, NULL::double precision, NULL::double precision;
    RETURN;
  END IF;

  v_x := (p_pos->>'x')::double precision;
  v_y := (p_pos->>'y')::double precision;

  IF v_x < 0 OR v_x > p_max_x OR v_y < 0 OR v_y > p_max_y THEN
    RETURN QUERY SELECT false, NULL::double precision, NULL::double precision;
    RETURN;
  END IF;

  RETURN QUERY SELECT true, v_x, v_y;
END;
$$;
REVOKE ALL ON FUNCTION public._extract_finite_xy(JSONB, DOUBLE PRECISION, DOUBLE PRECISION) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public._validate_map_configuration(
  p_map JSONB
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_w INT;
  v_h INT;
  v_ts INT;
  v_max_px DOUBLE PRECISION;
  v_max_py DOUBLE PRECISION;
  v_elem JSONB;
  v_qc INT;
BEGIN
  IF p_map IS NULL OR jsonb_typeof(p_map) <> 'object' THEN
    RAISE EXCEPTION 'Konfigurasi peta harus berupa objek JSON';
  END IF;

  IF NULLIF(trim(COALESCE(p_map->>'seed', '')), '') IS NULL THEN
    RAISE EXCEPTION 'Seed konfigurasi peta tidak valid';
  END IF;

  IF upper(trim(COALESCE(p_map->>'difficulty', ''))) NOT IN ('SD', 'SMP', 'SMA') THEN
    RAISE EXCEPTION 'Jenjang konfigurasi peta tidak valid';
  END IF;

  IF jsonb_typeof(p_map->'worldWidth') <> 'number'
     OR jsonb_typeof(p_map->'worldHeight') <> 'number'
     OR jsonb_typeof(p_map->'tileSize') <> 'number' THEN
    RAISE EXCEPTION 'Dimensi peta tidak valid';
  END IF;

  v_w := floor((p_map->>'worldWidth')::numeric)::int;
  v_h := floor((p_map->>'worldHeight')::numeric)::int;
  v_ts := floor((p_map->>'tileSize')::numeric)::int;

  IF v_w < 50 OR v_w > 500 OR v_h < 50 OR v_h > 500 OR v_ts < 16 OR v_ts > 128 THEN
    RAISE EXCEPTION 'Ukuran dunia atau tile berada di luar batas yang diizinkan';
  END IF;

  v_max_px := (v_w * v_ts)::double precision;
  v_max_py := (v_h * v_ts)::double precision;

  -- spawnPoints
  IF jsonb_typeof(p_map->'spawnPoints') <> 'array' OR jsonb_array_length(p_map->'spawnPoints') < 2 THEN
    RAISE EXCEPTION 'Konfigurasi spawnPoints tidak valid';
  END IF;
  FOR v_elem IN SELECT * FROM jsonb_array_elements(p_map->'spawnPoints') LOOP
    IF jsonb_typeof(v_elem) <> 'object'
       OR jsonb_typeof(v_elem->'x') <> 'number'
       OR jsonb_typeof(v_elem->'y') <> 'number'
       OR (v_elem->>'x')::double precision < 0
       OR (v_elem->>'x')::double precision > v_max_px
       OR (v_elem->>'y')::double precision < 0
       OR (v_elem->>'y')::double precision > v_max_py THEN
      RAISE EXCEPTION 'Koordinat spawnPoint tidak valid';
    END IF;
  END LOOP;

  -- smallChests
  IF jsonb_typeof(p_map->'smallChests') <> 'array' OR jsonb_array_length(p_map->'smallChests') = 0 THEN
    RAISE EXCEPTION 'Konfigurasi smallChests tidak valid';
  END IF;
  FOR v_elem IN SELECT * FROM jsonb_array_elements(p_map->'smallChests') LOOP
    IF jsonb_typeof(v_elem) <> 'object'
       OR NULLIF(trim(COALESCE(v_elem->>'id', '')), '') IS NULL
       OR NULLIF(trim(COALESCE(v_elem->>'fragmentCode', '')), '') IS NULL
       OR jsonb_typeof(v_elem->'tileX') <> 'number'
       OR jsonb_typeof(v_elem->'tileY') <> 'number'
       OR jsonb_typeof(v_elem->'questionCount') <> 'number' THEN
      RAISE EXCEPTION 'Entri smallChest tidak valid';
    END IF;
    v_qc := floor((v_elem->>'questionCount')::numeric)::int;
    IF v_qc < 1 OR v_qc > 5
       OR (v_elem->>'tileX')::double precision < 0 OR (v_elem->>'tileX')::double precision >= v_w
       OR (v_elem->>'tileY')::double precision < 0 OR (v_elem->>'tileY')::double precision >= v_h THEN
      RAISE EXCEPTION 'Nilai smallChest berada di luar batas peta';
    END IF;
  END LOOP;

  -- largeTreasure
  v_elem := p_map->'largeTreasure';
  IF jsonb_typeof(v_elem) <> 'object'
     OR NULLIF(trim(COALESCE(v_elem->>'id', '')), '') IS NULL
     OR jsonb_typeof(v_elem->'tileX') <> 'number'
     OR jsonb_typeof(v_elem->'tileY') <> 'number'
     OR jsonb_typeof(v_elem->'questionCount') <> 'number' THEN
    RAISE EXCEPTION 'Konfigurasi largeTreasure tidak valid';
  END IF;
  v_qc := floor((v_elem->>'questionCount')::numeric)::int;
  IF v_qc < 1 OR v_qc > 5
     OR (v_elem->>'tileX')::double precision < 0 OR (v_elem->>'tileX')::double precision >= v_w
     OR (v_elem->>'tileY')::double precision < 0 OR (v_elem->>'tileY')::double precision >= v_h THEN
    RAISE EXCEPTION 'Koordinat atau jumlah soal largeTreasure tidak valid';
  END IF;

  -- bonusChallenges
  IF jsonb_typeof(p_map->'bonusChallenges') <> 'array' THEN
    RAISE EXCEPTION 'Konfigurasi bonusChallenges tidak valid';
  END IF;
  FOR v_elem IN SELECT * FROM jsonb_array_elements(p_map->'bonusChallenges') LOOP
    IF jsonb_typeof(v_elem) <> 'object'
       OR NULLIF(trim(COALESCE(v_elem->>'id', '')), '') IS NULL
       OR COALESCE(v_elem->>'kind', '') NOT IN ('bonus_shrine', 'riddle_statue', 'secret_cache')
       OR jsonb_typeof(v_elem->'tileX') <> 'number'
       OR jsonb_typeof(v_elem->'tileY') <> 'number'
       OR (v_elem->>'tileX')::double precision < 0 OR (v_elem->>'tileX')::double precision >= v_w
       OR (v_elem->>'tileY')::double precision < 0 OR (v_elem->>'tileY')::double precision >= v_h THEN
      RAISE EXCEPTION 'Entri bonusChallenge tidak valid';
    END IF;
  END LOOP;

  -- gates
  IF jsonb_typeof(p_map->'gates') <> 'array' THEN
    RAISE EXCEPTION 'Konfigurasi gates tidak valid';
  END IF;
  FOR v_elem IN SELECT * FROM jsonb_array_elements(p_map->'gates') LOOP
    IF jsonb_typeof(v_elem) <> 'object'
       OR NULLIF(trim(COALESCE(v_elem->>'id', '')), '') IS NULL
       OR jsonb_typeof(v_elem->'tileX') <> 'number'
       OR jsonb_typeof(v_elem->'tileY') <> 'number' THEN
      RAISE EXCEPTION 'Entri gate tidak valid';
    END IF;
  END LOOP;

  -- switches
  IF jsonb_typeof(p_map->'switches') <> 'array' THEN
    RAISE EXCEPTION 'Konfigurasi switches tidak valid';
  END IF;
  FOR v_elem IN SELECT * FROM jsonb_array_elements(p_map->'switches') LOOP
    IF jsonb_typeof(v_elem) <> 'object'
       OR NULLIF(trim(COALESCE(v_elem->>'id', '')), '') IS NULL
       OR jsonb_typeof(v_elem->'tileX') <> 'number'
       OR jsonb_typeof(v_elem->'tileY') <> 'number' THEN
      RAISE EXCEPTION 'Entri switch tidak valid';
    END IF;
  END LOOP;

  -- secretKey
  v_elem := p_map->'secretKey';
  IF jsonb_typeof(v_elem) <> 'object'
     OR NULLIF(trim(COALESCE(v_elem->>'id', '')), '') IS NULL
     OR jsonb_typeof(v_elem->'tileX') <> 'number'
     OR jsonb_typeof(v_elem->'tileY') <> 'number' THEN
    RAISE EXCEPTION 'Konfigurasi secretKey tidak valid';
  END IF;

  -- apples
  IF jsonb_typeof(p_map->'apples') <> 'array' THEN
    RAISE EXCEPTION 'Konfigurasi apples tidak valid';
  END IF;
  FOR v_elem IN SELECT * FROM jsonb_array_elements(p_map->'apples') LOOP
    IF jsonb_typeof(v_elem) <> 'object'
       OR NULLIF(trim(COALESCE(v_elem->>'id', '')), '') IS NULL
       OR jsonb_typeof(v_elem->'tileX') <> 'number'
       OR jsonb_typeof(v_elem->'tileY') <> 'number' THEN
      RAISE EXCEPTION 'Entri apple tidak valid';
    END IF;
  END LOOP;

  -- traps
  IF jsonb_typeof(p_map->'traps') <> 'array' THEN
    RAISE EXCEPTION 'Konfigurasi traps tidak valid';
  END IF;
  FOR v_elem IN SELECT * FROM jsonb_array_elements(p_map->'traps') LOOP
    IF jsonb_typeof(v_elem) <> 'object'
       OR NULLIF(trim(COALESCE(v_elem->>'id', '')), '') IS NULL
       OR jsonb_typeof(v_elem->'tileX') <> 'number'
       OR jsonb_typeof(v_elem->'tileY') <> 'number' THEN
      RAISE EXCEPTION 'Entri trap tidak valid';
    END IF;
  END LOOP;

  -- secretTreasure
  v_elem := p_map->'secretTreasure';
  IF jsonb_typeof(v_elem) <> 'object'
     OR NULLIF(trim(COALESCE(v_elem->>'id', '')), '') IS NULL
     OR jsonb_typeof(v_elem->'tileX') <> 'number'
     OR jsonb_typeof(v_elem->'tileY') <> 'number'
     OR (v_elem->>'tileX')::double precision < 0 OR (v_elem->>'tileX')::double precision >= v_w
     OR (v_elem->>'tileY')::double precision < 0 OR (v_elem->>'tileY')::double precision >= v_h THEN
    RAISE EXCEPTION 'Konfigurasi secretTreasure tidak valid';
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION public._validate_map_configuration(JSONB) FROM PUBLIC, anon, authenticated;

-- ============================================================================
-- 3. HARDENED PLAYER SESSION CREATION (Sanitization + Stale Cleanup + Burst Cap)
-- ============================================================================
CREATE OR REPLACE FUNCTION public.create_player_session(
  p_username TEXT,
  p_character_id TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_clean_name TEXT;
  v_player public.players;
  v_token TEXT;
  v_recent_count INT;
BEGIN
  v_clean_name := regexp_replace(trim(COALESCE(p_username, '')), '\s+', ' ', 'g');
  IF v_clean_name ~ '[\x00-\x1F\x7F]' THEN
    RAISE EXCEPTION 'Nama penjelajah mengandung karakter tidak valid';
  END IF;
  IF char_length(v_clean_name) < 3 OR char_length(v_clean_name) > 16 THEN
    RAISE EXCEPTION 'Nama penjelajah harus antara 3 hingga 16 karakter';
  END IF;
  IF p_character_id NOT IN ('kai', 'lina', 'bima', 'sora') THEN
    RAISE EXCEPTION 'Karakter tidak valid';
  END IF;

  -- Opportunistic bounded cleanup of stale sessions not in active rooms
  DELETE FROM public.player_sessions ps
  WHERE ps.created_at < now() - interval '12 hours'
    AND NOT EXISTS (
      SELECT 1
      FROM public.room_players rp
      JOIN public.rooms r ON r.id = rp.room_id
      WHERE rp.player_id = ps.player_id
        AND r.status IN ('WAITING', 'PLAYING')
        AND r.expires_at >= now()
    );

  -- Global micro-burst cap (allows 10+ classroom players simultaneously, blocks tight-loop floods)
  SELECT count(*) INTO v_recent_count
  FROM public.player_sessions
  WHERE created_at >= now() - interval '5 seconds';

  IF v_recent_count >= 100 THEN
    RAISE EXCEPTION 'Server sedang sibuk. Silakan coba beberapa detik lagi.';
  END IF;

  INSERT INTO public.players (username, character_id)
  VALUES (v_clean_name, p_character_id)
  RETURNING * INTO v_player;

  v_token := encode(gen_random_bytes(32), 'hex');
  INSERT INTO public.player_sessions (player_id, session_token)
  VALUES (v_player.id, v_token);

  RETURN jsonb_build_object(
    'player', to_jsonb(v_player),
    'session_token', v_token
  );
END;
$$;

-- ============================================================================
-- 4. LIVENESS-PROTECTED CONNECTION & HOST MIGRATION
-- ============================================================================
CREATE OR REPLACE FUNCTION public.join_room(
  p_room_code TEXT,
  p_player_id UUID,
  p_session_token TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_room public.rooms;
  v_player public.players;
  v_count INT;
  v_dup_name INT;
BEGIN
  PERFORM public.assert_player_session(p_player_id, p_session_token);
  PERFORM public.cleanup_expired_rooms();

  SELECT * INTO v_room
  FROM public.rooms
  WHERE room_code = upper(trim(COALESCE(p_room_code, '')))
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Kode room tidak ditemukan';
  END IF;

  IF v_room.expires_at < now() THEN
    RAISE EXCEPTION 'Room sudah kedaluwarsa';
  END IF;

  IF v_room.status <> 'WAITING' THEN
    RAISE EXCEPTION 'Pertandingan sudah dimulai atau selesai';
  END IF;

  SELECT * INTO v_player FROM public.players WHERE id = p_player_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Profil pemain tidak ditemukan';
  END IF;

  IF EXISTS (SELECT 1 FROM public.room_players WHERE room_id = v_room.id AND player_id = p_player_id) THEN
    UPDATE public.room_players
    SET is_connected = true, last_seen_at = now()
    WHERE room_id = v_room.id AND player_id = p_player_id;
    RETURN jsonb_build_object('room', to_jsonb(v_room));
  END IF;

  SELECT count(*) INTO v_count FROM public.room_players WHERE room_id = v_room.id;
  IF v_count >= v_room.max_players THEN
    RAISE EXCEPTION 'Room Penuh (Maksimal % pemain)', v_room.max_players;
  END IF;

  SELECT count(*) INTO v_dup_name
  FROM public.room_players rp
  JOIN public.players p ON p.id = rp.player_id
  WHERE rp.room_id = v_room.id AND lower(p.username) = lower(v_player.username);

  IF v_dup_name > 0 THEN
    RAISE EXCEPTION 'Nama pemain sudah digunakan di dalam room ini';
  END IF;

  INSERT INTO public.room_players (room_id, player_id, is_host, is_connected, last_seen_at)
  VALUES (v_room.id, p_player_id, false, true, now());

  RETURN jsonb_build_object('room', to_jsonb(v_room));
END;
$$;

CREATE OR REPLACE FUNCTION public.set_room_player_connected(
  p_room_id UUID,
  p_player_id UUID,
  p_is_connected BOOLEAN,
  p_session_token TEXT DEFAULT NULL
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_connected BOOLEAN := COALESCE(p_is_connected, true);
BEGIN
  PERFORM public.assert_player_session(p_player_id, p_session_token);

  UPDATE public.room_players rp
  SET is_connected = v_connected,
      last_seen_at = CASE WHEN v_connected THEN now() ELSE rp.last_seen_at END
  FROM public.rooms r
  WHERE rp.room_id = r.id
    AND rp.room_id = p_room_id
    AND rp.player_id = p_player_id
    AND r.expires_at >= now();

  RETURN FOUND;
END;
$$;

CREATE OR REPLACE FUNCTION public.transfer_host(
  p_room_id UUID,
  p_disconnected_player_id UUID,
  p_caller_player_id UUID,
  p_session_token TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_room public.rooms;
  v_caller_rp public.room_players;
  v_target_rp public.room_players;
  v_next_host UUID;
BEGIN
  PERFORM public.assert_player_session(p_caller_player_id, p_session_token);

  SELECT * INTO v_room FROM public.rooms WHERE id = p_room_id FOR UPDATE;
  IF NOT FOUND THEN RETURN NULL; END IF;

  SELECT * INTO v_caller_rp
  FROM public.room_players
  WHERE room_id = p_room_id AND player_id = p_caller_player_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Hanya anggota room yang dapat memperbarui status koneksi room';
  END IF;

  IF p_caller_player_id <> p_disconnected_player_id AND NOT v_caller_rp.is_connected THEN
    RAISE EXCEPTION 'Pemain yang terputus tidak dapat melaporkan pemain lain';
  END IF;

  SELECT * INTO v_target_rp
  FROM public.room_players
  WHERE room_id = p_room_id AND player_id = p_disconnected_player_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN v_room.host_player_id;
  END IF;

  -- Prevent a malicious client from forcibly disconnecting an active host or player:
  -- A peer report is accepted ONLY if the target already reported disconnect (is_connected = false)
  -- OR the target's authenticated heartbeat (last_seen_at) has been stale for >= 12 seconds.
  IF p_caller_player_id <> p_disconnected_player_id THEN
    IF v_target_rp.is_connected AND v_target_rp.last_seen_at > now() - interval '12 seconds' THEN
      RETURN v_room.host_player_id;
    END IF;
  END IF;

  UPDATE public.room_players
  SET is_connected = false
  WHERE id = v_target_rp.id;

  IF v_room.host_player_id = p_disconnected_player_id
     AND v_room.status IN ('WAITING', 'PLAYING', 'FINISHED') THEN
    SELECT player_id INTO v_next_host
    FROM public.room_players
    WHERE room_id = p_room_id
      AND player_id <> p_disconnected_player_id
      AND is_connected = true
      AND (last_seen_at >= now() - interval '25 seconds' OR player_id = p_caller_player_id)
    ORDER BY joined_at ASC
    LIMIT 1;

    IF v_next_host IS NULL THEN
      SELECT player_id INTO v_next_host
      FROM public.room_players
      WHERE room_id = p_room_id
        AND player_id <> p_disconnected_player_id
        AND is_connected = true
      ORDER BY joined_at ASC
      LIMIT 1;
    END IF;

    IF v_next_host IS NULL AND v_room.status = 'FINISHED' THEN
      SELECT player_id INTO v_next_host
      FROM public.room_players
      WHERE room_id = p_room_id
        AND player_id <> p_disconnected_player_id
      ORDER BY joined_at ASC
      LIMIT 1;
    END IF;

    IF v_next_host IS NOT NULL THEN
      UPDATE public.rooms SET host_player_id = v_next_host WHERE id = p_room_id;
      UPDATE public.room_players SET is_host = (player_id = v_next_host) WHERE room_id = p_room_id;
      RETURN v_next_host;
    END IF;
  END IF;

  RETURN v_room.host_player_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.rejoin_session(
  p_room_id UUID,
  p_player_id UUID,
  p_session_token TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_room public.rooms;
  v_match public.matches;
BEGIN
  PERFORM public.assert_player_session(p_player_id, p_session_token);

  SELECT * INTO v_room FROM public.rooms WHERE id = p_room_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'room_not_found');
  END IF;

  IF v_room.expires_at < now() THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'room_expired');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.room_players
    WHERE room_id = p_room_id AND player_id = p_player_id
  ) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_in_room');
  END IF;

  UPDATE public.room_players
  SET is_connected = true, last_seen_at = now()
  WHERE room_id = p_room_id AND player_id = p_player_id;

  SELECT * INTO v_match
  FROM public.matches
  WHERE room_id = p_room_id
  ORDER BY started_at DESC
  LIMIT 1;

  RETURN jsonb_build_object(
    'ok', true,
    'room', to_jsonb(v_room),
    'latest_match_id', v_match.id,
    'latest_match_status', v_match.status
  );
END;
$$;

-- ============================================================================
-- 5. HARDENED MATCH CREATION & SERVER-STORED SPEED-BOUNDED POSITION TRACKING
-- ============================================================================
CREATE OR REPLACE FUNCTION public._create_match_for_room(
  p_room public.rooms,
  p_host_player_id UUID,
  p_seed TEXT,
  p_map_configuration JSONB
)
RETURNS public.matches
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_player_count INT;
  v_match public.matches;
  v_item JSONB;
  v_spawns JSONB;
  v_spawn_len INT;
  v_rp RECORD;
  v_idx INT := 0;
  v_sp JSONB;
BEGIN
  IF NULLIF(trim(COALESCE(p_seed, '')), '') IS NULL THEN
    RAISE EXCEPTION 'Seed peta tidak valid';
  END IF;

  PERFORM public._validate_map_configuration(p_map_configuration);

  UPDATE public.room_players
  SET is_connected = true, last_seen_at = now()
  WHERE room_id = p_room.id AND player_id = p_host_player_id;

  IF p_room.status = 'WAITING' THEN
    DELETE FROM public.room_players
    WHERE room_id = p_room.id
      AND is_connected = false
      AND player_id <> p_host_player_id;
  END IF;

  SELECT count(*) INTO v_player_count
  FROM public.room_players
  WHERE room_id = p_room.id AND is_connected = true;

  IF v_player_count < 2 THEN
    RAISE EXCEPTION 'Minimal 2 pemain terhubung diperlukan untuk memulai pertandingan';
  END IF;

  UPDATE public.rooms
  SET status = 'PLAYING', expires_at = now() + interval '4 hours'
  WHERE id = p_room.id;

  INSERT INTO public.matches (room_id, seed, difficulty, status, map_configuration)
  VALUES (p_room.id, p_seed, p_room.difficulty, 'PLAYING', p_map_configuration)
  RETURNING * INTO v_match;

  v_spawns := p_map_configuration->'spawnPoints';
  v_spawn_len := jsonb_array_length(v_spawns);

  FOR v_rp IN
    SELECT rp.player_id
    FROM public.room_players rp
    WHERE rp.room_id = p_room.id AND rp.is_connected = true
    ORDER BY rp.player_id::text ASC
  LOOP
    v_sp := v_spawns -> (v_idx % v_spawn_len);
    INSERT INTO public.match_players (
      match_id, player_id, health, apples, coins, score,
      completed_small_chests, collected_fragments, completed_challenges,
      unlocked_gates, activated_switches, has_secret_key,
      large_treasure_unlocked, large_treasure_completed, challenge_progress,
      last_x, last_y, position_updated_at
    )
    VALUES (
      v_match.id, v_rp.player_id, 100, 0, 0, 0,
      '[]'::jsonb, '[]'::jsonb, '[]'::jsonb,
      '[]'::jsonb, '[]'::jsonb, false,
      false, false, '{}'::jsonb,
      (v_sp->>'x')::double precision,
      (v_sp->>'y')::double precision,
      now()
    );
    v_idx := v_idx + 1;
  END LOOP;

  FOR v_item IN SELECT * FROM jsonb_array_elements(COALESCE(p_map_configuration->'apples', '[]'::jsonb)) LOOP
    INSERT INTO public.match_world_items (match_id, item_key, item_type)
    VALUES (v_match.id, v_item->>'id', 'apple')
    ON CONFLICT DO NOTHING;
  END LOOP;

  INSERT INTO public.match_events (match_id, player_id, event_type, event_data)
  VALUES (v_match.id, p_host_player_id, 'MATCH_STARTED', jsonb_build_object('seed', p_seed, 'difficulty', p_room.difficulty));

  RETURN v_match;
END;
$$;
REVOKE ALL ON FUNCTION public._create_match_for_room(public.rooms, UUID, TEXT, JSONB) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.update_player_position(
  p_match_id UUID,
  p_player_id UUID,
  p_x DOUBLE PRECISION,
  p_y DOUBLE PRECISION,
  p_session_token TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_match public.matches;
  v_mp public.match_players;
  v_max_px DOUBLE PRECISION;
  v_max_py DOUBLE PRECISION;
  v_elapsed DOUBLE PRECISION;
  v_dist DOUBLE PRECISION;
  v_max_dist DOUBLE PRECISION;
BEGIN
  PERFORM public.assert_player_session(p_player_id, p_session_token);

  IF p_x IS NULL OR p_y IS NULL
     OR p_x = 'NaN'::double precision OR p_y = 'NaN'::double precision
     OR p_x = 'Infinity'::double precision OR p_x = '-Infinity'::double precision
     OR p_y = 'Infinity'::double precision OR p_y = '-Infinity'::double precision THEN
    RETURN jsonb_build_object('accepted', false, 'reason', 'invalid_coordinates');
  END IF;

  SELECT * INTO v_match FROM public.matches WHERE id = p_match_id;
  IF NOT FOUND OR v_match.status <> 'PLAYING' THEN
    RETURN jsonb_build_object('accepted', false, 'reason', 'match_not_active');
  END IF;

  v_max_px := COALESCE((v_match.map_configuration->>'worldWidth')::double precision, 200)
              * COALESCE((v_match.map_configuration->>'tileSize')::double precision, 32);
  v_max_py := COALESCE((v_match.map_configuration->>'worldHeight')::double precision, 150)
              * COALESCE((v_match.map_configuration->>'tileSize')::double precision, 32);

  IF p_x < 0 OR p_x > v_max_px OR p_y < 0 OR p_y > v_max_py THEN
    RETURN jsonb_build_object('accepted', false, 'reason', 'out_of_bounds');
  END IF;

  SELECT * INTO v_mp
  FROM public.match_players
  WHERE match_id = p_match_id AND player_id = p_player_id
  FOR UPDATE;

  IF NOT FOUND OR v_mp.is_dead THEN
    RETURN jsonb_build_object('accepted', false, 'reason', 'invalid_player_state');
  END IF;

  -- Keep room liveness fresh during active gameplay
  UPDATE public.room_players
  SET is_connected = true, last_seen_at = now()
  WHERE room_id = v_match.room_id AND player_id = p_player_id;

  IF v_mp.last_x IS NULL OR v_mp.last_y IS NULL OR v_mp.position_updated_at IS NULL THEN
    UPDATE public.match_players
    SET last_x = p_x, last_y = p_y, position_updated_at = now()
    WHERE id = v_mp.id;
    RETURN jsonb_build_object('accepted', true);
  END IF;

  v_elapsed := GREATEST(0.0, EXTRACT(EPOCH FROM (now() - v_mp.position_updated_at)));
  IF v_elapsed < 0.20 THEN
    RETURN jsonb_build_object('accepted', false, 'reason', 'rate_limited');
  END IF;

  v_dist := sqrt(power(p_x - v_mp.last_x, 2) + power(p_y - v_mp.last_y, 2));
  -- Walk speed is 205 px/s; allow 265 px/s headroom without accumulable flat bursts
  v_max_dist := GREATEST(16.0, v_elapsed * 265.0);

  IF v_dist > v_max_dist THEN
    RETURN jsonb_build_object('accepted', false, 'reason', 'speed_limit_exceeded');
  END IF;

  UPDATE public.match_players
  SET last_x = p_x, last_y = p_y, position_updated_at = now()
  WHERE id = v_mp.id;

  RETURN jsonb_build_object('accepted', true);
END;
$$;

-- ============================================================================
-- 6. HARDENED SUBMIT / UNLOCK / CLAIM / COMBAT / RESPAWN
-- ============================================================================
CREATE OR REPLACE FUNCTION public.submit_challenge_answer(
  p_match_id UUID,
  p_player_id UUID,
  p_question_id UUID,
  p_selected_index INT,
  p_item_key TEXT,
  p_challenge_kind TEXT,
  p_series_correct_count INT DEFAULT 1,
  p_series_total INT DEFAULT 1,
  p_session_token TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_match public.matches;
  v_q public.questions;
  v_mp public.match_players;
  v_mpq public.match_player_questions;
  v_is_correct BOOLEAN;
  v_points_delta INT := 0;
  v_bonus_delta INT := 0;
  v_hp_delta INT := 0;
  v_new_hp INT;
  v_new_score INT;
  v_new_coins INT;
  v_challenge_completed BOOLEAN := false;
  v_fragment JSONB := NULL;
  v_unlocked_gate TEXT := NULL;
  v_chest JSONB;
  v_bonus_item JSONB;
  v_gate_item JSONB;
  v_small_chests JSONB;
  v_fragments JSONB;
  v_challenges JSONB;
  v_gates JSONB;
  v_progress_map JSONB;
  v_large_completed BOOLEAN;
  v_required_count INT := 1;
  v_prev_progress INT := 0;
  v_new_progress INT := 0;
  v_item_already_done BOOLEAN := false;
  v_progress_key TEXT;
  v_raw_prog TEXT;
  v_raw_qc TEXT;
  v_clean_item_key TEXT := trim(COALESCE(p_item_key, ''));
  v_clean_kind TEXT := trim(COALESCE(p_challenge_kind, ''));
BEGIN
  PERFORM public.assert_player_session(p_player_id, p_session_token);

  IF p_selected_index IS NULL OR p_selected_index < -1 OR p_selected_index > 3 THEN
    RAISE EXCEPTION 'Indeks jawaban tidak valid';
  END IF;

  IF v_clean_item_key = '' OR v_clean_kind NOT IN (
    'small_chest', 'large_treasure', 'locked_gate', 'bonus_shrine', 'riddle_statue', 'secret_cache'
  ) THEN
    RAISE EXCEPTION 'Jenis tantangan atau item tidak valid';
  END IF;

  SELECT * INTO v_match FROM public.matches WHERE id = p_match_id;
  IF NOT FOUND OR v_match.status <> 'PLAYING' THEN
    RAISE EXCEPTION 'Pertandingan sudah berakhir atau tidak aktif';
  END IF;

  SELECT * INTO v_q FROM public.questions WHERE id = p_question_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Pertanyaan tidak ditemukan';
  END IF;

  IF upper(trim(v_q.education_level)) <> upper(trim(v_match.difficulty)) THEN
    RAISE EXCEPTION 'Pertanyaan tidak sesuai dengan jenjang pertandingan';
  END IF;

  SELECT * INTO v_mp
  FROM public.match_players
  WHERE match_id = p_match_id AND player_id = p_player_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Pemain tidak terdaftar dalam pertandingan';
  END IF;

  IF v_mp.is_dead THEN
    RAISE EXCEPTION 'Pemain sedang tumbang. Tunggu hingga bangkit kembali sebelum menjawab tantangan.';
  END IF;

  v_small_chests := CASE WHEN jsonb_typeof(v_mp.completed_small_chests) = 'array' THEN v_mp.completed_small_chests ELSE '[]'::jsonb END;
  v_fragments := CASE WHEN jsonb_typeof(v_mp.collected_fragments) = 'array' THEN v_mp.collected_fragments ELSE '[]'::jsonb END;
  v_challenges := CASE WHEN jsonb_typeof(v_mp.completed_challenges) = 'array' THEN v_mp.completed_challenges ELSE '[]'::jsonb END;
  v_gates := CASE WHEN jsonb_typeof(v_mp.unlocked_gates) = 'array' THEN v_mp.unlocked_gates ELSE '[]'::jsonb END;
  v_progress_map := CASE WHEN jsonb_typeof(v_mp.challenge_progress) = 'object' THEN v_mp.challenge_progress ELSE '{}'::jsonb END;
  v_large_completed := v_mp.large_treasure_completed;

  IF v_clean_kind = 'small_chest' THEN
    SELECT elem INTO v_chest
    FROM jsonb_array_elements(COALESCE(v_match.map_configuration->'smallChests', '[]'::jsonb)) elem
    WHERE elem->>'id' = v_clean_item_key
    LIMIT 1;
    IF v_chest IS NULL THEN
      RAISE EXCEPTION 'Small chest tidak terdaftar pada peta pertandingan ini';
    END IF;
    v_raw_qc := v_chest->>'questionCount';
    v_required_count := GREATEST(1, CASE WHEN v_raw_qc ~ '^\d+$' THEN v_raw_qc::int ELSE 2 END);
    v_item_already_done := (v_small_chests ? v_clean_item_key);

  ELSIF v_clean_kind = 'large_treasure' THEN
    IF COALESCE(v_match.map_configuration->'largeTreasure'->>'id', '') <> v_clean_item_key THEN
      RAISE EXCEPTION 'Large treasure tidak terdaftar pada peta pertandingan ini';
    END IF;
    IF NOT v_mp.large_treasure_unlocked THEN
      RAISE EXCEPTION 'Large Treasure masih terkunci. Kumpulkan fragmen kode dari Small Chest terlebih dahulu.';
    END IF;
    v_raw_qc := v_match.map_configuration->'largeTreasure'->>'questionCount';
    v_required_count := GREATEST(1, CASE WHEN v_raw_qc ~ '^\d+$' THEN v_raw_qc::int ELSE 3 END);
    v_item_already_done := v_large_completed;

  ELSIF v_clean_kind = 'locked_gate' THEN
    SELECT elem INTO v_gate_item
    FROM jsonb_array_elements(COALESCE(v_match.map_configuration->'gates', '[]'::jsonb)) elem
    WHERE elem->>'id' = v_clean_item_key
    LIMIT 1;
    IF v_gate_item IS NULL THEN
      RAISE EXCEPTION 'Gerbang tidak terdaftar pada peta pertandingan ini';
    END IF;
    v_required_count := 1;
    v_item_already_done := (v_gates ? v_clean_item_key);

  ELSE
    SELECT elem INTO v_bonus_item
    FROM jsonb_array_elements(COALESCE(v_match.map_configuration->'bonusChallenges', '[]'::jsonb)) elem
    WHERE elem->>'id' = v_clean_item_key
      AND elem->>'kind' = v_clean_kind
    LIMIT 1;
    IF v_bonus_item IS NULL THEN
      RAISE EXCEPTION 'Tantangan bonus tidak terdaftar pada peta pertandingan ini';
    END IF;
    IF (v_clean_kind = 'secret_cache' OR COALESCE(v_bonus_item->>'requiresKey', 'false') = 'true')
       AND NOT v_mp.has_secret_key THEN
      RAISE EXCEPTION 'Peti Rahasia ini membutuhkan Kunci Emas Hutan Utara.';
    END IF;
    v_required_count := 1;
    v_item_already_done := (v_challenges ? v_clean_item_key);
  END IF;

  v_progress_key := v_clean_kind || ':' || v_clean_item_key;
  v_raw_prog := v_progress_map ->> v_progress_key;
  v_prev_progress := CASE
    WHEN v_item_already_done THEN v_required_count
    WHEN v_raw_prog ~ '^\d+$' THEN GREATEST(0, v_raw_prog::int)
    ELSE 0
  END;

  SELECT * INTO v_mpq
  FROM public.match_player_questions
  WHERE match_id = p_match_id AND player_id = p_player_id AND question_id = p_question_id
  FOR UPDATE;

  IF FOUND AND v_mpq.answered_at IS NOT NULL THEN
    RETURN jsonb_build_object(
      'is_correct', COALESCE(v_mpq.is_correct, false),
      'correct_index', v_q.correct_answer,
      'explanation', v_q.explanation,
      'points_delta', 0,
      'bonus_points_delta', 0,
      'hp_delta', 0,
      'new_hp', v_mp.health,
      'new_score', v_mp.score,
      'new_coins', v_mp.coins,
      'challenge_completed', false,
      'fragment_awarded', NULL,
      'unlocked_gate_id', NULL,
      'series_correct_count', v_prev_progress,
      'series_total', v_required_count,
      'already_answered', true
    );
  END IF;

  v_is_correct := (p_selected_index = v_q.correct_answer);

  INSERT INTO public.match_player_questions (match_id, player_id, question_id, is_correct, answered_at)
  VALUES (p_match_id, p_player_id, p_question_id, v_is_correct, now())
  ON CONFLICT (match_id, player_id, question_id)
  DO UPDATE SET is_correct = EXCLUDED.is_correct, answered_at = now()
  WHERE public.match_player_questions.answered_at IS NULL;

  v_new_hp := v_mp.health;
  v_new_score := v_mp.score;
  v_new_coins := v_mp.coins;
  v_new_progress := v_prev_progress;

  IF v_is_correct THEN
    IF NOT v_item_already_done THEN
      v_new_progress := LEAST(v_required_count, v_prev_progress + 1);
      v_progress_map := jsonb_set(v_progress_map, ARRAY[v_progress_key], to_jsonb(v_new_progress), true);

      IF v_new_progress > v_prev_progress THEN
        IF v_clean_kind = 'small_chest' THEN
          v_points_delta := 10;
        ELSIF v_clean_kind = 'large_treasure' THEN
          v_points_delta := 20;
        ELSE
          v_points_delta := 15;
        END IF;
      END IF;

      IF v_new_progress >= v_required_count THEN
        v_challenge_completed := true;
        IF v_clean_kind = 'small_chest' THEN
          v_bonus_delta := 25;
          v_small_chests := v_small_chests || to_jsonb(v_clean_item_key);
          v_fragment := jsonb_build_object(
            'chestId', v_clean_item_key,
            'chestName', COALESCE(v_chest->>'name', v_clean_item_key),
            'code', COALESCE(v_chest->>'fragmentCode', 'RUNE'),
            'earnedAt', now()
          );
          v_fragments := v_fragments || jsonb_build_array(v_fragment);
        ELSIF v_clean_kind = 'large_treasure' THEN
          v_large_completed := true;
        ELSIF v_clean_kind = 'locked_gate' THEN
          v_gates := v_gates || to_jsonb(v_clean_item_key);
          v_challenges := v_challenges || to_jsonb(v_clean_item_key);
          v_unlocked_gate := v_clean_item_key;
        ELSE
          v_challenges := v_challenges || to_jsonb(v_clean_item_key);
        END IF;
      END IF;
    END IF;

    v_new_score := v_mp.score + v_points_delta + v_bonus_delta;
    v_new_coins := v_mp.coins + v_points_delta + v_bonus_delta;

    UPDATE public.match_players
    SET score = v_new_score,
        coins = v_new_coins,
        correct_answers = correct_answers + 1,
        opened_chests = opened_chests + CASE WHEN v_clean_kind = 'small_chest' AND v_challenge_completed THEN 1 ELSE 0 END,
        clues_found = clues_found + CASE WHEN v_challenge_completed THEN 1 ELSE 0 END,
        completed_small_chests = v_small_chests,
        collected_fragments = v_fragments,
        completed_challenges = v_challenges,
        unlocked_gates = v_gates,
        large_treasure_completed = v_large_completed,
        challenge_progress = v_progress_map
    WHERE id = v_mp.id;
  ELSE
    v_hp_delta := -5;
    v_new_hp := GREATEST(10, v_mp.health - 5);

    UPDATE public.match_players
    SET health = v_new_hp,
        incorrect_answers = incorrect_answers + 1
    WHERE id = v_mp.id;
  END IF;

  INSERT INTO public.match_events (match_id, player_id, event_type, event_data)
  VALUES (p_match_id, p_player_id, 'CHALLENGE_ANSWERED', jsonb_build_object(
    'challenge_kind', v_clean_kind,
    'item_key', v_clean_item_key,
    'is_correct', v_is_correct,
    'points', v_points_delta + v_bonus_delta,
    'progress', v_new_progress,
    'required', v_required_count
  ));

  RETURN jsonb_build_object(
    'is_correct', v_is_correct,
    'correct_index', v_q.correct_answer,
    'explanation', v_q.explanation,
    'points_delta', v_points_delta,
    'bonus_points_delta', v_bonus_delta,
    'hp_delta', v_hp_delta,
    'new_hp', v_new_hp,
    'new_score', v_new_score,
    'new_coins', v_new_coins,
    'challenge_completed', v_challenge_completed,
    'fragment_awarded', v_fragment,
    'unlocked_gate_id', v_unlocked_gate,
    'series_correct_count', v_new_progress,
    'series_total', v_required_count,
    'already_answered', false
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.unlock_large_treasure(
  p_match_id UUID,
  p_player_id UUID,
  p_submitted_codes JSONB,
  p_session_token TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_match public.matches;
  v_mp public.match_players;
  v_small_chests JSONB;
  v_total_chests INT;
  v_completed_count INT;
  v_chest JSONB;
  v_expected TEXT;
  v_submitted TEXT;
  v_idx INT := 0;
  v_new_score INT;
BEGIN
  PERFORM public.assert_player_session(p_player_id, p_session_token);

  SELECT * INTO v_match FROM public.matches WHERE id = p_match_id;
  IF NOT FOUND OR v_match.status <> 'PLAYING' THEN
    RAISE EXCEPTION 'Pertandingan tidak aktif';
  END IF;

  SELECT * INTO v_mp FROM public.match_players WHERE match_id = p_match_id AND player_id = p_player_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Pemain tidak ditemukan';
  END IF;

  IF v_mp.is_dead THEN
    RAISE EXCEPTION 'Pemain sedang tumbang';
  END IF;

  IF v_mp.large_treasure_unlocked THEN
    RETURN jsonb_build_object(
      'unlocked', true,
      'points_awarded', 0,
      'new_score', v_mp.score,
      'message', 'Large Treasure sudah terbuka!'
    );
  END IF;

  IF p_submitted_codes IS NULL OR jsonb_typeof(p_submitted_codes) <> 'array' THEN
    RETURN jsonb_build_object(
      'unlocked', false,
      'points_awarded', 0,
      'new_score', v_mp.score,
      'message', 'Format kode fragmen tidak valid.'
    );
  END IF;

  v_small_chests := CASE
    WHEN jsonb_typeof(v_match.map_configuration->'smallChests') = 'array'
    THEN v_match.map_configuration->'smallChests'
    ELSE '[]'::jsonb
  END;
  v_total_chests := jsonb_array_length(v_small_chests);
  v_completed_count := CASE
    WHEN jsonb_typeof(v_mp.completed_small_chests) = 'array'
    THEN jsonb_array_length(v_mp.completed_small_chests)
    ELSE 0
  END;

  IF v_completed_count < v_total_chests THEN
    RETURN jsonb_build_object(
      'unlocked', false,
      'points_awarded', 0,
      'new_score', v_mp.score,
      'message', format('Selesaikan semua %s Small Chest terlebih dahulu (%s/%s selesai).', v_total_chests, v_completed_count, v_total_chests)
    );
  END IF;

  IF jsonb_array_length(p_submitted_codes) < v_total_chests THEN
    RETURN jsonb_build_object(
      'unlocked', false,
      'points_awarded', 0,
      'new_score', v_mp.score,
      'message', 'Masukkan seluruh kode fragmen dari semua Small Chest.'
    );
  END IF;

  FOR v_chest IN SELECT * FROM jsonb_array_elements(v_small_chests) LOOP
    v_expected := upper(trim(COALESCE(v_chest->>'fragmentCode', '')));
    v_submitted := CASE
      WHEN jsonb_typeof(p_submitted_codes->v_idx) = 'string'
      THEN upper(trim(p_submitted_codes->>v_idx))
      ELSE ''
    END;
    IF v_submitted <> v_expected THEN
      RETURN jsonb_build_object(
        'unlocked', false,
        'points_awarded', 0,
        'new_score', v_mp.score,
        'message', format('Kode segel ke-%s (%s) belum tepat. Periksa kembali fragmen di Jurnal Petualanganmu!', v_idx + 1, COALESCE(v_chest->>'name', ''))
      );
    END IF;
    v_idx := v_idx + 1;
  END LOOP;

  v_new_score := v_mp.score + 50;

  UPDATE public.match_players
  SET large_treasure_unlocked = true,
      score = v_new_score,
      coins = coins + 50
  WHERE id = v_mp.id;

  INSERT INTO public.match_events (match_id, player_id, event_type, event_data)
  VALUES (p_match_id, p_player_id, 'LARGE_TREASURE_UNLOCKED', '{}'::jsonb);

  RETURN jsonb_build_object(
    'unlocked', true,
    'points_awarded', 50,
    'new_score', v_new_score,
    'message', 'Segel Large Treasure berhasil dibuka! (+50 Poin)'
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.claim_secret_treasure(
  p_match_id UUID,
  p_player_id UUID,
  p_player_pos JSONB,
  p_session_token TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_match public.matches;
  v_mp public.match_players;
  v_max_px DOUBLE PRECISION;
  v_max_py DOUBLE PRECISION;
  v_pos RECORD;
  v_tx DOUBLE PRECISION;
  v_ty DOUBLE PRECISION;
  v_dist DOUBLE PRECISION;
  v_elapsed DOUBLE PRECISION;
  v_max_reach DOUBLE PRECISION;
  v_gates JSONB;
BEGIN
  PERFORM public.assert_player_session(p_player_id, p_session_token);

  SELECT * INTO v_match FROM public.matches WHERE id = p_match_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Match not found';
  END IF;

  IF v_match.status <> 'PLAYING' OR v_match.winner_player_id IS NOT NULL THEN
    RETURN jsonb_build_object('claimed', false, 'winner_player_id', v_match.winner_player_id);
  END IF;

  SELECT * INTO v_mp FROM public.match_players WHERE match_id = p_match_id AND player_id = p_player_id FOR UPDATE;
  IF NOT FOUND OR v_mp.is_dead THEN
    RETURN jsonb_build_object('claimed', false, 'reason', 'invalid_player');
  END IF;

  IF NOT v_mp.large_treasure_completed THEN
    RETURN jsonb_build_object('claimed', false, 'reason', 'large_treasure_incomplete');
  END IF;

  v_gates := CASE WHEN jsonb_typeof(v_mp.unlocked_gates) = 'array' THEN v_mp.unlocked_gates ELSE '[]'::jsonb END;
  IF NOT (v_gates ? 'gate_temple_sanctum') THEN
    RETURN jsonb_build_object('claimed', false, 'reason', 'gate_not_unlocked');
  END IF;

  v_max_px := COALESCE((v_match.map_configuration->>'worldWidth')::double precision, 200)
              * COALESCE((v_match.map_configuration->>'tileSize')::double precision, 32);
  v_max_py := COALESCE((v_match.map_configuration->>'worldHeight')::double precision, 150)
              * COALESCE((v_match.map_configuration->>'tileSize')::double precision, 32);

  SELECT * INTO v_pos FROM public._extract_finite_xy(p_player_pos, v_max_px, v_max_py);
  IF NOT v_pos.ok THEN
    RETURN jsonb_build_object('claimed', false, 'reason', 'invalid_position');
  END IF;

  -- Cross-check against last server-stored position and elapsed server time (anti-teleport)
  IF v_mp.last_x IS NOT NULL AND v_mp.last_y IS NOT NULL THEN
    v_elapsed := GREATEST(0.0, EXTRACT(EPOCH FROM (now() - COALESCE(v_mp.position_updated_at, v_match.started_at))));
    v_max_reach := (v_elapsed * 265.0) + 120.0;
    IF sqrt(power(v_pos.x - v_mp.last_x, 2) + power(v_pos.y - v_mp.last_y, 2)) > v_max_reach THEN
      RETURN jsonb_build_object('claimed', false, 'reason', 'position_desync');
    END IF;
  END IF;

  v_tx := ((v_match.map_configuration->'secretTreasure'->>'tileX')::double precision + 0.5)
          * (v_match.map_configuration->>'tileSize')::double precision;
  v_ty := ((v_match.map_configuration->'secretTreasure'->>'tileY')::double precision + 0.5)
          * (v_match.map_configuration->>'tileSize')::double precision;

  v_dist := sqrt(power(v_pos.x - v_tx, 2) + power(v_pos.y - v_ty, 2));
  IF v_dist > 140 THEN
    RETURN jsonb_build_object('claimed', false, 'reason', 'too_far');
  END IF;

  UPDATE public.matches
  SET status = 'FINISHED',
      winner_player_id = p_player_id,
      finished_at = now()
  WHERE id = p_match_id AND status = 'PLAYING' AND winner_player_id IS NULL
  RETURNING * INTO v_match;

  IF NOT FOUND THEN
    SELECT * INTO v_match FROM public.matches WHERE id = p_match_id;
    RETURN jsonb_build_object('claimed', false, 'winner_player_id', v_match.winner_player_id);
  END IF;

  UPDATE public.rooms SET status = 'FINISHED' WHERE id = v_match.room_id;
  UPDATE public.match_players
  SET score = score + 100,
      coins = coins + 100,
      last_x = v_pos.x,
      last_y = v_pos.y,
      position_updated_at = now(),
      final_position = jsonb_build_object('x', v_pos.x, 'y', v_pos.y)
  WHERE id = v_mp.id;

  INSERT INTO public.match_events (match_id, player_id, event_type, event_data)
  VALUES (p_match_id, p_player_id, 'SECRET_TREASURE_CLAIMED', jsonb_build_object('x', v_pos.x, 'y', v_pos.y));

  RETURN jsonb_build_object('claimed', true, 'winner_player_id', p_player_id, 'finished_at', v_match.finished_at);
END;
$$;

CREATE OR REPLACE FUNCTION public.record_attack_hit(
  p_match_id UUID,
  p_attacker_id UUID,
  p_target_id UUID,
  p_attacker_pos JSONB,
  p_target_pos JSONB,
  p_session_token TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_first_id UUID;
  v_second_id UUID;
  v_first_row public.match_players;
  v_second_row public.match_players;
  v_attacker public.match_players;
  v_target public.match_players;
  v_match public.matches;
  v_max_px DOUBLE PRECISION;
  v_max_py DOUBLE PRECISION;
  v_apos RECORD;
  v_tpos RECORD;
  v_elapsed DOUBLE PRECISION;
  v_dist DOUBLE PRECISION;
  v_new_hp INT;
  v_is_dead BOOLEAN := false;
  v_respawn TIMESTAMPTZ := NULL;
BEGIN
  PERFORM public.assert_player_session(p_attacker_id, p_session_token);

  IF p_attacker_id = p_target_id THEN
    RETURN jsonb_build_object('applied', false, 'reason', 'self_attack_forbidden');
  END IF;

  SELECT * INTO v_match FROM public.matches WHERE id = p_match_id;
  IF NOT FOUND OR v_match.status <> 'PLAYING' THEN
    RETURN jsonb_build_object('applied', false, 'reason', 'match_not_active');
  END IF;

  v_max_px := COALESCE((v_match.map_configuration->>'worldWidth')::double precision, 200)
              * COALESCE((v_match.map_configuration->>'tileSize')::double precision, 32);
  v_max_py := COALESCE((v_match.map_configuration->>'worldHeight')::double precision, 150)
              * COALESCE((v_match.map_configuration->>'tileSize')::double precision, 32);

  SELECT * INTO v_apos FROM public._extract_finite_xy(p_attacker_pos, v_max_px, v_max_py);
  SELECT * INTO v_tpos FROM public._extract_finite_xy(p_target_pos, v_max_px, v_max_py);
  IF NOT v_apos.ok OR NOT v_tpos.ok THEN
    RETURN jsonb_build_object('applied', false, 'reason', 'invalid_position');
  END IF;

  -- Lock match_players rows in deterministic UUID order to prevent AB-BA deadlocks
  IF p_attacker_id < p_target_id THEN
    v_first_id := p_attacker_id;
    v_second_id := p_target_id;
  ELSE
    v_first_id := p_target_id;
    v_second_id := p_attacker_id;
  END IF;

  SELECT * INTO v_first_row
  FROM public.match_players
  WHERE match_id = p_match_id AND player_id = v_first_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('applied', false, 'reason', 'player_not_in_match');
  END IF;

  SELECT * INTO v_second_row
  FROM public.match_players
  WHERE match_id = p_match_id AND player_id = v_second_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('applied', false, 'reason', 'player_not_in_match');
  END IF;

  IF p_attacker_id < p_target_id THEN
    v_attacker := v_first_row;
    v_target := v_second_row;
  ELSE
    v_attacker := v_second_row;
    v_target := v_first_row;
  END IF;

  IF v_attacker.is_dead THEN
    RETURN jsonb_build_object('applied', false, 'reason', 'attacker_dead');
  END IF;

  IF v_target.is_dead THEN
    RETURN jsonb_build_object('applied', false, 'reason', 'target_already_dead');
  END IF;

  IF v_target.invulnerable_until IS NOT NULL AND v_target.invulnerable_until > now() THEN
    RETURN jsonb_build_object('applied', false, 'reason', 'target_invulnerable');
  END IF;

  IF v_attacker.last_attack_at IS NOT NULL AND v_attacker.last_attack_at > now() - interval '850 milliseconds' THEN
    RETURN jsonb_build_object('applied', false, 'reason', 'cooldown_active');
  END IF;

  -- Cross-check attacker position against attacker's server-stored position
  IF v_attacker.last_x IS NOT NULL AND v_attacker.last_y IS NOT NULL THEN
    v_elapsed := GREATEST(0.0, EXTRACT(EPOCH FROM (now() - COALESCE(v_attacker.position_updated_at, v_match.started_at))));
    IF sqrt(power(v_apos.x - v_attacker.last_x, 2) + power(v_apos.y - v_attacker.last_y, 2)) > (v_elapsed * 265.0 + 140.0) THEN
      RETURN jsonb_build_object('applied', false, 'reason', 'attacker_position_desync');
    END IF;
  END IF;

  -- Cross-check reported target position against target's own server-stored position
  IF v_target.last_x IS NOT NULL AND v_target.last_y IS NOT NULL THEN
    v_elapsed := GREATEST(0.0, EXTRACT(EPOCH FROM (now() - COALESCE(v_target.position_updated_at, v_match.started_at))));
    IF sqrt(power(v_tpos.x - v_target.last_x, 2) + power(v_tpos.y - v_target.last_y, 2)) > (v_elapsed * 265.0 + 260.0) THEN
      RETURN jsonb_build_object('applied', false, 'reason', 'target_position_desync');
    END IF;
  END IF;

  v_dist := sqrt(power(v_apos.x - v_tpos.x, 2) + power(v_apos.y - v_tpos.y, 2));
  IF v_dist > 420 THEN
    RETURN jsonb_build_object('applied', false, 'reason', 'out_of_range');
  END IF;

  v_new_hp := GREATEST(0, v_target.health - 20);
  IF v_new_hp <= 0 THEN
    v_is_dead := true;
    v_respawn := now() + interval '5 seconds';
  END IF;

  UPDATE public.match_players
  SET last_attack_at = now(),
      total_attacks = total_attacks + 1,
      last_x = v_apos.x,
      last_y = v_apos.y,
      position_updated_at = now()
  WHERE id = v_attacker.id;

  UPDATE public.match_players
  SET health = v_new_hp, is_dead = v_is_dead, respawn_at = v_respawn
  WHERE id = v_target.id;

  INSERT INTO public.match_events (match_id, player_id, event_type, event_data)
  VALUES (p_match_id, p_attacker_id, 'PLAYER_HIT', jsonb_build_object('target_id', p_target_id, 'new_hp', v_new_hp, 'is_dead', v_is_dead));

  RETURN jsonb_build_object(
    'applied', true,
    'target_id', p_target_id,
    'new_hp', v_new_hp,
    'is_dead', v_is_dead,
    'respawn_at', v_respawn
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.complete_respawn(
  p_match_id UUID,
  p_player_id UUID,
  p_session_token TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_match public.matches;
  v_mp public.match_players;
  v_invuln TIMESTAMPTZ := now() + interval '2 seconds';
BEGIN
  PERFORM public.assert_player_session(p_player_id, p_session_token);

  SELECT * INTO v_match FROM public.matches WHERE id = p_match_id;
  IF NOT FOUND OR v_match.status <> 'PLAYING' THEN
    RETURN jsonb_build_object('respawned', false, 'reason', 'match_not_active');
  END IF;

  SELECT * INTO v_mp FROM public.match_players WHERE match_id = p_match_id AND player_id = p_player_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('respawned', false, 'reason', 'player_not_found');
  END IF;

  IF NOT v_mp.is_dead THEN
    RETURN jsonb_build_object('respawned', false, 'reason', 'already_alive', 'health', v_mp.health);
  END IF;

  IF v_mp.respawn_at IS NOT NULL AND v_mp.respawn_at > now() + interval '250 milliseconds' THEN
    RETURN jsonb_build_object('respawned', false, 'reason', 'respawn_timer_active');
  END IF;

  UPDATE public.match_players
  SET health = 100,
      is_dead = false,
      respawn_at = NULL,
      invulnerable_until = v_invuln,
      position_updated_at = now()
  WHERE id = v_mp.id;

  RETURN jsonb_build_object('respawned', true, 'health', 100, 'invulnerable_until', v_invuln);
END;
$$;

-- ============================================================================
-- 7. EXPLICIT RPC PERMISSION HARDENING (REVOKE PUBLIC + STRICT ROLE GRANTS)
-- ============================================================================
-- Internal helpers & obsolete 001 functions: strictly no PUBLIC, anon, or authenticated access
REVOKE ALL ON FUNCTION public.assert_player_session(UUID, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._extract_finite_xy(JSONB, DOUBLE PRECISION, DOUBLE PRECISION) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._validate_map_configuration(JSONB) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._create_match_for_room(public.rooms, UUID, TEXT, JSONB) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.cleanup_expired_rooms() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.create_player_profile(TEXT, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.open_normal_chest(UUID, UUID, TEXT, INT, BOOLEAN) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_next_question(UUID, UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.submit_quiz_answer(UUID, UUID, UUID, INT, TEXT, TEXT) FROM PUBLIC, anon, authenticated;

-- Revoke default PUBLIC EXECUTE on all active SECURITY DEFINER RPCs, then grant ONLY to anon, authenticated
REVOKE ALL ON FUNCTION public.create_player_session(TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.create_room(UUID, TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.set_room_difficulty(UUID, UUID, TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.join_room(TEXT, UUID, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.set_room_player_connected(UUID, UUID, BOOLEAN, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.transfer_host(UUID, UUID, UUID, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.leave_room(UUID, UUID, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.rejoin_session(UUID, UUID, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.start_match(UUID, UUID, TEXT, JSONB, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.play_again(UUID, UUID, TEXT, JSONB, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.update_player_position(UUID, UUID, DOUBLE PRECISION, DOUBLE PRECISION, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_challenge_questions(UUID, UUID, TEXT, TEXT, INT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.submit_challenge_answer(UUID, UUID, UUID, INT, TEXT, TEXT, INT, INT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.unlock_large_treasure(UUID, UUID, JSONB, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.activate_switch_or_key(UUID, UUID, TEXT, TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.claim_secret_treasure(UUID, UUID, JSONB, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.record_attack_hit(UUID, UUID, UUID, JSONB, JSONB, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.complete_respawn(UUID, UUID, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.collect_apple(UUID, UUID, TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.use_apple(UUID, UUID, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.apply_trap_damage(UUID, UUID, TEXT) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.create_player_session(TEXT, TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_room(UUID, TEXT, TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_room_difficulty(UUID, UUID, TEXT, TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.join_room(TEXT, UUID, TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_room_player_connected(UUID, UUID, BOOLEAN, TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.transfer_host(UUID, UUID, UUID, TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.leave_room(UUID, UUID, TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rejoin_session(UUID, UUID, TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.start_match(UUID, UUID, TEXT, JSONB, TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.play_again(UUID, UUID, TEXT, JSONB, TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.update_player_position(UUID, UUID, DOUBLE PRECISION, DOUBLE PRECISION, TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_challenge_questions(UUID, UUID, TEXT, TEXT, INT, TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.submit_challenge_answer(UUID, UUID, UUID, INT, TEXT, TEXT, INT, INT, TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.unlock_large_treasure(UUID, UUID, JSONB, TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.activate_switch_or_key(UUID, UUID, TEXT, TEXT, TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_secret_treasure(UUID, UUID, JSONB, TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_attack_hit(UUID, UUID, UUID, JSONB, JSONB, TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.complete_respawn(UUID, UUID, TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.collect_apple(UUID, UUID, TEXT, TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.use_apple(UUID, UUID, TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_trap_damage(UUID, UUID, TEXT) TO anon, authenticated;
