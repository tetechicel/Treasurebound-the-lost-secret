-- TREASUREBOUND: The Lost Secret — V2 Upgrade Migration
-- Adds: Education Level Selection (SD/SMP/SMA), 10-Player Rooms,
-- 4-Stage Progressive Treasure System, Server-Side Score & Anti-Duplicate Validation

-- 1. Upgrade ROOMS table (max 10 players + education difficulty)
ALTER TABLE public.rooms DROP CONSTRAINT IF EXISTS rooms_max_players_check;
ALTER TABLE public.rooms
  ALTER COLUMN max_players SET DEFAULT 10,
  ADD CONSTRAINT rooms_max_players_check CHECK (max_players BETWEEN 2 AND 10);

ALTER TABLE public.rooms
  ADD COLUMN IF NOT EXISTS difficulty TEXT NOT NULL DEFAULT 'SMA'
  CHECK (difficulty IN ('SD', 'SMP', 'SMA'));

-- 2. Upgrade MATCHES table (difficulty locked at match start)
ALTER TABLE public.matches
  ADD COLUMN IF NOT EXISTS difficulty TEXT NOT NULL DEFAULT 'SMA'
  CHECK (difficulty IN ('SD', 'SMP', 'SMA'));

-- 3. Upgrade MATCH_PLAYERS table (score + per-player 4-stage progression)
ALTER TABLE public.match_players
  ADD COLUMN IF NOT EXISTS score INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS completed_small_chests JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS collected_fragments JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS completed_challenges JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS unlocked_gates JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS activated_switches JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS has_secret_key BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS large_treasure_unlocked BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS large_treasure_completed BOOLEAN NOT NULL DEFAULT false;

-- 4. Upgrade QUESTIONS table (education_level & question_tier)
ALTER TABLE public.questions
  ADD COLUMN IF NOT EXISTS education_level TEXT NOT NULL DEFAULT 'SMA'
  CHECK (education_level IN ('SD', 'SMP', 'SMA'));

ALTER TABLE public.questions
  ADD COLUMN IF NOT EXISTS question_tier TEXT NOT NULL DEFAULT 'small'
  CHECK (question_tier IN ('small', 'large', 'bonus'));

CREATE INDEX IF NOT EXISTS idx_questions_level_tier
  ON public.questions (education_level, question_tier);

-- 5. Update ROOM CREATION & CONFIGURATION RPCs
DROP FUNCTION IF EXISTS public.create_room(UUID);

