-- Fix Database Error when Deleting User
-- Run this script in your Supabase SQL Editor.

-- When you try to delete a user from Auth, it fails if there are rows in other tables (like profiles, pixels) 
-- that reference this user. This script cleans up that data first.

BEGIN;

-- 1. Delete pixels drawn by this user
DELETE FROM public.pixels
WHERE last_user IN (SELECT id FROM public.profiles WHERE username = 'liuenyin');

-- 2. Delete invite codes created by this user
DELETE FROM public.invite_codes
WHERE created_by IN (SELECT id FROM public.profiles WHERE username = 'liuenyin');

-- 3. Delete the profile (This is the main blocker)
DELETE FROM public.profiles
WHERE username = 'liuenyin';

COMMIT;

-- After running this, go back to Supabase Authentication -> Users and try deleting 'liuenyin@winter.com' again.
-- It should work now.
