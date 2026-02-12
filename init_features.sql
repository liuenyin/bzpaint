-- Feature Initialization Script
-- Run this in Supabase SQL Editor

-- 1. System Settings (for Announcements)
CREATE TABLE IF NOT EXISTS public.system_settings (
  key text PRIMARY KEY,
  value text,
  updated_at timestamptz DEFAULT now()
);

-- Insert default announcement
INSERT INTO public.system_settings (key, value)
VALUES ('announcement', '欢迎来到冬日绘板！(Welcome to Winter Paintboard!)')
ON CONFLICT (key) DO NOTHING;

-- 2. Snapshots (for Timelapse/Backup)
CREATE TABLE IF NOT EXISTS public.snapshots (
  id serial PRIMARY KEY,
  created_at timestamptz DEFAULT now(),
  image_data bytea
);

-- 3. Invite Codes (for Registration)
CREATE TABLE IF NOT EXISTS public.invite_codes (
  id serial PRIMARY KEY,
  code text NOT NULL UNIQUE,
  created_by uuid REFERENCES auth.users(id),
  used_by uuid,
  is_used boolean DEFAULT false,
  created_at timestamptz DEFAULT now()
);

-- 4. Token Delegation
DO $$ 
BEGIN 
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='profiles' AND column_name='token_yield_beneficiary') THEN 
        ALTER TABLE public.profiles ADD COLUMN token_yield_beneficiary text;
    END IF;
    -- Ensure tokens and last_token_update have defaults
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='profiles' AND column_name='last_token_update') THEN 
        ALTER TABLE public.profiles ADD COLUMN last_token_update timestamptz DEFAULT now();
    END IF;
END $$;

-- Set defaults for existing rows that may have NULLs
UPDATE public.profiles SET tokens = 20 WHERE tokens IS NULL;
UPDATE public.profiles SET last_token_update = now() WHERE last_token_update IS NULL;

-- --- RLS & Permissions ---
-- IMPORTANT: Service role key bypasses RLS entirely.
-- These policies are for anon/authenticated access only.

ALTER TABLE public.system_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invite_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pixels ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- Pixels: Full public access (server manages this)
DROP POLICY IF EXISTS "Public Access Pixels" ON public.pixels;
CREATE POLICY "Public Access Pixels" ON public.pixels FOR ALL USING (true) WITH CHECK (true);

-- Profiles: Full public access (server manages access control)
DROP POLICY IF EXISTS "Public Access Profiles" ON public.profiles;
CREATE POLICY "Public Access Profiles" ON public.profiles FOR ALL USING (true) WITH CHECK (true);

-- Settings: Public Read
DROP POLICY IF EXISTS "Public Read Settings" ON public.system_settings;
CREATE POLICY "Public Read Settings" ON public.system_settings FOR SELECT USING (true);
DROP POLICY IF EXISTS "Public Write Settings" ON public.system_settings;
CREATE POLICY "Public Write Settings" ON public.system_settings FOR ALL USING (true) WITH CHECK (true);

-- Snapshots: Full access (server writes, anyone reads)
DROP POLICY IF EXISTS "Public Read Snapshots" ON public.snapshots;
CREATE POLICY "Public Read Snapshots" ON public.snapshots FOR SELECT USING (true);
DROP POLICY IF EXISTS "Server Insert Snapshots" ON public.snapshots;
CREATE POLICY "Server Insert Snapshots" ON public.snapshots FOR INSERT WITH CHECK (true);

-- Invite Codes: Full access (server manages all logic)
DROP POLICY IF EXISTS "Users Create Invites" ON public.invite_codes;
DROP POLICY IF EXISTS "Users Read Own Invites" ON public.invite_codes;
DROP POLICY IF EXISTS "Public Access Invites" ON public.invite_codes;
CREATE POLICY "Public Access Invites" ON public.invite_codes FOR ALL USING (true) WITH CHECK (true);
