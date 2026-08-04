import { createClient } from '@supabase/supabase-js';
import { Database } from '@shared/database';

const rawSupabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const rawSupabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

// Flag used by the UI to show a helpful message instead of crashing
export const isSupabaseConfigMissing = !rawSupabaseUrl || !rawSupabaseKey;

// Fallback values keep the client constructable so imports don't throw
// when env vars are missing. The app should gate on isSupabaseConfigMissing
// and avoid making real requests in this state.
const supabaseUrl = rawSupabaseUrl || 'http://localhost';
const supabaseKey = rawSupabaseKey || 'public-anon-key';

// Plain anon client. This build has no authentication: there is no session to
// persist and no token to refresh, and RLS is disabled on every app table (see
// supabase/migrations/20260801000000_remove_auth.sql), so the anon key alone
// carries full read/write. That is only safe because this is a local,
// single-user deployment — do not expose it to a network you don't control.
export const supabase = createClient<Database>(supabaseUrl, supabaseKey, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
  },
});
