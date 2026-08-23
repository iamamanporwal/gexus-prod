CREATE TABLE IF NOT EXISTS "public"."previews" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "status" "public"."generation-status" DEFAULT 'pending'::"public"."generation-status" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "conversation_id" "uuid" NOT NULL,
    "mesh_id" "uuid" NOT NULL
);


CREATE UNIQUE INDEX IF NOT EXISTS previews_pkey ON "public"."previews" USING btree (id);

ALTER TABLE "public"."previews" ADD CONSTRAINT "previews_pkey" PRIMARY KEY USING INDEX "previews_pkey";

-- No FK into auth.users: see supabase/migrations/20260801000000_remove_auth.sql.

ALTER TABLE "public"."previews" ADD CONSTRAINT "previews_conversation_id_fkey" FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON UPDATE CASCADE ON DELETE CASCADE not valid;

ALTER TABLE "public"."previews" VALIDATE CONSTRAINT "previews_conversation_id_fkey";

ALTER TABLE "public"."previews" ADD CONSTRAINT "previews_mesh_id_fkey" FOREIGN KEY (mesh_id) REFERENCES meshes(id) ON DELETE CASCADE not valid;

ALTER TABLE "public"."previews" VALIDATE CONSTRAINT "previews_mesh_id_fkey";


-- RLS intentionally disabled: the policy was keyed on auth.uid().
ALTER TABLE "public"."previews" DISABLE ROW LEVEL SECURITY;