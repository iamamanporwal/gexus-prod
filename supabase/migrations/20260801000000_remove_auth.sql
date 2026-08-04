-- Remove authentication.
--
-- This fork runs as a single hard-coded local identity (see shared/localUser.ts).
-- There is no sign-in, no session and no JWT, so `auth.uid()` is always NULL and
-- every RLS policy keyed on it would deny every row. Rather than leave policies
-- that can never match, this migration takes identity out of the database:
--
--   1. drop the foreign keys into auth.users, so a synthetic user_id is legal
--   2. drop the auth.users trigger that used to create profiles
--   3. drop every RLS policy on the app tables and disable RLS
--   4. create the storage buckets (config.toml only covers the local stack)
--   5. replace the auth.uid()-scoped storage policies with permissive ones
--   6. seed the profile row for the local user
--
-- The app is now single-user by construction. Do not deploy this anywhere
-- reachable from the internet: the anon key grants full read/write.

-- 1. Foreign keys into auth.users -------------------------------------------

ALTER TABLE "public"."conversations" DROP CONSTRAINT IF EXISTS "conversations_user_id_fkey";
ALTER TABLE "public"."images" DROP CONSTRAINT IF EXISTS "images_user_id_fkey";
ALTER TABLE "public"."meshes" DROP CONSTRAINT IF EXISTS "meshes_user_id_fkey";
ALTER TABLE "public"."previews" DROP CONSTRAINT IF EXISTS "previews_user_id_fkey";
ALTER TABLE "public"."profiles" DROP CONSTRAINT IF EXISTS "profiles_user_id_fkey";
ALTER TABLE "public"."prompts" DROP CONSTRAINT IF EXISTS "prompts_user_id_fkey";

-- 2. Profile-on-signup trigger ----------------------------------------------

DROP TRIGGER IF EXISTS "on_auth_user_created" ON auth.users;
DROP FUNCTION IF EXISTS public.handle_new_user();

-- 3. RLS on the app tables ---------------------------------------------------
-- Dropped by introspection rather than by name: the policy names have changed
-- across upstream migrations, and anything left behind would silently deny.

DO $$
DECLARE
  target text;
  policy_name text;
BEGIN
  FOREACH target IN ARRAY ARRAY[
    'conversations', 'images', 'meshes', 'messages',
    'previews', 'profiles', 'prompts'
  ] LOOP
    FOR policy_name IN
      SELECT policyname FROM pg_policies
      WHERE schemaname = 'public' AND tablename = target
    LOOP
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', policy_name, target);
    END LOOP;
    EXECUTE format('ALTER TABLE public.%I DISABLE ROW LEVEL SECURITY', target);
  END LOOP;
END $$;

-- 4. Storage buckets ---------------------------------------------------------
-- supabase/config.toml declares images / meshes / previews, but that is only
-- read by the local `supabase start` stack — a remote `supabase db push` does
-- not create them, and uploads then fail with "Bucket not found". Creating
-- them here makes the schema self-contained for both local and hosted.
--
-- `temp-multiview` is referenced by the storage policies below (and by the
-- multiview image flow) but was never declared anywhere upstream; it is
-- created here too so that path doesn't 404.

INSERT INTO storage.buckets (id, name, public)
VALUES
  ('images', 'images', false),
  ('meshes', 'meshes', false),
  ('previews', 'previews', false),
  ('temp-multiview', 'temp-multiview', true)
ON CONFLICT (id) DO NOTHING;

-- 5. Storage policies --------------------------------------------------------
-- The per-user policies matched on the first path segment being auth.uid().
-- Uploads still write under the local user's id, but nothing verifies it now.

DO $$
DECLARE
  policy_name text;
BEGIN
  FOR policy_name IN
    SELECT policyname FROM pg_policies
    WHERE schemaname = 'storage'
      AND tablename = 'objects'
      AND policyname LIKE 'Give users access to own folder%'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON storage.objects', policy_name);
  END LOOP;
END $$;

DROP POLICY IF EXISTS "Public conversations allow anyone to view images_select" ON storage.objects;
DROP POLICY IF EXISTS "Public conversations allow anyone to view meshes_select" ON storage.objects;
DROP POLICY IF EXISTS "Allow service role to upload temp multiview images" ON storage.objects;
DROP POLICY IF EXISTS "Allow public read access to temp multiview images" ON storage.objects;
DROP POLICY IF EXISTS "Allow service role to delete temp multiview images" ON storage.objects;
DROP POLICY IF EXISTS "Local access to app buckets" ON storage.objects;

CREATE POLICY "Local access to app buckets" ON storage.objects
  FOR ALL TO public
  USING (bucket_id IN ('images', 'meshes', 'previews', 'temp-multiview'))
  WITH CHECK (bucket_id IN ('images', 'meshes', 'previews', 'temp-multiview'));

-- 6. The local user's profile ------------------------------------------------
-- Kept in the migration rather than seed.sql so it survives `supabase db reset`
-- and applies to a remote `db push` too. Matches LOCAL_USER_ID.

-- profiles has no unique constraint on user_id, so ON CONFLICT can't guard this.
INSERT INTO public.profiles (user_id, full_name, notifications_enabled)
SELECT '00000000-0000-0000-0000-0000000000cd', 'Local User', false
WHERE NOT EXISTS (
  SELECT 1 FROM public.profiles
  WHERE user_id = '00000000-0000-0000-0000-0000000000cd'
);
