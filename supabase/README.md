# Supabase Setup Guide for TREASUREBOUND: The Lost Secret

Follow these steps to connect your real multiplayer backend:

1. **Create a Free Supabase Project**
   - Go to [supabase.com](https://supabase.com) and create a new project.

2. **Run Database Migrations (in exact order)**
   - Open **SQL Editor** in your Supabase Dashboard.
   - Run `supabase/migrations/001_initial_schema.sql` (base tables, RLS, Realtime publication).
   - Run `supabase/migrations/003_update_v2_progression_10p.sql` (upgrades rooms to 10 players, adds `SD/SMP/SMA` difficulty, 4-stage treasure progression, and server-side scoring RPCs).
   - Run `supabase/migrations/004_seed_300_questions.sql` (seeds 320 Indonesian educational questions across SD, SMP, and SMA).
   - *(Note: `002_seed_questions.sql` is superseded by `004_seed_300_questions.sql`; if you ran `002` previously, running `003` then `004` upgrades everything cleanly.)*

3. **Verify Realtime**
   - In **Database → Replication**, confirm `rooms`, `room_players`, `matches`, `match_players`, and `match_world_items` are enabled under `supabase_realtime`.

4. **Configure Environment Variables**
   - Local development: copy `.env.example` to `.env` and fill in:
     - `VITE_SUPABASE_URL` (Project Settings → API → Project URL)
     - `VITE_SUPABASE_ANON_KEY` (Project Settings → API → `anon` `public` key)
   - Vercel deployment: add `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` in **Project Settings → Environment Variables**, then redeploy.
   - Never expose your `service_role` key in frontend environment variables.
