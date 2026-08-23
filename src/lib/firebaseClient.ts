// Browser-side Firebase: app init, anonymous auth, and the Firestore adapter
// that backs the postgrest-compatible query API.
//
// Deliberately no Firebase Analytics. getAnalytics() touches `window` at import
// time, which breaks SSR and the prerender step, and PostHog already covers
// product analytics (src/lib/posthog.ts). Adding it would mean two analytics
// SDKs and a broken build.

import { initializeApp, getApps, type FirebaseApp } from 'firebase/app';
import {
  getAuth,
  signInAnonymously,
  onAuthStateChanged,
  type Auth,
} from 'firebase/auth';
import {
  getFirestore,
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  deleteDoc,
  query as fsQuery,
  where,
  orderBy,
  limit as fsLimit,
  getCountFromServer,
  type Firestore,
  type Query,
} from 'firebase/firestore';
import {
  getStorage,
  ref,
  uploadString,
  uploadBytes,
  getBytes,
  getMetadata,
  getDownloadURL,
  deleteObject,
  listAll,
  type FirebaseStorage,
} from 'firebase/storage';
import {
  createQueryApi,
  type FirestoreAdapter,
  type QuerySpec,
  type Row,
} from '@shared/firestore/queryBuilder';
import {
  createTableHooks,
  type OverflowStore,
} from '@shared/firestore/tableHooks';
import {
  bucketPath,
  failStorage,
  okStorage,
  type StorageApi,
  type StorageBucket,
} from '@shared/firestore/storage';

// The web API key is a public project identifier, not a secret — it is designed
// to ship in client bundles, and access is governed by Security Rules. It is
// still read from env so staging and production can point at different projects.
const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

export const isFirebaseConfigMissing =
  !firebaseConfig.apiKey || !firebaseConfig.projectId;

let app: FirebaseApp | undefined;

function firebaseApp(): FirebaseApp {
  if (app) return app;
  app = getApps().length > 0 ? getApps()[0] : initializeApp(firebaseConfig);
  return app;
}

export const firebaseAuth = (): Auth => getAuth(firebaseApp());
const db = (): Firestore => getFirestore(firebaseApp());
const storage = (): FirebaseStorage => getStorage(firebaseApp());

// ── Guest identity ─────────────────────────────────────────────────────────
// Anonymous Auth gives each browser a real uid inside a signed token, which is
// what lets Security Rules enforce per-user isolation. The session persists in
// IndexedDB by default, so a reload keeps the same uid and the same history.

let cachedUid: string | null = null;

export async function ensureGuestSession(): Promise<string> {
  if (cachedUid) return cachedUid;

  const auth = firebaseAuth();

  // A persisted session is restored asynchronously, so wait for the first
  // auth-state callback before deciding whether to create a new guest.
  // Skipping this would mint a fresh uid on every page load and silently
  // orphan the previous guest's conversations.
  const existing = await new Promise<string | null>((resolve) => {
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      unsubscribe();
      resolve(user?.uid ?? null);
    });
  });

  if (existing) {
    cachedUid = existing;
    return cachedUid;
  }

  const credential = await signInAnonymously(auth);
  cachedUid = credential.user.uid;
  return cachedUid;
}

/** Synchronous read for call sites that run after the boot gate in App.tsx. */
export function guestUserId(): string {
  if (!cachedUid) {
    throw new Error(
      'guest session not initialised — ensureGuestSession() must resolve ' +
        'before any query runs',
    );
  }
  return cachedUid;
}

/** The current user's ID token, for authenticating calls to our own API. */
export async function guestIdToken(): Promise<string | null> {
  const user = firebaseAuth().currentUser;
  return user ? user.getIdToken() : null;
}

/**
 * Human-readable label for the account menu and settings page.
 *
 * Anonymous users have no email, so the UI cannot show one. A fake address
 * would be worse than none — it looks like real data and invites someone to
 * try mailing it. The uid suffix gives the guest something stable to recognise
 * across sessions, and makes it obvious which browser they are looking at.
 */
