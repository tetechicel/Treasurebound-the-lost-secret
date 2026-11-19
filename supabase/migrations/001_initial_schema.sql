-- TREASUREBOUND: The Lost Secret
-- Initial PostgreSQL Schema, RLS Policies, Realtime Publication & Authoritative RPCs

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- 1. PLAYERS
CREATE TABLE IF NOT EXISTS public.players (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  username TEXT NOT NULL CHECK (char_length(trim(username)) BETWEEN 3 AND 16),
  character_id TEXT NOT NULL CHECK (character_id IN ('kai', 'lina', 'bima', 'sora')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 2. ROOMS
CREATE TABLE IF NOT EXISTS public.rooms (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  room_code TEXT NOT NULL UNIQUE CHECK (char_length(room_code) = 6),
  host_player_id UUID NOT NULL REFERENCES public.players(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'WAITING' CHECK (status IN ('WAITING', 'PLAYING', 'FINISHED')),
  max_players INT NOT NULL DEFAULT 4 CHECK (max_players BETWEEN 2 AND 4),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '4 hours')
);

CREATE INDEX IF NOT EXISTS idx_rooms_room_code ON public.rooms (room_code);
CREATE INDEX IF NOT EXISTS idx_rooms_expires_at ON public.rooms (expires_at);

-- 3. ROOM PLAYERS
CREATE TABLE IF NOT EXISTS public.room_players (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id UUID NOT NULL REFERENCES public.rooms(id) ON DELETE CASCADE,
  player_id UUID NOT NULL REFERENCES public.players(id) ON DELETE CASCADE,
  is_host BOOLEAN NOT NULL DEFAULT false,
  is_connected BOOLEAN NOT NULL DEFAULT true,
  joined_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (room_id, player_id)
);

CREATE INDEX IF NOT EXISTS idx_room_players_room_id ON public.room_players (room_id);

-- 4. MATCHES
CREATE TABLE IF NOT EXISTS public.matches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id UUID NOT NULL REFERENCES public.rooms(id) ON DELETE CASCADE,
  seed TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'PLAYING' CHECK (status IN ('STARTING', 'PLAYING', 'FINISHED')),
  winner_player_id UUID REFERENCES public.players(id),
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at TIMESTAMPTZ,
  map_configuration JSONB NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_matches_room_id ON public.matches (room_id);

-- 5. MATCH PLAYERS
CREATE TABLE IF NOT EXISTS public.match_players (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  match_id UUID NOT NULL REFERENCES public.matches(id) ON DELETE CASCADE,
  player_id UUID NOT NULL REFERENCES public.players(id) ON DELETE CASCADE,
  health INT NOT NULL DEFAULT 100 CHECK (health >= 0 AND health <= 100),
  apples INT NOT NULL DEFAULT 0 CHECK (apples >= 0 AND apples <= 3),
  coins INT NOT NULL DEFAULT 0 CHECK (coins >= 0),
  correct_answers INT NOT NULL DEFAULT 0,
  incorrect_answers INT NOT NULL DEFAULT 0,
  total_attacks INT NOT NULL DEFAULT 0,
  opened_chests INT NOT NULL DEFAULT 0,
  clues_found INT NOT NULL DEFAULT 0,
  is_dead BOOLEAN NOT NULL DEFAULT false,
  respawn_at TIMESTAMPTZ,
  invulnerable_until TIMESTAMPTZ,
  last_attack_at TIMESTAMPTZ,
  final_position JSONB,
  UNIQUE (match_id, player_id)
);

CREATE INDEX IF NOT EXISTS idx_match_players_match_id ON public.match_players (match_id);

-- 6. QUESTIONS (Answer keys protected from direct client SELECT)
CREATE TABLE IF NOT EXISTS public.questions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT NOT NULL UNIQUE,
  subject TEXT NOT NULL,
  topic TEXT NOT NULL,
  difficulty TEXT NOT NULL CHECK (difficulty IN ('easy', 'medium', 'hard')),
  question_text TEXT NOT NULL,
  options JSONB NOT NULL,
  correct_answer INT NOT NULL CHECK (correct_answer BETWEEN 0 AND 3),
  explanation TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 7. MATCH EVENTS
CREATE TABLE IF NOT EXISTS public.match_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  match_id UUID NOT NULL REFERENCES public.matches(id) ON DELETE CASCADE,
  player_id UUID REFERENCES public.players(id),
  event_type TEXT NOT NULL,
  event_data JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_match_events_match_id ON public.match_events (match_id);

-- 8. MATCH WORLD ITEMS (Atomic pickup / chest lock)
CREATE TABLE IF NOT EXISTS public.match_world_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  match_id UUID NOT NULL REFERENCES public.matches(id) ON DELETE CASCADE,
  item_key TEXT NOT NULL,
  item_type TEXT NOT NULL CHECK (item_type IN ('apple', 'normal_chest', 'ancient_chest', 'rune_shrine')),
  claimed_by UUID REFERENCES public.players(id),
  claimed_at TIMESTAMPTZ,
  UNIQUE (match_id, item_key)
);

CREATE INDEX IF NOT EXISTS idx_match_world_items_match_id ON public.match_world_items (match_id);

-- 9. MATCH PLAYER QUESTIONS (Prevents repeat questions for a player in one match)
CREATE TABLE IF NOT EXISTS public.match_player_questions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  match_id UUID NOT NULL REFERENCES public.matches(id) ON DELETE CASCADE,
  player_id UUID NOT NULL REFERENCES public.players(id) ON DELETE CASCADE,
  question_id UUID NOT NULL REFERENCES public.questions(id) ON DELETE CASCADE,
  is_correct BOOLEAN,
  answered_at TIMESTAMPTZ,
  UNIQUE (match_id, player_id, question_id)
);

