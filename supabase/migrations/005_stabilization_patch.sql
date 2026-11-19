-- TREASUREBOUND: The Lost Secret — V2.1 Stabilization & Security Patch
-- Safe, non-destructive incremental migration on top of 001–004.
-- Fixes:
--   1. Per-player secret session tokens (player_sessions + assert_player_session) on all
--      SECURITY DEFINER RPCs so anon/authenticated clients cannot spoof another player's ID.
--   2. Duplicate answer farming & duplicate wrong-answer protection (immediate no-op return
--      when v_already_answered = true, serialized via FOR UPDATE lock on match_players).
--   3. Strict map_configuration item & challenge_kind validation on submit_challenge_answer
--      and activate_switch_or_key (plus server-enforced secret_cache key requirement).
--   4. Namespaced challenge_progress keys (challenge_kind || ':' || item_key) preventing
--      collisions across challenge types.
--   5. Match lifecycle hardening: start_match (WAITING only, idempotent on PLAYING, rejects FINISHED),
--      play_again (FINISHED only, idempotent on PLAYING, rejects WAITING), and host migration
--      during WAITING, PLAYING, and FINISHED.
--   6. Authorized question retrieval (get_challenge_questions enforces session, match membership,
--      PLAYING status, alive state, and server-side match difficulty) without burning unanswered questions.
--   7. Safe leave_room during PLAYING/FINISHED & session recovery via rejoin_session.

-- 1. Schema additions (non-destructive)
ALTER TABLE public.match_players
  ADD COLUMN IF NOT EXISTS challenge_progress JSONB NOT NULL DEFAULT '{}'::jsonb;