export function guestUserLabel(): string {
  if (!cachedUid) return 'Guest';
  return `Guest · ${cachedUid.slice(0, 6)}`;
}

// ── Firestore adapter ──────────────────────────────────────────────────────

const clientAdapter: FirestoreAdapter = {
  async read(spec: QuerySpec): Promise<Row[]> {
    // An equality on `id` is a document lookup, and running it as a query
    // instead is not just slower — under Security Rules it is DENIED. Rules
    // evaluate list operations against the query's constraints, not against
    // the matching documents, so a query that doesn't constrain `user_id`
    // can never prove `ownsExisting()` — the request 403s even when every
    // matching row belongs to the caller. This is exactly what broke the
    // editor at generation time (meshes/images lookups) and share links
    // (conversations lookup, where `privacy == 'public'` is equally
    // unprovable from a query). A single-document get is evaluated against
    // the real document, where those conditions are simply true or false.
    //
    // runUpdate/runDelete read through this method to find their targets, so
    // the fix covers .update().eq('id', ...) and .delete().eq('id', ...) too.
    const idFilter = spec.filters.find(
      (filter) => filter.kind === 'eq' && filter.column === 'id',
    );
    if (idFilter && idFilter.kind === 'eq') {
      const snapshot = await getDoc(
        doc(db(), spec.table, String(idFilter.value)),
      );
      if (!snapshot.exists()) return [];
      const row: Row = { ...snapshot.data(), id: snapshot.id };
      for (const filter of spec.filters) {
        if (filter === idFilter) continue;
        if (filter.kind === 'eq' && row[filter.column] !== filter.value) {
          return [];
        }
        if (
          filter.kind === 'in' &&
          !filter.values.includes(row[filter.column])
        ) {
          return [];
        }
      }
      return [row];
    }

    const constraints = [];

    for (const filter of spec.filters) {
      if (filter.kind === 'eq') {
        constraints.push(where(filter.column, '==', filter.value));
        continue;
      }
      if (filter.values.length > 30) {
        throw new Error(
          `.in() on "${filter.column}" got ${filter.values.length} values; ` +
            `Firestore allows at most 30. Chunk the query.`,
        );
      }
      constraints.push(where(filter.column, 'in', filter.values));
    }

    for (const order of spec.orders) {
      constraints.push(orderBy(order.column, order.ascending ? 'asc' : 'desc'));
    }

    if (spec.limit !== null) constraints.push(fsLimit(spec.limit));

    const q: Query = fsQuery(collection(db(), spec.table), ...constraints);
    const snapshot = await getDocs(q);
    return snapshot.docs.map((d) => ({ ...d.data(), id: d.id }));
  },

  async write(table, id, data, { merge }) {
    await setDoc(doc(db(), table, id), stripUndefined(data), { merge });
  },

  async remove(table, id) {
    await deleteDoc(doc(db(), table, id));
  },

  newId(table) {
    return doc(collection(db(), table)).id;
  },
};

// Firestore rejects `undefined` field values outright, where Postgres stored
// NULL. Call sites written for Postgres pass undefined freely.
function stripUndefined(row: Row): Row {
  const out: Row = {};
  for (const [key, value] of Object.entries(row)) {
    if (value !== undefined) out[key] = value;
  }
  return out;
}

const clientOverflow: OverflowStore = {
  async put(suggestedPath, json) {
    // Namespaced under the writer's uid so storage.rules can authorize it.
    // Without the uid segment there is no path-based rule that could permit a
    // client write here, and the offload would fail with a permission error at
    // exactly the moment a large generation completes.
    const path = `overflow/${guestUserId()}/${suggestedPath}`;
    await uploadString(ref(storage(), path), json, 'raw', {
      contentType: 'application/json',
    });
    return path;
  },
  async get(path) {
    const bytes = await getBytes(ref(storage(), path));
    return new TextDecoder().decode(bytes);
  },
  async delete(path) {
    await deleteObject(ref(storage(), path));
  },
};

