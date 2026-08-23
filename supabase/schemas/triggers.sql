CREATE OR REPLACE FUNCTION "public"."update_conversation_leaf"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
begin
  update conversations set 
    current_message_leaf_id = new.id,
    updated_at = now()
  where id = new.conversation_id;
  return new;
end;
$$;

CREATE OR REPLACE TRIGGER "update_leaf_trigger" AFTER INSERT ON "public"."messages" FOR EACH ROW EXECUTE FUNCTION "public"."update_conversation_leaf"();

-- Previews updated_at trigger
-- Function to update the updated_at column
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Trigger to automatically update updated_at for previews
CREATE OR REPLACE TRIGGER update_previews_updated_at 
    BEFORE UPDATE ON "public"."previews" 
    FOR EACH ROW 
    EXECUTE FUNCTION update_updated_at_column();

-- The profile-on-signup trigger (handle_new_user / on_auth_user_created) was
-- removed with authentication: there are no sign-ups, and the single local
-- profile row is inserted by
-- supabase/migrations/20260801000000_remove_auth.sql.