CREATE TABLE IF NOT EXISTS public.player_sessions (
  player_id UUID PRIMARY KEY REFERENCES public.players(id) ON DELETE CASCADE,
  session_token TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.player_sessions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.player_sessions FROM anon, authenticated;
DROP POLICY IF EXISTS "Deny direct player_sessions read" ON public.player_sessions;
CREATE POLICY "Deny direct player_sessions read"
  ON public.player_sessions FOR SELECT TO anon, authenticated USING (false);

-- 2. Internal session assertion helper (not directly callable by clients)
CREATE OR REPLACE FUNCTION public.assert_player_session(
  p_player_id UUID,
  p_session_token TEXT
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_player_id IS NULL OR NULLIF(trim(COALESCE(p_session_token, '')), '') IS NULL THEN
    RAISE EXCEPTION 'Token sesi pemain diperlukan';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.player_sessions ps
    WHERE ps.player_id = p_player_id
      AND ps.session_token = p_session_token
  ) THEN
    RAISE EXCEPTION 'Otorisasi pemain tidak valid';
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.assert_player_session(UUID, TEXT) FROM PUBLIC, anon, authenticated;

-- 3. Player creation with server-generated session token
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
BEGIN
  v_clean_name := trim(COALESCE(p_username, ''));
  IF char_length(v_clean_name) < 3 OR char_length(v_clean_name) > 16 THEN
    RAISE EXCEPTION 'Nama penjelajah harus antara 3 hingga 16 karakter';
  END IF;
  IF p_character_id NOT IN ('kai', 'lina', 'bima', 'sora') THEN
    RAISE EXCEPTION 'Karakter tidak valid';
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

-- 4. Room creation, difficulty config, join & connection tracking
DROP FUNCTION IF EXISTS public.create_room(UUID);
DROP FUNCTION IF EXISTS public.create_room(UUID, TEXT);
CREATE OR REPLACE FUNCTION public.create_room(
  p_player_id UUID,
  p_difficulty TEXT DEFAULT 'SMA',
  p_session_token TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_code TEXT;
  v_chars TEXT := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  v_room public.rooms;
  v_attempt INT := 0;
  v_diff TEXT := upper(trim(COALESCE(p_difficulty, 'SMA')));
BEGIN
  PERFORM public.assert_player_session(p_player_id, p_session_token);

  IF v_diff NOT IN ('SD', 'SMP', 'SMA') THEN
    RAISE EXCEPTION 'Tingkat kesulitan harus SD, SMP, atau SMA';
  END IF;

  PERFORM public.cleanup_expired_rooms();

  LOOP
    v_attempt := v_attempt + 1;
    v_code := '';
    FOR i IN 1..6 LOOP
      v_code := v_code || substr(v_chars, 1 + floor(random() * length(v_chars))::int, 1);
    END LOOP;

    IF NOT EXISTS (SELECT 1 FROM public.rooms WHERE room_code = v_code) THEN
      EXIT;
    END IF;
    IF v_attempt > 20 THEN
      RAISE EXCEPTION 'Failed to allocate unique room code';
    END IF;
  END LOOP;

  INSERT INTO public.rooms (room_code, host_player_id, status, max_players, difficulty, expires_at)
  VALUES (v_code, p_player_id, 'WAITING', 10, v_diff, now() + interval '4 hours')
  RETURNING * INTO v_room;

  INSERT INTO public.room_players (room_id, player_id, is_host, is_connected)
  VALUES (v_room.id, p_player_id, true, true);

  RETURN jsonb_build_object('room', to_jsonb(v_room));
END;
$$;

DROP FUNCTION IF EXISTS public.set_room_difficulty(UUID, UUID, TEXT);
CREATE OR REPLACE FUNCTION public.set_room_difficulty(
  p_room_id UUID,
  p_host_player_id UUID,
  p_difficulty TEXT,
  p_session_token TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_room public.rooms;
  v_diff TEXT := upper(trim(COALESCE(p_difficulty, 'SMA')));
BEGIN
  PERFORM public.assert_player_session(p_host_player_id, p_session_token);

  IF v_diff NOT IN ('SD', 'SMP', 'SMA') THEN
    RAISE EXCEPTION 'Tingkat kesulitan tidak valid';
  END IF;

  SELECT * INTO v_room FROM public.rooms WHERE id = p_room_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Room tidak ditemukan';
  END IF;

  IF v_room.host_player_id <> p_host_player_id THEN
    RAISE EXCEPTION 'Hanya host room yang dapat mengubah tingkat pendidikan';
  END IF;

  IF v_room.status <> 'WAITING' THEN
    RAISE EXCEPTION 'Tingkat pendidikan tidak dapat diubah setelah permainan dimulai';
  END IF;

  UPDATE public.rooms
  SET difficulty = v_diff
  WHERE id = p_room_id
  RETURNING * INTO v_room;

  RETURN jsonb_build_object('room', to_jsonb(v_room));
END;
$$;

DROP FUNCTION IF EXISTS public.join_room(TEXT, UUID);
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
  WHERE room_code = upper(trim(p_room_code))
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
    UPDATE public.room_players SET is_connected = true WHERE room_id = v_room.id AND player_id = p_player_id;
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

  INSERT INTO public.room_players (room_id, player_id, is_host, is_connected)
  VALUES (v_room.id, p_player_id, false, true);

  RETURN jsonb_build_object('room', to_jsonb(v_room));
END;
$$;

DROP FUNCTION IF EXISTS public.set_room_player_connected(UUID, UUID, BOOLEAN);
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
BEGIN
  PERFORM public.assert_player_session(p_player_id, p_session_token);

  UPDATE public.room_players rp
  SET is_connected = COALESCE(p_is_connected, true)
  FROM public.rooms r
  WHERE rp.room_id = r.id
    AND rp.room_id = p_room_id
    AND rp.player_id = p_player_id
    AND r.expires_at >= now();

  RETURN FOUND;
END;
$$;

-- 5. Host migration across WAITING, PLAYING, and FINISHED (authorized to room members only)
DROP FUNCTION IF EXISTS public.transfer_host(UUID, UUID);
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
  v_next_host UUID;
BEGIN
  PERFORM public.assert_player_session(p_caller_player_id, p_session_token);

  SELECT * INTO v_room FROM public.rooms WHERE id = p_room_id FOR UPDATE;
  IF NOT FOUND THEN RETURN NULL; END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.room_players
    WHERE room_id = p_room_id AND player_id = p_caller_player_id
  ) THEN
    RAISE EXCEPTION 'Hanya anggota room yang dapat memperbarui status koneksi room';
  END IF;

  UPDATE public.room_players
  SET is_connected = false
  WHERE room_id = p_room_id AND player_id = p_disconnected_player_id;

  IF v_room.host_player_id = p_disconnected_player_id
     AND v_room.status IN ('WAITING', 'PLAYING', 'FINISHED') THEN
    SELECT player_id INTO v_next_host
    FROM public.room_players
    WHERE room_id = p_room_id
      AND player_id <> p_disconnected_player_id
      AND is_connected = true
    ORDER BY joined_at ASC
    LIMIT 1;

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

-- 6. Safe leave_room (never cascade-deletes active/finished matches)
DROP FUNCTION IF EXISTS public.leave_room(UUID, UUID);
CREATE OR REPLACE FUNCTION public.leave_room(
  p_room_id UUID,
  p_player_id UUID,
  p_session_token TEXT DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_room public.rooms;
  v_next_host UUID;
BEGIN
  PERFORM public.assert_player_session(p_player_id, p_session_token);

  SELECT * INTO v_room FROM public.rooms WHERE id = p_room_id FOR UPDATE;
  IF NOT FOUND THEN RETURN; END IF;

  IF v_room.status = 'WAITING' THEN
    DELETE FROM public.room_players WHERE room_id = p_room_id AND player_id = p_player_id;

    SELECT player_id INTO v_next_host
    FROM public.room_players
    WHERE room_id = p_room_id
    ORDER BY is_connected DESC, joined_at ASC
    LIMIT 1;

    IF v_next_host IS NULL THEN
      DELETE FROM public.rooms WHERE id = p_room_id;
    ELSIF v_room.host_player_id = p_player_id THEN
      UPDATE public.rooms SET host_player_id = v_next_host WHERE id = p_room_id;
      UPDATE public.room_players SET is_host = (player_id = v_next_host) WHERE room_id = p_room_id;
    END IF;
  ELSE
    UPDATE public.room_players
    SET is_connected = false
    WHERE room_id = p_room_id AND player_id = p_player_id;

    IF v_room.host_player_id = p_player_id THEN
      SELECT player_id INTO v_next_host
      FROM public.room_players
      WHERE room_id = p_room_id AND player_id <> p_player_id AND is_connected = true
      ORDER BY joined_at ASC
      LIMIT 1;

      IF v_next_host IS NULL THEN
        SELECT player_id INTO v_next_host
        FROM public.room_players
        WHERE room_id = p_room_id AND player_id <> p_player_id
        ORDER BY joined_at ASC
        LIMIT 1;
      END IF;

      IF v_next_host IS NOT NULL THEN
        UPDATE public.rooms SET host_player_id = v_next_host WHERE id = p_room_id;
        UPDATE public.room_players SET is_host = (player_id = v_next_host) WHERE room_id = p_room_id;
      END IF;
    END IF;
  END IF;
END;
$$;

-- 7. Session recovery RPC
DROP FUNCTION IF EXISTS public.rejoin_session(UUID, UUID);
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
  SET is_connected = true
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

-- 8. Match lifecycle: start_match & play_again with strict state guards and duplicate prevention
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
BEGIN
  IF NULLIF(trim(COALESCE(p_seed, '')), '') IS NULL THEN
    RAISE EXCEPTION 'Seed peta tidak valid';
  END IF;

  IF p_map_configuration IS NULL
     OR jsonb_typeof(p_map_configuration) <> 'object'
     OR jsonb_typeof(p_map_configuration->'smallChests') <> 'array'
     OR jsonb_array_length(p_map_configuration->'smallChests') = 0
     OR jsonb_typeof(p_map_configuration->'largeTreasure') <> 'object'
     OR jsonb_typeof(p_map_configuration->'secretTreasure') <> 'object' THEN
    RAISE EXCEPTION 'Konfigurasi peta tidak valid';
  END IF;

  UPDATE public.room_players
  SET is_connected = true
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

  INSERT INTO public.match_players (
    match_id, player_id, health, apples, coins, score,
    completed_small_chests, collected_fragments, completed_challenges,
    unlocked_gates, activated_switches, has_secret_key,
    large_treasure_unlocked, large_treasure_completed, challenge_progress
  )
  SELECT
    v_match.id, rp.player_id, 100, 0, 0, 0,
    '[]'::jsonb, '[]'::jsonb, '[]'::jsonb,
    '[]'::jsonb, '[]'::jsonb, false,
    false, false, '{}'::jsonb
  FROM public.room_players rp
  WHERE rp.room_id = p_room.id AND rp.is_connected = true;

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

DROP FUNCTION IF EXISTS public.start_match(UUID, UUID, TEXT, JSONB);
CREATE OR REPLACE FUNCTION public.start_match(
  p_room_id UUID,
  p_host_player_id UUID,
  p_seed TEXT,
  p_map_configuration JSONB,
  p_session_token TEXT DEFAULT NULL
)
RETURNS public.matches
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_room public.rooms;
  v_match public.matches;
BEGIN
  PERFORM public.assert_player_session(p_host_player_id, p_session_token);

  SELECT * INTO v_room FROM public.rooms WHERE id = p_room_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Room tidak ditemukan';
  END IF;

  IF v_room.expires_at < now() THEN
    RAISE EXCEPTION 'Room sudah kedaluwarsa';
  END IF;

  IF v_room.host_player_id <> p_host_player_id THEN
    RAISE EXCEPTION 'Hanya host room yang dapat memulai pertandingan';
  END IF;

  IF v_room.status = 'PLAYING' THEN
    SELECT * INTO v_match
    FROM public.matches
    WHERE room_id = p_room_id AND status = 'PLAYING'
    ORDER BY started_at DESC
    LIMIT 1;
    IF FOUND THEN
      RETURN v_match;
    END IF;
    RAISE EXCEPTION 'Status room sedang berlangsung tanpa pertandingan aktif';
  END IF;

  IF v_room.status = 'FINISHED' THEN
    RAISE EXCEPTION 'Pertandingan sudah selesai. Gunakan Main Lagi untuk memulai ronde baru.';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.matches WHERE room_id = p_room_id AND status = 'PLAYING'
  ) THEN
    RAISE EXCEPTION 'Sudah ada pertandingan aktif pada room ini';
  END IF;

  RETURN public._create_match_for_room(v_room, p_host_player_id, p_seed, p_map_configuration);
END;
$$;

DROP FUNCTION IF EXISTS public.play_again(UUID, UUID, TEXT, JSONB);
CREATE OR REPLACE FUNCTION public.play_again(
  p_room_id UUID,
  p_host_player_id UUID,
  p_seed TEXT,
  p_map_configuration JSONB,
  p_session_token TEXT DEFAULT NULL
)
RETURNS public.matches
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_room public.rooms;
  v_match public.matches;
BEGIN
  PERFORM public.assert_player_session(p_host_player_id, p_session_token);

  SELECT * INTO v_room FROM public.rooms WHERE id = p_room_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Room tidak ditemukan';
  END IF;

  IF v_room.expires_at < now() THEN
    RAISE EXCEPTION 'Room sudah kedaluwarsa';
  END IF;

  IF v_room.host_player_id <> p_host_player_id THEN
    RAISE EXCEPTION 'Hanya host room yang dapat memulai ulang pertandingan';
  END IF;

  IF v_room.status = 'PLAYING' THEN
    SELECT * INTO v_match
    FROM public.matches
    WHERE room_id = p_room_id AND status = 'PLAYING'
    ORDER BY started_at DESC
    LIMIT 1;
    IF FOUND THEN
      RETURN v_match;
    END IF;
    RAISE EXCEPTION 'Pertandingan sudah berjalan tanpa data aktif';
  END IF;

  IF v_room.status <> 'FINISHED' THEN
    RAISE EXCEPTION 'Main Lagi hanya dapat digunakan setelah pertandingan selesai';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.matches WHERE room_id = p_room_id AND status = 'PLAYING'
  ) THEN
    RAISE EXCEPTION 'Masih ada pertandingan yang berstatus PLAYING di room ini';
  END IF;

  RETURN public._create_match_for_room(v_room, p_host_player_id, p_seed, p_map_configuration);
END;
$$;

-- 9. Authorized question retrieval (does not burn unanswered questions; server enforces match level)
DROP FUNCTION IF EXISTS public.get_challenge_questions(UUID, UUID, TEXT, TEXT, INT);
CREATE OR REPLACE FUNCTION public.get_challenge_questions(
  p_match_id UUID,
  p_player_id UUID,
  p_education_level TEXT,
  p_tier TEXT,
  p_count INT DEFAULT 1,
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
  v_level TEXT;
  v_tier TEXT := lower(trim(COALESCE(p_tier, 'small')));
  v_limit INT := GREATEST(1, LEAST(5, COALESCE(p_count, 1)));
  v_result JSONB := '[]'::jsonb;
  v_q RECORD;
  v_picked_ids UUID[] := ARRAY[]::UUID[];
BEGIN
  PERFORM public.assert_player_session(p_player_id, p_session_token);

  SELECT * INTO v_match FROM public.matches WHERE id = p_match_id;
  IF NOT FOUND OR v_match.status <> 'PLAYING' THEN
    RAISE EXCEPTION 'Pertandingan tidak aktif atau tidak ditemukan';
  END IF;

  SELECT * INTO v_mp
  FROM public.match_players
  WHERE match_id = p_match_id AND player_id = p_player_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Pemain tidak terdaftar dalam pertandingan ini';
  END IF;

  IF v_mp.is_dead THEN
    RAISE EXCEPTION 'Pemain sedang tumbang. Tunggu respawn sebelum membuka tantangan.';
  END IF;

  IF v_tier NOT IN ('small', 'large', 'bonus') THEN
    RAISE EXCEPTION 'Tier pertanyaan tidak valid';
  END IF;

  -- Authoritatively use the match's locked difficulty rather than trusting client input
  v_level := upper(trim(v_match.difficulty));

  -- 1st pass: unanswered questions matching match level & requested tier
  FOR v_q IN
    SELECT q.*
    FROM public.questions q
    WHERE q.education_level = v_level
      AND q.question_tier = v_tier
      AND NOT EXISTS (
        SELECT 1 FROM public.match_player_questions mpq
        WHERE mpq.match_id = p_match_id
          AND mpq.player_id = p_player_id
          AND mpq.question_id = q.id
          AND mpq.answered_at IS NOT NULL
      )
    ORDER BY random()
    LIMIT v_limit
  LOOP
    v_picked_ids := array_append(v_picked_ids, v_q.id);
    v_result := v_result || jsonb_build_object(
      'id', v_q.id,
      'education_level', v_q.education_level,
      'question_tier', v_q.question_tier,
      'subject', v_q.subject,
      'topic', v_q.topic,
      'difficulty', v_q.difficulty,
      'question_text', v_q.question_text,
      'options', v_q.options
    );
  END LOOP;

  -- 2nd pass: if tier exhausted, draw unanswered from same match education level
  IF jsonb_array_length(v_result) < v_limit THEN
    FOR v_q IN
      SELECT q.*
      FROM public.questions q
      WHERE q.education_level = v_level
        AND NOT (q.id = ANY(v_picked_ids))
        AND NOT EXISTS (
          SELECT 1 FROM public.match_player_questions mpq
          WHERE mpq.match_id = p_match_id
            AND mpq.player_id = p_player_id
            AND mpq.question_id = q.id
            AND mpq.answered_at IS NOT NULL
        )
      ORDER BY random()
      LIMIT (v_limit - jsonb_array_length(v_result))
    LOOP
      v_picked_ids := array_append(v_picked_ids, v_q.id);
      v_result := v_result || jsonb_build_object(
        'id', v_q.id,
        'education_level', v_q.education_level,
        'question_tier', v_q.question_tier,
        'subject', v_q.subject,
        'topic', v_q.topic,
        'difficulty', v_q.difficulty,
        'question_text', v_q.question_text,
        'options', v_q.options
      );
    END LOOP;
  END IF;

  -- 3rd pass fallback: allow repeats from same level only if all questions in level are answered
  IF jsonb_array_length(v_result) < v_limit THEN
    FOR v_q IN
      SELECT q.*
      FROM public.questions q
      WHERE q.education_level = v_level
        AND NOT (q.id = ANY(v_picked_ids))
      ORDER BY random()
      LIMIT (v_limit - jsonb_array_length(v_result))
    LOOP
      v_picked_ids := array_append(v_picked_ids, v_q.id);
      v_result := v_result || jsonb_build_object(
        'id', v_q.id,
        'education_level', v_q.education_level,
        'question_tier', v_q.question_tier,
        'subject', v_q.subject,
        'topic', v_q.topic,
        'difficulty', v_q.difficulty,
        'question_text', v_q.question_text,
        'options', v_q.options
      );
    END LOOP;
  END IF;

  RETURN v_result;
END;
$$;

-- 10. Hardened submit_challenge_answer:
--     - Session-authorized, serialized via match_players FOR UPDATE
--     - Validates challenge_kind & p_item_key against match.map_configuration
--     - Strict one-time evaluation per (match_id, player_id, question_id):
--       duplicate submissions (right or wrong) never alter progress, score, coins, HP, or completions
--     - Namespaced challenge_progress keys: p_challenge_kind || ':' || p_item_key
DROP FUNCTION IF EXISTS public.submit_challenge_answer(UUID, UUID, UUID, INT, TEXT, TEXT, INT, INT);
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

  -- Serialize all answers/progress mutations for this player in this match
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

  v_small_chests := COALESCE(v_mp.completed_small_chests, '[]'::jsonb);
  v_fragments := COALESCE(v_mp.collected_fragments, '[]'::jsonb);
  v_challenges := COALESCE(v_mp.completed_challenges, '[]'::jsonb);
  v_gates := COALESCE(v_mp.unlocked_gates, '[]'::jsonb);
  v_progress_map := COALESCE(v_mp.challenge_progress, '{}'::jsonb);
  v_large_completed := v_mp.large_treasure_completed;

  -- Validate item exists in match.map_configuration for the given challenge kind
  IF v_clean_kind = 'small_chest' THEN
    SELECT elem INTO v_chest
    FROM jsonb_array_elements(COALESCE(v_match.map_configuration->'smallChests', '[]'::jsonb)) elem
    WHERE elem->>'id' = v_clean_item_key
    LIMIT 1;
    IF v_chest IS NULL THEN
      RAISE EXCEPTION 'Small chest tidak terdaftar pada peta pertandingan ini';
    END IF;
    v_required_count := GREATEST(1, COALESCE((v_chest->>'questionCount')::int, 2));
    v_item_already_done := (v_small_chests ? v_clean_item_key);

  ELSIF v_clean_kind = 'large_treasure' THEN
    IF COALESCE(v_match.map_configuration->'largeTreasure'->>'id', '') <> v_clean_item_key THEN
      RAISE EXCEPTION 'Large treasure tidak terdaftar pada peta pertandingan ini';
    END IF;
    IF NOT v_mp.large_treasure_unlocked THEN
      RAISE EXCEPTION 'Large Treasure masih terkunci. Kumpulkan fragmen kode dari Small Chest terlebih dahulu.';
    END IF;
    v_required_count := GREATEST(1, COALESCE((v_match.map_configuration->'largeTreasure'->>'questionCount')::int, 3));
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
    -- bonus_shrine, riddle_statue, secret_cache
    SELECT elem INTO v_bonus_item
    FROM jsonb_array_elements(COALESCE(v_match.map_configuration->'bonusChallenges', '[]'::jsonb)) elem
    WHERE elem->>'id' = v_clean_item_key
      AND elem->>'kind' = v_clean_kind
    LIMIT 1;
    IF v_bonus_item IS NULL THEN
      RAISE EXCEPTION 'Tantangan bonus tidak terdaftar pada peta pertandingan ini';
    END IF;
    IF (v_clean_kind = 'secret_cache' OR COALESCE((v_bonus_item->>'requiresKey')::boolean, false))
       AND NOT v_mp.has_secret_key THEN
      RAISE EXCEPTION 'Peti Rahasia ini membutuhkan Kunci Emas Hutan Utara.';
    END IF;
    v_required_count := 1;
    v_item_already_done := (v_challenges ? v_clean_item_key);
  END IF;

  v_progress_key := v_clean_kind || ':' || v_clean_item_key;
  v_prev_progress := CASE
    WHEN v_item_already_done THEN v_required_count
    ELSE GREATEST(0, COALESCE((v_progress_map ->> v_progress_key)::int, 0))
  END;

  -- Check if this (match_id, player_id, question_id) was already answered
  SELECT * INTO v_mpq
  FROM public.match_player_questions
  WHERE match_id = p_match_id AND player_id = p_player_id AND question_id = p_question_id
  FOR UPDATE;

  IF FOUND AND v_mpq.answered_at IS NOT NULL THEN
    -- Strict idempotent no-op: no progress, score, coins, HP, stats, or rewards may change
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

-- 11. Authorize remaining player-scoped progression & combat RPCs
DROP FUNCTION IF EXISTS public.unlock_large_treasure(UUID, UUID, JSONB);
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

  v_small_chests := COALESCE(v_match.map_configuration->'smallChests', '[]'::jsonb);
  v_total_chests := jsonb_array_length(v_small_chests);
  v_completed_count := jsonb_array_length(COALESCE(v_mp.completed_small_chests, '[]'::jsonb));

  IF v_completed_count < v_total_chests THEN
    RETURN jsonb_build_object(
      'unlocked', false,
      'points_awarded', 0,
      'new_score', v_mp.score,
      'message', format('Selesaikan semua %s Small Chest terlebih dahulu (%s/%s selesai).', v_total_chests, v_completed_count, v_total_chests)
    );
  END IF;

  IF jsonb_array_length(COALESCE(p_submitted_codes, '[]'::jsonb)) < v_total_chests THEN
    RETURN jsonb_build_object(
      'unlocked', false,
      'points_awarded', 0,
      'new_score', v_mp.score,
      'message', 'Masukkan seluruh kode fragmen dari semua Small Chest.'
    );
  END IF;

  FOR v_chest IN SELECT * FROM jsonb_array_elements(v_small_chests) LOOP
    v_expected := upper(trim(v_chest->>'fragmentCode'));
    v_submitted := upper(trim(COALESCE(p_submitted_codes->>v_idx, '')));
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

DROP FUNCTION IF EXISTS public.activate_switch_or_key(UUID, UUID, TEXT, TEXT);
CREATE OR REPLACE FUNCTION public.activate_switch_or_key(
  p_match_id UUID,
  p_player_id UUID,
  p_kind TEXT,
  p_item_key TEXT,
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
  v_switches JSONB;
BEGIN
  PERFORM public.assert_player_session(p_player_id, p_session_token);

  SELECT * INTO v_match FROM public.matches WHERE id = p_match_id;
  IF NOT FOUND OR v_match.status <> 'PLAYING' THEN
    RETURN jsonb_build_object('applied', false);
  END IF;

  SELECT * INTO v_mp FROM public.match_players WHERE match_id = p_match_id AND player_id = p_player_id FOR UPDATE;
  IF NOT FOUND OR v_mp.is_dead THEN
    RETURN jsonb_build_object('applied', false);
  END IF;

  IF p_kind = 'secret_key' THEN
    IF COALESCE(v_match.map_configuration->'secretKey'->>'id', '') <> COALESCE(p_item_key, '') THEN
      RAISE EXCEPTION 'Kunci tidak terdaftar pada peta pertandingan';
    END IF;
    UPDATE public.match_players
    SET has_secret_key = true
    WHERE id = v_mp.id;
    RETURN jsonb_build_object('applied', true, 'has_secret_key', true);
  ELSIF p_kind = 'switch' THEN
    IF NOT EXISTS (
      SELECT 1 FROM jsonb_array_elements(COALESCE(v_match.map_configuration->'switches', '[]'::jsonb)) sw
      WHERE sw->>'id' = p_item_key
    ) THEN
      RAISE EXCEPTION 'Tuas tidak terdaftar pada peta pertandingan';
    END IF;

    v_switches := COALESCE(v_mp.activated_switches, '[]'::jsonb);
    IF NOT (v_switches ? p_item_key) THEN
      v_switches := v_switches || to_jsonb(p_item_key);
      UPDATE public.match_players
      SET activated_switches = v_switches
      WHERE id = v_mp.id;
    END IF;
    RETURN jsonb_build_object('applied', true, 'activated_switches', v_switches);
  END IF;

  RETURN jsonb_build_object('applied', false);
END;
$$;

DROP FUNCTION IF EXISTS public.claim_secret_treasure(UUID, UUID, JSONB);
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
  v_tx DOUBLE PRECISION;
  v_ty DOUBLE PRECISION;
  v_dist DOUBLE PRECISION;
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

  v_tx := ((v_match.map_configuration->'secretTreasure'->>'tileX')::double precision + 0.5) * (v_match.map_configuration->>'tileSize')::double precision;
  v_ty := ((v_match.map_configuration->'secretTreasure'->>'tileY')::double precision + 0.5) * (v_match.map_configuration->>'tileSize')::double precision;

  v_dist := sqrt(
    power((p_player_pos->>'x')::double precision - v_tx, 2) +
    power((p_player_pos->>'y')::double precision - v_ty, 2)
  );

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
      final_position = p_player_pos
  WHERE id = v_mp.id;

  INSERT INTO public.match_events (match_id, player_id, event_type, event_data)
  VALUES (p_match_id, p_player_id, 'SECRET_TREASURE_CLAIMED', p_player_pos);

  RETURN jsonb_build_object('claimed', true, 'winner_player_id', p_player_id, 'finished_at', v_match.finished_at);
END;
$$;

DROP FUNCTION IF EXISTS public.record_attack_hit(UUID, UUID, UUID, JSONB, JSONB);
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
  v_attacker public.match_players;
  v_target public.match_players;
  v_match public.matches;
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

  SELECT * INTO v_attacker FROM public.match_players WHERE match_id = p_match_id AND player_id = p_attacker_id FOR UPDATE;
  SELECT * INTO v_target FROM public.match_players WHERE match_id = p_match_id AND player_id = p_target_id FOR UPDATE;

  IF NOT FOUND OR v_attacker.id IS NULL OR v_target.id IS NULL THEN
    RETURN jsonb_build_object('applied', false, 'reason', 'player_not_in_match');
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

  v_dist := sqrt(
    power((p_attacker_pos->>'x')::double precision - (p_target_pos->>'x')::double precision, 2) +
    power((p_attacker_pos->>'y')::double precision - (p_target_pos->>'y')::double precision, 2)
  );
  IF v_dist > 420 THEN
    RETURN jsonb_build_object('applied', false, 'reason', 'out_of_range');
  END IF;

  v_new_hp := GREATEST(0, v_target.health - 20);
  IF v_new_hp <= 0 THEN
    v_is_dead := true;
    v_respawn := now() + interval '5 seconds';
  END IF;

  UPDATE public.match_players
  SET last_attack_at = now(), total_attacks = total_attacks + 1
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

DROP FUNCTION IF EXISTS public.complete_respawn(UUID, UUID);
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
  v_mp public.match_players;
  v_invuln TIMESTAMPTZ := now() + interval '2 seconds';
BEGIN
  PERFORM public.assert_player_session(p_player_id, p_session_token);

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
  SET health = 100, is_dead = false, respawn_at = NULL, invulnerable_until = v_invuln
  WHERE id = v_mp.id;

  RETURN jsonb_build_object('respawned', true, 'health', 100, 'invulnerable_until', v_invuln);
END;
$$;

DROP FUNCTION IF EXISTS public.collect_apple(UUID, UUID, TEXT);
CREATE OR REPLACE FUNCTION public.collect_apple(
  p_match_id UUID,
  p_player_id UUID,
  p_item_key TEXT,
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
  v_claimed public.match_world_items;
BEGIN
  PERFORM public.assert_player_session(p_player_id, p_session_token);

  SELECT * INTO v_match FROM public.matches WHERE id = p_match_id;
  IF NOT FOUND OR v_match.status <> 'PLAYING' THEN
    RETURN jsonb_build_object('collected', false, 'reason', 'match_not_active');
  END IF;

  SELECT * INTO v_mp FROM public.match_players WHERE match_id = p_match_id AND player_id = p_player_id FOR UPDATE;
  IF NOT FOUND OR v_mp.is_dead THEN
    RETURN jsonb_build_object('collected', false, 'reason', 'invalid_player_state');
  END IF;

  IF v_mp.apples >= 3 THEN
    RETURN jsonb_build_object('collected', false, 'reason', 'inventory_full', 'apples', v_mp.apples);
  END IF;

  UPDATE public.match_world_items
  SET claimed_by = p_player_id, claimed_at = now()
  WHERE match_id = p_match_id AND item_key = p_item_key AND item_type = 'apple' AND claimed_by IS NULL
  RETURNING * INTO v_claimed;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('collected', false, 'reason', 'already_claimed');
  END IF;

  UPDATE public.match_players
  SET apples = apples + 1
  WHERE id = v_mp.id;

  RETURN jsonb_build_object('collected', true, 'apples', v_mp.apples + 1);
END;
$$;

DROP FUNCTION IF EXISTS public.use_apple(UUID, UUID);
CREATE OR REPLACE FUNCTION public.use_apple(
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
  v_new_hp INT;
BEGIN
  PERFORM public.assert_player_session(p_player_id, p_session_token);

  SELECT * INTO v_match FROM public.matches WHERE id = p_match_id;
  IF NOT FOUND OR v_match.status <> 'PLAYING' THEN
    RETURN jsonb_build_object('used', false, 'reason', 'match_not_active');
  END IF;

  SELECT * INTO v_mp FROM public.match_players WHERE match_id = p_match_id AND player_id = p_player_id FOR UPDATE;
  IF NOT FOUND OR v_mp.is_dead THEN
    RETURN jsonb_build_object('used', false, 'reason', 'player_dead');
  END IF;

  IF v_mp.apples <= 0 THEN
    RETURN jsonb_build_object('used', false, 'reason', 'no_apples');
  END IF;

  IF v_mp.health >= 100 THEN
    RETURN jsonb_build_object('used', false, 'reason', 'full_health');
  END IF;

  v_new_hp := LEAST(100, v_mp.health + 25);

  UPDATE public.match_players
  SET apples = apples - 1, health = v_new_hp
  WHERE id = v_mp.id;

  RETURN jsonb_build_object('used', true, 'health', v_new_hp, 'apples', v_mp.apples - 1);
END;
$$;

DROP FUNCTION IF EXISTS public.apply_trap_damage(UUID, UUID);
CREATE OR REPLACE FUNCTION public.apply_trap_damage(
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
  v_new_hp INT;
  v_is_dead BOOLEAN := false;
  v_respawn TIMESTAMPTZ := NULL;
BEGIN
  PERFORM public.assert_player_session(p_player_id, p_session_token);

  SELECT * INTO v_match FROM public.matches WHERE id = p_match_id;
  IF NOT FOUND OR v_match.status <> 'PLAYING' THEN
    RETURN jsonb_build_object('applied', false);
  END IF;

  SELECT * INTO v_mp FROM public.match_players WHERE match_id = p_match_id AND player_id = p_player_id FOR UPDATE;
  IF NOT FOUND OR v_mp.is_dead THEN
    RETURN jsonb_build_object('applied', false);
  END IF;

  IF v_mp.invulnerable_until IS NOT NULL AND v_mp.invulnerable_until > now() THEN
    RETURN jsonb_build_object('applied', false);
  END IF;

  v_new_hp := GREATEST(0, v_mp.health - 15);
  IF v_new_hp <= 0 THEN
    v_is_dead := true;
    v_respawn := now() + interval '5 seconds';
  END IF;

  UPDATE public.match_players
  SET health = v_new_hp, is_dead = v_is_dead, respawn_at = v_respawn
  WHERE id = v_mp.id;

  RETURN jsonb_build_object('applied', true, 'new_hp', v_new_hp, 'is_dead', v_is_dead, 'respawn_at', v_respawn);
END;
$$;

-- 12. Revoke direct public execution on legacy/internal functions
REVOKE ALL ON FUNCTION public.cleanup_expired_rooms() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.create_player_profile(TEXT, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.open_normal_chest(UUID, UUID, TEXT, INT, BOOLEAN) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_next_question(UUID, UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.submit_quiz_answer(UUID, UUID, UUID, INT, TEXT, TEXT) FROM PUBLIC, anon, authenticated;

-- 13. Grant execution for all authenticated-session RPCs
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
