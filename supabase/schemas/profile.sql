CREATE TABLE IF NOT EXISTS "public"."profiles" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "full_name" "text" NOT NULL,
    "notifications_enabled" boolean DEFAULT false NOT NULL,
    "avatar_path" "text" DEFAULT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS profiles_pkey ON "public"."profiles" USING btree (id);

ALTER TABLE "public"."profiles" ADD CONSTRAINT "profiles_pkey" PRIMARY KEY USING INDEX "profiles_pkey";

-- No FK into auth.users: the single local profile row is inserted by
-- supabase/migrations/20260801000000_remove_auth.sql.

-- RLS intentionally disabled: the policy was keyed on auth.uid().
ALTER TABLE "public"."profiles" DISABLE ROW LEVEL SECURITY;