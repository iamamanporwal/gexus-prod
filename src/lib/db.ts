// The app's data client. Replaces src/lib/supabase.ts.
//
// Exported as `supabase` on purpose: ~99 call sites across 30 files use the
// postgrest dialect (`supabase.from('x').select().eq()`), and the shim in
// shared/firestore implements exactly that dialect over Firestore. Keeping the
// binding name means the cutover is an import change per file rather than a
// rewrite of every query — and a rewrite of 99 queries under time pressure is
// how you lose data.
//
// What is deliberately NOT here:
//
//   - `.channel()` / `.removeChannel()`. Supabase Realtime broadcast has no
//     Firestore equivalent, and it turned out not to need one: mesh completion
//     is now an onSnapshot listener (see lib/firebaseMeshWatch.ts), and the
//     `cancel-request` broadcast had no subscriber anywhere in the tree.
//   - `.auth`. Guest sessions are handled by ensureGuestSession() in
//     lib/firebaseClient.ts, gated once at app boot.
//   - `.rpc()`. Never used.
//
// Anything reaching for those will fail to compile, which is the intent: a
// missing method is a visible error, where a silently stubbed one is a bug that
// ships.

import { fdb, fstorage } from './firebaseClient';

export const supabase = {
  from: fdb.from,
  storage: fstorage,
};

export {
  guestUserLabel,
  ensureGuestSession,
  guestUserId,
  guestIdToken,
  currentAccount,
  subscribeToAccount,
  signInWithGoogle,
  signOutAccount,
  SignInCancelledError,
  type AccountSnapshot,
  isFirebaseConfigMissing as isSupabaseConfigMissing,
} from './firebaseClient';
