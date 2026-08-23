CREATE TABLE IF NOT EXISTS "public"."images" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "status" "public"."generation-status" DEFAULT 'pending'::"public"."generation-status" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "conversation_id" "uuid" NOT NULL,
    "image_generation_call_id" "text",
    "prompt" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL
);


CREATE UNIQUE INDEX IF NOT EXISTS images_pkey ON "public"."images" USING btree (id);

ALTER TABLE "public"."images" ADD CONSTRAINT "images_pkey" PRIMARY KEY USING INDEX "images_pkey";

ALTER TABLE "public"."images" ADD CONSTRAINT "images_conversation_id_fkey" FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON UPDATE CASCADE ON DELETE CASCADE not valid;

ALTER TABLE "public"."images" VALIDATE CONSTRAINT "images_conversation_id_fkey";

-- No FK into auth.users: see supabase/migrations/20260801000000_remove_auth.sql.

CREATE INDEX IF NOT EXISTS idx_images_image_generation_call_id ON "public"."images" USING "btree" ("image_generation_call_id");


-- RLS intentionally disabled: the policies were keyed on auth.uid().
ALTER TABLE "public"."images" DISABLE ROW LEVEL SECURITY;
