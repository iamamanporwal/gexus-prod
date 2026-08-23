// Server-side data client. Backed by Firestore via firebase-admin.
//
// The factory names are unchanged so the four call sites in aiChat.ts,
// falWebhook.ts and mesh.ts keep working. They are no longer accurate names,
// but renaming them is churn that buys nothing today — and a rename is a safe
// mechanical follow-up, whereas a rushed one now risks the cutover.
//
// The anon/service-role distinction is gone: admin credentials bypass Security
// Rules entirely, so both factories return the same thing. That means handlers
// must keep scoping their own queries by user id — the rules will not do it for
// them here. Both factories are kept so the call sites still *read* as
// privileged or not, and so a future split (e.g. minting a scoped token for the
// anon path) has somewhere obvious to go.

import { getServerDb, getServerStorage } from './firestoreAdmin';

function serverClient() {
  const db = getServerDb();
  return {
    from: db.from,
    storage: getServerStorage(),
  };
}

export type SupabaseClient = ReturnType<typeof serverClient>;

export function getAnonSupabaseClient() {
  return serverClient();
}

export function getServiceRoleSupabaseClient() {
  return serverClient();
}
