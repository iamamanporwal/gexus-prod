CREATE TABLE IF NOT EXISTS "public"."conversations" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "user_id" "uuid" NOT NULL,
    "title" "text" NOT NULL,
    "type" "public"."conversation-type" DEFAULT 'parametric'::"public"."conversation-type" NOT NULL,
    "privacy" "public"."privacy_type" DEFAULT 'private'::"public"."privacy_type" NOT NULL,
    "current_message_leaf_id" "uuid",
    "settings" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL
);


CREATE UNIQUE INDEX IF NOT EXISTS conversations_pkey ON "public"."conversations" USING btree (id);

ALTER TABLE "public"."conversations" ADD CONSTRAINT "conversations_pkey" PRIMARY KEY USING INDEX "conversations_pkey";

-- No FK into auth.users: this build has no authentication, and user_id holds
-- the constant local identity from shared/localUser.ts.

CREATE INDEX IF NOT EXISTS conversations_created_at_idx ON "public"."conversations" USING btree (created_at);

CREATE INDEX IF NOT EXISTS conversations_updated_at_idx ON "public"."conversations" USING btree (updated_at);

CREATE INDEX IF NOT EXISTS conversations_user_id_idx ON "public"."conversations" USING btree (user_id);


-- RLS intentionally disabled: every policy here was keyed on auth.uid(), which
-- is always NULL without authentication and would deny every row.
ALTER TABLE "public"."conversations" DISABLE ROW LEVEL SECURITY;
