// The single local identity this build runs as.
//
// Authentication has been removed from this fork: there is no sign-in, no
// session and no JWT. Everything that used to be scoped to the signed-in user
// is scoped to this constant instead — client queries, server handlers, the
// `user_id` columns and the storage folder prefixes all use LOCAL_USER_ID.
//
// The UUID is fixed (not generated) so that rows written on one run are still
// readable on the next, and so the seeded profile row in supabase/seed.sql can
// reference the same id.
export const LOCAL_USER_ID = '00000000-0000-0000-0000-0000000000cd';
export const LOCAL_USER_EMAIL = 'local@cadam.local';
export const LOCAL_USER_NAME = 'Local User';

// Shaped like the subset of supabase-js's `User` the app actually reads, so
// call sites that previously received an authenticated user keep working.
export const LOCAL_USER = {
  id: LOCAL_USER_ID,
  email: LOCAL_USER_EMAIL,
  user_metadata: { full_name: LOCAL_USER_NAME },
} as const;

export type LocalUser = typeof LOCAL_USER;