-- ==========================================
-- ROW LEVEL SECURITY (RLS)
-- ==========================================
ALTER TABLE public.players ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rooms ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.room_players ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.matches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.match_players ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.questions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.match_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.match_world_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.match_player_questions ENABLE ROW LEVEL SECURITY;

-- Read-only SELECT policies for multiplayer state & Realtime subscriptions
CREATE POLICY "Allow read players" ON public.players FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "Allow read rooms" ON public.rooms FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "Allow read room_players" ON public.room_players FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "Allow read matches" ON public.matches FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "Allow read match_players" ON public.match_players FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "Allow read match_events" ON public.match_events FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "Allow read match_world_items" ON public.match_world_items FOR SELECT TO anon, authenticated USING (true);

-- Explicitly block direct client reads on questions & answer keys
REVOKE ALL ON TABLE public.questions FROM anon, authenticated;
CREATE POLICY "Deny direct questions read" ON public.questions FOR SELECT TO anon, authenticated USING (false);
CREATE POLICY "Deny direct player questions read" ON public.match_player_questions FOR SELECT TO anon, authenticated USING (false);

-- ==========================================
-- REALTIME PUBLICATION
-- ==========================================
DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.rooms;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.room_players;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.matches;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.match_players;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.match_world_items;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ==========================================
-- AUTHORITATIVE SERVER-SIDE RPC FUNCTIONS
-- ==========================================

CREATE OR REPLACE FUNCTION public.cleanup_expired_rooms()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  DELETE FROM public.rooms
  WHERE expires_at < now()
     OR (status = 'FINISHED' AND created_at < now() - interval '6 hours');
END;
$$;

CREATE OR REPLACE FUNCTION public.create_player_profile(
  p_username TEXT,
  p_character_id TEXT
)
RETURNS public.players
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_clean_name TEXT;
  v_player public.players;
BEGIN
  v_clean_name := trim(p_username);
  IF char_length(v_clean_name) < 3 OR char_length(v_clean_name) > 16 THEN
    RAISE EXCEPTION 'Username must be between 3 and 16 characters';
  END IF;
  IF p_character_id NOT IN ('kai', 'lina', 'bima', 'sora') THEN
    RAISE EXCEPTION 'Invalid character selected';
  END IF;

  INSERT INTO public.players (username, character_id)
  VALUES (v_clean_name, p_character_id)
  RETURNING * INTO v_player;

  RETURN v_player;
END;
$$;

