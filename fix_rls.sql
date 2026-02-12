-- Fix RLS Policies
-- Run this in Supabase SQL Editor

-- 1. Pixels: Allow everyone to read and write (Server validates logic)
-- We need this because if the server uses the Anon Key (due to missing Service Key env), it needs RLS permission.
DROP POLICY IF EXISTS "Public Access" ON public.pixels;
CREATE POLICY "Public Access" ON public.pixels
FOR ALL
USING (true)
WITH CHECK (true);

-- 2. System Settings: Public Read, Admin Write (Policy for Admin)
DROP POLICY IF EXISTS "Public Read Settings" ON public.system_settings;
CREATE POLICY "Public Read Settings" ON public.system_settings
FOR SELECT
USING (true);

-- 3. Invite Codes: Allow authenticated users to create
ALTER TABLE public.invite_codes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can create invites" ON public.invite_codes
FOR INSERT
WITH CHECK (auth.uid() = created_by);

-- 4. Snapshots: Public Read
DROP POLICY IF EXISTS "Public Read Snapshots" ON public.snapshots;
CREATE POLICY "Public Read Snapshots" ON public.snapshots
FOR SELECT
USING (true);