CREATE OR REPLACE FUNCTION public.create_room(
  p_player_id UUID,
  p_difficulty TEXT DEFAULT 'SMA'
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

CREATE OR REPLACE FUNCTION public.set_room_difficulty(
  p_room_id UUID,
  p_host_player_id UUID,
  p_difficulty TEXT
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

CREATE OR REPLACE FUNCTION public.join_room(
  p_room_code TEXT,
  p_player_id UUID
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

-- 6. Update START_MATCH RPC for 10 players & difficulty lock
CREATE OR REPLACE FUNCTION public.start_match(
  p_room_id UUID,
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
  v_room public.rooms;
  v_player_count INT;
  v_match public.matches;
  v_item JSONB;
BEGIN
  SELECT * INTO v_room FROM public.rooms WHERE id = p_room_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Room not found';
  END IF;

  IF v_room.host_player_id <> p_host_player_id THEN
    RAISE EXCEPTION 'Only the room host can start the match';
  END IF;

  SELECT count(*) INTO v_player_count FROM public.room_players WHERE room_id = p_room_id;
  IF v_player_count < 2 THEN
    RAISE EXCEPTION 'Minimal 2 pemain diperlukan untuk memulai pertandingan';
  END IF;

  UPDATE public.rooms
  SET status = 'PLAYING', expires_at = now() + interval '4 hours'
  WHERE id = p_room_id;

  INSERT INTO public.matches (room_id, seed, difficulty, status, map_configuration)
  VALUES (p_room_id, p_seed, v_room.difficulty, 'PLAYING', p_map_configuration)
  RETURNING * INTO v_match;

  INSERT INTO public.match_players (
    match_id, player_id, health, apples, coins, score,
    completed_small_chests, collected_fragments, completed_challenges,
    unlocked_gates, activated_switches, has_secret_key,
    large_treasure_unlocked, large_treasure_completed
  )
  SELECT
    v_match.id, rp.player_id, 100, 0, 0, 0,
    '[]'::jsonb, '[]'::jsonb, '[]'::jsonb,
    '[]'::jsonb, '[]'::jsonb, false,
    false, false
  FROM public.room_players rp
  WHERE rp.room_id = p_room_id;

  -- Register shared world apples for atomic pickup validation
  FOR v_item IN SELECT * FROM jsonb_array_elements(COALESCE(p_map_configuration->'apples', '[]'::jsonb)) LOOP
    INSERT INTO public.match_world_items (match_id, item_key, item_type)
    VALUES (v_match.id, v_item->>'id', 'apple')
    ON CONFLICT DO NOTHING;
  END LOOP;

  INSERT INTO public.match_events (match_id, player_id, event_type, event_data)
  VALUES (v_match.id, p_host_player_id, 'MATCH_STARTED', jsonb_build_object('seed', p_seed, 'difficulty', v_room.difficulty));

  RETURN v_match;
END;
$$;

-- 7. Fetch randomized non-duplicate challenge questions filtered by education_level & question_tier
CREATE OR REPLACE FUNCTION public.get_challenge_questions(
  p_match_id UUID,
  p_player_id UUID,
  p_education_level TEXT,
  p_tier TEXT,
  p_count INT DEFAULT 1
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_level TEXT := upper(trim(COALESCE(p_education_level, 'SMA')));
  v_tier TEXT := lower(trim(COALESCE(p_tier, 'small')));
  v_limit INT := GREATEST(1, LEAST(5, COALESCE(p_count, 1)));
  v_result JSONB := '[]'::jsonb;
  v_q RECORD;
  v_picked_ids UUID[] := ARRAY[]::UUID[];
BEGIN
  -- 1st pass: unused questions matching level & tier
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
      )
    ORDER BY random()
    LIMIT v_limit
  LOOP
    v_picked_ids := array_append(v_picked_ids, v_q.id);
    INSERT INTO public.match_player_questions (match_id, player_id, question_id)
    VALUES (p_match_id, p_player_id, v_q.id)
    ON CONFLICT DO NOTHING;

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

  -- 2nd pass: if tier exhausted, draw unused from same education level
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
        )
      ORDER BY random()
      LIMIT (v_limit - jsonb_array_length(v_result))
    LOOP
      v_picked_ids := array_append(v_picked_ids, v_q.id);
      INSERT INTO public.match_player_questions (match_id, player_id, question_id)
      VALUES (p_match_id, p_player_id, v_q.id)
      ON CONFLICT DO NOTHING;

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

  -- 3rd pass fallback: allow repeats from same level if player answered all 100+ questions
  IF jsonb_array_length(v_result) < v_limit THEN
    FOR v_q IN
      SELECT q.*
      FROM public.questions q
      WHERE q.education_level = v_level
        AND NOT (q.id = ANY(v_picked_ids))
      ORDER BY random()
      LIMIT (v_limit - jsonb_array_length(v_result))
    LOOP
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

-- 8. Server-validated Challenge Answer & Progression RPC
CREATE OR REPLACE FUNCTION public.submit_challenge_answer(
  p_match_id UUID,
  p_player_id UUID,
  p_question_id UUID,
  p_selected_index INT,
  p_item_key TEXT,
  p_challenge_kind TEXT,
  p_series_correct_count INT DEFAULT 1,
  p_series_total INT DEFAULT 1
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
  v_already_answered BOOLEAN := false;
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
  v_small_chests JSONB;
  v_fragments JSONB;
  v_challenges JSONB;
  v_gates JSONB;
  v_large_completed BOOLEAN;
  v_required_small INT;
BEGIN
  SELECT * INTO v_match FROM public.matches WHERE id = p_match_id;
  IF NOT FOUND OR v_match.status <> 'PLAYING' THEN
    RAISE EXCEPTION 'Pertandingan sudah berakhir atau tidak aktif';
  END IF;

  SELECT * INTO v_q FROM public.questions WHERE id = p_question_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Pertanyaan tidak ditemukan';
  END IF;

  SELECT * INTO v_mp FROM public.match_players WHERE match_id = p_match_id AND player_id = p_player_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Pemain tidak terdaftar dalam pertandingan';
  END IF;

  IF p_challenge_kind = 'large_treasure' AND NOT v_mp.large_treasure_unlocked THEN
    RAISE EXCEPTION 'Large Treasure masih terkunci. Kumpulkan fragmen kode dari Small Chest terlebih dahulu.';
  END IF;

  SELECT * INTO v_mpq FROM public.match_player_questions
  WHERE match_id = p_match_id AND player_id = p_player_id AND question_id = p_question_id
  FOR UPDATE;

  IF FOUND AND v_mpq.answered_at IS NOT NULL THEN
    v_already_answered := true;
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
  v_small_chests := COALESCE(v_mp.completed_small_chests, '[]'::jsonb);
  v_fragments := COALESCE(v_mp.collected_fragments, '[]'::jsonb);
  v_challenges := COALESCE(v_mp.completed_challenges, '[]'::jsonb);
  v_gates := COALESCE(v_mp.unlocked_gates, '[]'::jsonb);
  v_large_completed := v_mp.large_treasure_completed;

  IF v_is_correct THEN
    IF NOT v_already_answered THEN
      IF p_challenge_kind = 'small_chest' THEN
        v_points_delta := 10;
      ELSIF p_challenge_kind = 'large_treasure' THEN
        v_points_delta := 20;
      ELSE
        v_points_delta := 15;
      END IF;
    END IF;

    -- Check series / challenge completion
    IF p_challenge_kind = 'small_chest' THEN
      SELECT elem INTO v_chest
      FROM jsonb_array_elements(COALESCE(v_match.map_configuration->'smallChests', '[]'::jsonb)) elem
      WHERE elem->>'id' = p_item_key
      LIMIT 1;

      v_required_small := COALESCE((v_chest->>'questionCount')::int, p_series_total, 2);

      IF p_series_correct_count >= v_required_small AND NOT (v_small_chests ? p_item_key) THEN
        v_challenge_completed := true;
        v_bonus_delta := 25;
        v_small_chests := v_small_chests || to_jsonb(p_item_key);
        v_fragment := jsonb_build_object(
          'chestId', p_item_key,
          'chestName', COALESCE(v_chest->>'name', p_item_key),
          'code', COALESCE(v_chest->>'fragmentCode', 'RUNE'),
          'earnedAt', now()
        );
        v_fragments := v_fragments || jsonb_build_array(v_fragment);
      END IF;
    ELSIF p_challenge_kind = 'large_treasure' THEN
      IF p_series_correct_count >= COALESCE(p_series_total, 3) AND NOT v_large_completed THEN
        v_challenge_completed := true;
        v_large_completed := true;
      END IF;
    ELSIF p_challenge_kind = 'locked_gate' THEN
      IF NOT (v_gates ? p_item_key) THEN
        v_challenge_completed := true;
        v_gates := v_gates || to_jsonb(p_item_key);
        v_challenges := v_challenges || to_jsonb(p_item_key);
        v_unlocked_gate := p_item_key;
      ELSE
        v_points_delta := 0; -- Prevent duplicate gate points
      END IF;
    ELSE
      -- bonus_shrine, riddle_statue, secret_cache
      IF NOT (v_challenges ? p_item_key) THEN
        v_challenge_completed := true;
        v_challenges := v_challenges || to_jsonb(p_item_key);
      ELSE
        v_points_delta := 0; -- Prevent duplicate challenge points
      END IF;
    END IF;

    v_new_score := v_mp.score + v_points_delta + v_bonus_delta;
    v_new_coins := v_mp.coins + v_points_delta + v_bonus_delta;

    UPDATE public.match_players
    SET score = v_new_score,
        coins = v_new_coins,
        correct_answers = correct_answers + CASE WHEN v_already_answered THEN 0 ELSE 1 END,
        opened_chests = opened_chests + CASE WHEN p_challenge_kind = 'small_chest' AND v_challenge_completed THEN 1 ELSE 0 END,
        clues_found = clues_found + CASE WHEN v_challenge_completed THEN 1 ELSE 0 END,
        completed_small_chests = v_small_chests,
        collected_fragments = v_fragments,
        completed_challenges = v_challenges,
        unlocked_gates = v_gates,
        large_treasure_completed = v_large_completed
    WHERE id = v_mp.id;
  ELSE
    -- Incorrect answer: 0 points, small HP drain (never kills player mid-quiz)
    v_hp_delta := -5;
    v_new_hp := GREATEST(10, v_mp.health - 5);

    UPDATE public.match_players
    SET health = v_new_hp,
        incorrect_answers = incorrect_answers + 1
    WHERE id = v_mp.id;
  END IF;

  INSERT INTO public.match_events (match_id, player_id, event_type, event_data)
  VALUES (p_match_id, p_player_id, 'CHALLENGE_ANSWERED', jsonb_build_object(
    'challenge_kind', p_challenge_kind,
    'item_key', p_item_key,
    'is_correct', v_is_correct,
    'points', v_points_delta + v_bonus_delta
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
    'unlocked_gate_id', v_unlocked_gate
  );
END;
$$;

-- 9. Stage 2: Unlock Large Treasure with collected fragment codes
CREATE OR REPLACE FUNCTION public.unlock_large_treasure(
  p_match_id UUID,
  p_player_id UUID,
  p_submitted_codes JSONB
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
  SELECT * INTO v_match FROM public.matches WHERE id = p_match_id;
  IF NOT FOUND OR v_match.status <> 'PLAYING' THEN
    RAISE EXCEPTION 'Pertandingan tidak aktif';
  END IF;

  SELECT * INTO v_mp FROM public.match_players WHERE match_id = p_match_id AND player_id = p_player_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Pemain tidak ditemukan';
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

-- 10. Environmental Switches & Secret Forest Key RPC
CREATE OR REPLACE FUNCTION public.activate_switch_or_key(
  p_match_id UUID,
  p_player_id UUID,
  p_kind TEXT,
  p_item_key TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_mp public.match_players;
  v_switches JSONB;
BEGIN
  SELECT * INTO v_mp FROM public.match_players WHERE match_id = p_match_id AND player_id = p_player_id FOR UPDATE;
  IF NOT FOUND OR v_mp.is_dead THEN
    RETURN jsonb_build_object('applied', false);
  END IF;

  IF p_kind = 'secret_key' THEN
    UPDATE public.match_players
    SET has_secret_key = true
    WHERE id = v_mp.id;
    RETURN jsonb_build_object('applied', true, 'has_secret_key', true);
  ELSIF p_kind = 'switch' THEN
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

-- 11. Stage 4: Claim Secret Treasure (Requires large_treasure_completed = true!)
CREATE OR REPLACE FUNCTION public.claim_secret_treasure(
  p_match_id UUID,
  p_player_id UUID,
  p_player_pos JSONB
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

-- Grant execution for new/updated RPCs
GRANT EXECUTE ON FUNCTION public.create_room(UUID, TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_room_difficulty(UUID, UUID, TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.join_room(TEXT, UUID) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.start_match(UUID, UUID, TEXT, JSONB) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_challenge_questions(UUID, UUID, TEXT, TEXT, INT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.submit_challenge_answer(UUID, UUID, UUID, INT, TEXT, TEXT, INT, INT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.unlock_large_treasure(UUID, UUID, JSONB) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.activate_switch_or_key(UUID, UUID, TEXT, TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_secret_treasure(UUID, UUID, JSONB) TO anon, authenticated;