CREATE OR REPLACE FUNCTION public.create_room(
  p_player_id UUID
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
BEGIN
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

  INSERT INTO public.rooms (room_code, host_player_id, status, max_players, expires_at)
  VALUES (v_code, p_player_id, 'WAITING', 4, now() + interval '4 hours')
  RETURNING * INTO v_room;

  INSERT INTO public.room_players (room_id, player_id, is_host, is_connected)
  VALUES (v_room.id, p_player_id, true, true);

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
    RAISE EXCEPTION 'Room code not found';
  END IF;

  IF v_room.expires_at < now() THEN
    RAISE EXCEPTION 'Room has expired';
  END IF;

  IF v_room.status <> 'WAITING' THEN
    RAISE EXCEPTION 'Match has already started or finished';
  END IF;

  SELECT * INTO v_player FROM public.players WHERE id = p_player_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Player profile not found';
  END IF;

  IF EXISTS (SELECT 1 FROM public.room_players WHERE room_id = v_room.id AND player_id = p_player_id) THEN
    UPDATE public.room_players SET is_connected = true WHERE room_id = v_room.id AND player_id = p_player_id;
    RETURN jsonb_build_object('room', to_jsonb(v_room));
  END IF;

  SELECT count(*) INTO v_count FROM public.room_players WHERE room_id = v_room.id;
  IF v_count >= v_room.max_players THEN
    RAISE EXCEPTION 'Room is full (max 4 players)';
  END IF;

  SELECT count(*) INTO v_dup_name
  FROM public.room_players rp
  JOIN public.players p ON p.id = rp.player_id
  WHERE rp.room_id = v_room.id AND lower(p.username) = lower(v_player.username);

  IF v_dup_name > 0 THEN
    RAISE EXCEPTION 'A player with this name is already in the room';
  END IF;

  INSERT INTO public.room_players (room_id, player_id, is_host, is_connected)
  VALUES (v_room.id, p_player_id, false, true);

  RETURN jsonb_build_object('room', to_jsonb(v_room));
END;
$$;

CREATE OR REPLACE FUNCTION public.leave_room(
  p_room_id UUID,
  p_player_id UUID
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
  SELECT * INTO v_room FROM public.rooms WHERE id = p_room_id FOR UPDATE;
  IF NOT FOUND THEN RETURN; END IF;

  DELETE FROM public.room_players WHERE room_id = p_room_id AND player_id = p_player_id;

  SELECT player_id INTO v_next_host
  FROM public.room_players
  WHERE room_id = p_room_id
  ORDER BY joined_at ASC
  LIMIT 1;

  IF v_next_host IS NULL THEN
    DELETE FROM public.rooms WHERE id = p_room_id;
  ELSIF v_room.host_player_id = p_player_id THEN
    UPDATE public.rooms SET host_player_id = v_next_host WHERE id = p_room_id;
    UPDATE public.room_players SET is_host = (player_id = v_next_host) WHERE room_id = p_room_id;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.transfer_host(
  p_room_id UUID,
  p_disconnected_player_id UUID
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
  SELECT * INTO v_room FROM public.rooms WHERE id = p_room_id FOR UPDATE;
  IF NOT FOUND THEN RETURN NULL; END IF;

  UPDATE public.room_players
  SET is_connected = false
  WHERE room_id = p_room_id AND player_id = p_disconnected_player_id;

  IF v_room.host_player_id = p_disconnected_player_id AND v_room.status = 'WAITING' THEN
    SELECT player_id INTO v_next_host
    FROM public.room_players
    WHERE room_id = p_room_id AND player_id <> p_disconnected_player_id AND is_connected = true
    ORDER BY joined_at ASC
    LIMIT 1;

    IF v_next_host IS NOT NULL THEN
      UPDATE public.rooms SET host_player_id = v_next_host WHERE id = p_room_id;
      UPDATE public.room_players SET is_host = (player_id = v_next_host) WHERE room_id = p_room_id;
      RETURN v_next_host;
    END IF;
  END IF;

  RETURN v_room.host_player_id;
END;
$$;

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
    RAISE EXCEPTION 'At least 2 explorers are required to start a multiplayer match';
  END IF;

  UPDATE public.rooms
  SET status = 'PLAYING', expires_at = now() + interval '4 hours'
  WHERE id = p_room_id;

  INSERT INTO public.matches (room_id, seed, status, map_configuration)
  VALUES (p_room_id, p_seed, 'PLAYING', p_map_configuration)
  RETURNING * INTO v_match;

  INSERT INTO public.match_players (match_id, player_id, health, apples, coins)
  SELECT v_match.id, rp.player_id, 100, 0, 0
  FROM public.room_players rp
  WHERE rp.room_id = p_room_id;

  -- Register world items for atomic pickup validation
  FOR v_item IN SELECT * FROM jsonb_array_elements(COALESCE(p_map_configuration->'apples', '[]'::jsonb)) LOOP
    INSERT INTO public.match_world_items (match_id, item_key, item_type)
    VALUES (v_match.id, v_item->>'id', 'apple')
    ON CONFLICT DO NOTHING;
  END LOOP;

  FOR v_item IN SELECT * FROM jsonb_array_elements(COALESCE(p_map_configuration->'normalChests', '[]'::jsonb)) LOOP
    INSERT INTO public.match_world_items (match_id, item_key, item_type)
    VALUES (v_match.id, v_item->>'id', 'normal_chest')
    ON CONFLICT DO NOTHING;
  END LOOP;

  FOR v_item IN SELECT * FROM jsonb_array_elements(COALESCE(p_map_configuration->'ancientChests', '[]'::jsonb)) LOOP
    INSERT INTO public.match_world_items (match_id, item_key, item_type)
    VALUES (v_match.id, v_item->>'id', 'ancient_chest')
    ON CONFLICT DO NOTHING;
  END LOOP;

  FOR v_item IN SELECT * FROM jsonb_array_elements(COALESCE(p_map_configuration->'runeShrines', '[]'::jsonb)) LOOP
    INSERT INTO public.match_world_items (match_id, item_key, item_type)
    VALUES (v_match.id, v_item->>'id', 'rune_shrine')
    ON CONFLICT DO NOTHING;
  END LOOP;

  INSERT INTO public.match_events (match_id, player_id, event_type, event_data)
  VALUES (v_match.id, p_host_player_id, 'MATCH_STARTED', jsonb_build_object('seed', p_seed));

  RETURN v_match;
END;
$$;

CREATE OR REPLACE FUNCTION public.record_attack_hit(
  p_match_id UUID,
  p_attacker_id UUID,
  p_target_id UUID,
  p_attacker_pos JSONB,
  p_target_pos JSONB
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

CREATE OR REPLACE FUNCTION public.complete_respawn(
  p_match_id UUID,
  p_player_id UUID
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
  SELECT * INTO v_mp FROM public.match_players WHERE match_id = p_match_id AND player_id = p_player_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Player not in match';
  END IF;

  IF NOT v_mp.is_dead THEN
    RETURN jsonb_build_object('respawned', false, 'health', v_mp.health);
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

CREATE OR REPLACE FUNCTION public.collect_apple(
  p_match_id UUID,
  p_player_id UUID,
  p_item_key TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_mp public.match_players;
  v_claimed public.match_world_items;
BEGIN
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

CREATE OR REPLACE FUNCTION public.use_apple(
  p_match_id UUID,
  p_player_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_mp public.match_players;
  v_new_hp INT;
BEGIN
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

CREATE OR REPLACE FUNCTION public.open_normal_chest(
  p_match_id UUID,
  p_player_id UUID,
  p_item_key TEXT,
  p_coins_reward INT,
  p_bonus_apple BOOLEAN
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_mp public.match_players;
  v_claimed public.match_world_items;
  v_new_apples INT;
BEGIN
  SELECT * INTO v_mp FROM public.match_players WHERE match_id = p_match_id AND player_id = p_player_id FOR UPDATE;
  IF NOT FOUND OR v_mp.is_dead THEN
    RETURN jsonb_build_object('opened', false, 'reason', 'invalid_player');
  END IF;

  UPDATE public.match_world_items
  SET claimed_by = p_player_id, claimed_at = now()
  WHERE match_id = p_match_id AND item_key = p_item_key AND item_type = 'normal_chest' AND claimed_by IS NULL
  RETURNING * INTO v_claimed;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('opened', false, 'reason', 'already_opened');
  END IF;

  v_new_apples := CASE WHEN p_bonus_apple AND v_mp.apples < 3 THEN v_mp.apples + 1 ELSE v_mp.apples END;

  UPDATE public.match_players
  SET coins = coins + GREATEST(0, LEAST(50, p_coins_reward)),
      apples = v_new_apples,
      opened_chests = opened_chests + 1
  WHERE id = v_mp.id;

  RETURN jsonb_build_object(
    'opened', true,
    'coins', v_mp.coins + GREATEST(0, LEAST(50, p_coins_reward)),
    'apples', v_new_apples,
    'got_apple', (v_new_apples > v_mp.apples)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.get_next_question(
  p_match_id UUID,
  p_player_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_q public.questions;
BEGIN
  SELECT q.* INTO v_q
  FROM public.questions q
  WHERE NOT EXISTS (
    SELECT 1 FROM public.match_player_questions mpq
    WHERE mpq.match_id = p_match_id
      AND mpq.player_id = p_player_id
      AND mpq.question_id = q.id
  )
  ORDER BY random()
  LIMIT 1;

  IF NOT FOUND THEN
    SELECT q.* INTO v_q FROM public.questions q ORDER BY random() LIMIT 1;
  END IF;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Question bank is empty';
  END IF;

  INSERT INTO public.match_player_questions (match_id, player_id, question_id)
  VALUES (p_match_id, p_player_id, v_q.id)
  ON CONFLICT DO NOTHING;

  RETURN jsonb_build_object(
    'id', v_q.id,
    'subject', v_q.subject,
    'topic', v_q.topic,
    'difficulty', v_q.difficulty,
    'question_text', v_q.question_text,
    'options', v_q.options
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.submit_quiz_answer(
  p_match_id UUID,
  p_player_id UUID,
  p_question_id UUID,
  p_selected_index INT,
  p_item_key TEXT,
  p_challenge_kind TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_q public.questions;
  v_mp public.match_players;
  v_is_correct BOOLEAN;
  v_coins_delta INT := 0;
  v_hp_delta INT := 0;
  v_new_hp INT;
  v_new_coins INT;
  v_item_claimed BOOLEAN := false;
  v_penalty_type TEXT := 'none';
  v_clue_unlocked BOOLEAN := false;
  v_roll DOUBLE PRECISION;
BEGIN
  SELECT * INTO v_q FROM public.questions WHERE id = p_question_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Question not found';
  END IF;

  SELECT * INTO v_mp FROM public.match_players WHERE match_id = p_match_id AND player_id = p_player_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Player not in match';
  END IF;

  v_is_correct := (p_selected_index = v_q.correct_answer);

  UPDATE public.match_player_questions
  SET is_correct = v_is_correct, answered_at = now()
  WHERE match_id = p_match_id AND player_id = p_player_id AND question_id = p_question_id;

  v_new_hp := v_mp.health;
  v_new_coins := v_mp.coins;

  IF v_is_correct THEN
    v_coins_delta := CASE v_q.difficulty WHEN 'hard' THEN 45 WHEN 'medium' THEN 35 ELSE 25 END;
    v_new_coins := v_mp.coins + v_coins_delta;
    v_clue_unlocked := true;

    IF p_item_key IS NOT NULL AND p_item_key <> '' THEN
      UPDATE public.match_world_items
      SET claimed_by = p_player_id, claimed_at = now()
      WHERE match_id = p_match_id AND item_key = p_item_key AND claimed_by IS NULL;
      IF FOUND THEN
        v_item_claimed := true;
      END IF;
    END IF;

    UPDATE public.match_players
    SET coins = v_new_coins,
        correct_answers = correct_answers + 1,
        opened_chests = opened_chests + CASE WHEN v_item_claimed AND p_challenge_kind = 'ancient_chest' THEN 1 ELSE 0 END,
        clues_found = clues_found + 1
    WHERE id = v_mp.id;
  ELSE
    -- Varied penalties so wrong answers feel dynamic rather than always losing HP
    v_roll := random();
    IF v_roll < 0.45 THEN
      v_penalty_type := 'trap_damage';
      v_hp_delta := -15;
      v_new_hp := GREATEST(5, v_mp.health - 15);
    ELSIF v_roll < 0.75 AND v_mp.coins >= 10 THEN
      v_penalty_type := 'coin_loss';
      v_coins_delta := -10;
      v_new_coins := GREATEST(0, v_mp.coins - 10);
    ELSE
      v_penalty_type := 'rune_lock';
    END IF;

    UPDATE public.match_players
    SET health = v_new_hp,
        coins = v_new_coins,
        incorrect_answers = incorrect_answers + 1
    WHERE id = v_mp.id;
  END IF;

  INSERT INTO public.match_events (match_id, player_id, event_type, event_data)
  VALUES (p_match_id, p_player_id, 'QUIZ_ANSWERED', jsonb_build_object(
    'question_id', p_question_id,
    'is_correct', v_is_correct,
    'penalty', v_penalty_type
  ));

  RETURN jsonb_build_object(
    'is_correct', v_is_correct,
    'correct_index', v_q.correct_answer,
    'explanation', v_q.explanation,
    'coins_delta', v_coins_delta,
    'hp_delta', v_hp_delta,
    'new_hp', v_new_hp,
    'new_coins', v_new_coins,
    'item_claimed', v_item_claimed,
    'penalty_type', v_penalty_type,
    'clue_unlocked', v_clue_unlocked
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.apply_trap_damage(
  p_match_id UUID,
  p_player_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_mp public.match_players;
  v_new_hp INT;
  v_is_dead BOOLEAN := false;
  v_respawn TIMESTAMPTZ := NULL;
BEGIN
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

  SELECT * INTO v_mp FROM public.match_players WHERE match_id = p_match_id AND player_id = p_player_id;
  IF NOT FOUND OR v_mp.is_dead THEN
    RETURN jsonb_build_object('claimed', false, 'reason', 'invalid_player');
  END IF;

  v_tx := ((v_match.map_configuration->'secretTreasure'->>'tileX')::double precision + 0.5) * (v_match.map_configuration->>'tileSize')::double precision;
  v_ty := ((v_match.map_configuration->'secretTreasure'->>'tileY')::double precision + 0.5) * (v_match.map_configuration->>'tileSize')::double precision;

  v_dist := sqrt(
    power((p_player_pos->>'x')::double precision - v_tx, 2) +
    power((p_player_pos->>'y')::double precision - v_ty, 2)
  );

  IF v_dist > 110 THEN
    RETURN jsonb_build_object('claimed', false, 'reason', 'too_far');
  END IF;

  -- Atomic single-winner update
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
  UPDATE public.match_players SET coins = coins + 250, final_position = p_player_pos WHERE id = v_mp.id;

  INSERT INTO public.match_events (match_id, player_id, event_type, event_data)
  VALUES (p_match_id, p_player_id, 'SECRET_TREASURE_CLAIMED', p_player_pos);

  RETURN jsonb_build_object('claimed', true, 'winner_player_id', p_player_id, 'finished_at', v_match.finished_at);
END;
$$;

CREATE OR REPLACE FUNCTION public.play_again(
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
BEGIN
  RETURN public.start_match(p_room_id, p_host_player_id, p_seed, p_map_configuration);
END;
$$;

-- Grant RPC execution to browser clients
GRANT EXECUTE ON FUNCTION public.cleanup_expired_rooms() TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_player_profile(TEXT, TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_room(UUID) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.join_room(TEXT, UUID) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.leave_room(UUID, UUID) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.transfer_host(UUID, UUID) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.start_match(UUID, UUID, TEXT, JSONB) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_attack_hit(UUID, UUID, UUID, JSONB, JSONB) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.complete_respawn(UUID, UUID) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.collect_apple(UUID, UUID, TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.use_apple(UUID, UUID) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.open_normal_chest(UUID, UUID, TEXT, INT, BOOLEAN) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_next_question(UUID, UUID) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.submit_quiz_answer(UUID, UUID, UUID, INT, TEXT, TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_trap_damage(UUID, UUID) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_secret_treasure(UUID, UUID, JSONB) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.play_again(UUID, UUID, TEXT, JSONB) TO anon, authenticated;
