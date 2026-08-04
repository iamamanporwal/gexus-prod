CREATE TABLE IF NOT EXISTS "public"."meshes" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "status" "public"."generation-status" DEFAULT 'pending'::"public"."generation-status" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "images" "uuid"[],
    "conversation_id" "uuid" NOT NULL,
    "prompt" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "file_type" "public"."mesh_file_type" DEFAULT 'glb'::"public"."mesh_file_type" NOT NULL
);


CREATE UNIQUE INDEX IF NOT EXISTS meshes_pkey ON "public"."meshes" USING btree (id);

ALTER TABLE "public"."meshes" ADD CONSTRAINT "meshes_pkey" PRIMARY KEY USING INDEX "meshes_pkey";

ALTER TABLE "public"."meshes" ADD CONSTRAINT "meshes_conversation_id_fkey" FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON UPDATE CASCADE ON DELETE CASCADE not valid;

ALTER TABLE "public"."meshes" VALIDATE CONSTRAINT "meshes_conversation_id_fkey";

-- No FK into auth.users: see supabase/migrations/20260801000000_remove_auth.sql.

-- RLS intentionally disabled: the policies were keyed on auth.uid().
ALTER TABLE "public"."meshes" DISABLE ROW LEVEL SECURITY;