/**
 * The replacement for the `supabase` export in src/lib/supabase.ts.
 *
 * Exposes `.from(table)` with the same postgrest dialect the app already uses,
 * so existing call sites need no edits.
 */
export const fdb = createQueryApi(
  clientAdapter,
  createTableHooks(clientAdapter, clientOverflow),
);

/**
 * Server-side aggregate count.
 *
 * Firestore cannot express PostgREST's `messages(count)` embed, and counting by
 * fetching every document would bill a read per message — ruinous on a long
 * conversation. `getCountFromServer` is billed at roughly one read per 1000
 * documents counted, which is what makes the history list affordable.
 *
 * Outside the query shim because counting is not part of the postgrest dialect
 * the shim reproduces.
 */
export async function countRows(
  table: string,
  column: string,
  value: unknown,
): Promise<number> {
  const snapshot = await getCountFromServer(
    fsQuery(collection(db(), table), where(column, '==', value)),
  );
  return snapshot.data().count;
}

// ── Storage shim ───────────────────────────────────────────────────────────

export const fstorage: StorageApi = {
  from(bucket: string): StorageBucket {
    const at = (path: string) => ref(storage(), bucketPath(bucket, path));

    return {
      async upload(path, body, options) {
        try {
          const target = at(path);

          // Supabase fails an upload to an occupied path unless upsert is set;
          // Firebase silently overwrites. Emulate the guard so call sites that
          // rely on the error keep working.
          if (!options?.upsert) {
            const exists = await getMetadata(target)
              .then(() => true)
              .catch(() => false);
            if (exists) {
              return failStorage(
                new Error(`Object already exists at ${path}`),
                null,
              );
            }
          }

          await uploadBytes(target, body as Blob, {
            ...(options?.contentType && { contentType: options.contentType }),
          });
          return okStorage({ path });
        } catch (error) {
          return failStorage(error, null);
        }
      },

      async download(path) {
        try {
          const bytes = await getBytes(at(path));
          return okStorage(new Blob([bytes]));
        } catch (error) {
          return failStorage(error, null);
        }
      },

      // `expiresIn` is intentionally unused: the web SDK cannot mint expiring
      // URLs. See the note on StorageBucket.createSignedUrl.
      async createSignedUrl(path, _expiresIn) {
        try {
          return okStorage({ signedUrl: await getDownloadURL(at(path)), path });
        } catch (error) {
          return failStorage(error, null);
        }
      },

      async createSignedUrls(paths, _expiresIn) {
        try {
          const urls = await Promise.all(
            paths.map(async (path) => ({
              signedUrl: await getDownloadURL(at(path)),
              path,
            })),
          );
          return okStorage(urls);
        } catch (error) {
          return failStorage(error, null);
        }
      },

      async remove(paths) {
        try {
          // Supabase's remove() is forgiving about paths that are already gone;
          // deleteObject throws. Swallow only the not-found case.
          await Promise.all(
            paths.map((path) =>
              deleteObject(at(path)).catch((error: { code?: string }) => {
                if (error?.code === 'storage/object-not-found') return;
                throw error;
              }),
            ),
          );
          return okStorage(null);
        } catch (error) {
          return failStorage(error, null);
        }
      },

      async list(prefix, options) {
        try {
          const result = await listAll(at(prefix ?? ''));
          // Supabase returns basenames, not full paths.
          let entries = result.items.map((item) => ({ name: item.name }));

          // No server-side name filter in Firebase Storage; applied here.
          if (options?.search) {
            const needle = options.search;
            entries = entries.filter((e) => e.name.includes(needle));
          }
          if (options?.offset) entries = entries.slice(options.offset);
          if (options?.limit) entries = entries.slice(0, options.limit);

          return okStorage(entries);
        } catch (error) {
          return failStorage(error, null);
        }
      },

      async exists(path) {
        try {
          await getMetadata(at(path));
          return okStorage(true);
        } catch {
          // Any failure to read metadata is treated as absent, matching how
          // Supabase's exists() reports a missing object rather than throwing.
          return okStorage(false);
        }
      },
    };
  },
};

export { clientAdapter, clientOverflow };
