// Server-side Firestore + Storage, via firebase-admin.
//
// Supplies the FirestoreAdapter and OverflowStore that shared/firestore expects,
// so server handlers keep using the same `.from(...).select(...)` dialect they
// used against Supabase.

import { cert, getApps, initializeApp, type App } from 'firebase-admin/app';
import {
  getFirestore,
  type Firestore,
  type Query,
} from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
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
import { requiredEnv } from './env';

let cachedApp: App | undefined;

export function adminApp(): App {
  if (cachedApp) return cachedApp;

  const existing = getApps();
  if (existing.length > 0) {
    cachedApp = existing[0];
    return cachedApp;
  }

  cachedApp = initializeApp({
    credential: cert({
      projectId: requiredEnv('FIREBASE_PROJECT_ID'),
      clientEmail: requiredEnv('FIREBASE_CLIENT_EMAIL'),
      // Vercel's env UI cannot hold real newlines, so the PEM is stored with
      // literal "\n" sequences and restored here. Without this the SDK fails
      // with an opaque "Invalid PEM formatted message".
      privateKey: requiredEnv('FIREBASE_PRIVATE_KEY').replace(/\\n/g, '\n'),
    }),
    storageBucket: requiredEnv('FIREBASE_STORAGE_BUCKET'),
  });

  return cachedApp;
}

const db = (): Firestore => getFirestore(adminApp());
const bucket = () => getStorage(adminApp()).bucket();

const adminAdapter: FirestoreAdapter = {
  async read(spec: QuerySpec): Promise<Row[]> {
    let query: Query = db().collection(spec.table);

    for (const filter of spec.filters) {
      if (filter.kind === 'eq') {
        query = query.where(filter.column, '==', filter.value);
        continue;
      }
      // Firestore caps `in` at 30 values. The one call site passes a short
      // list, so this is fine today — but fail loudly if that ever changes
      // rather than silently dropping the tail of the query.
      if (filter.values.length > 30) {
        throw new Error(
          `.in() on "${filter.column}" got ${filter.values.length} values; ` +
            `Firestore allows at most 30. Chunk the query.`,
        );
      }
      query = query.where(filter.column, 'in', filter.values);
    }

    for (const order of spec.orders) {
      query = query.orderBy(order.column, order.ascending ? 'asc' : 'desc');
    }

    if (spec.limit !== null) query = query.limit(spec.limit);

    const snapshot = await query.get();
    return snapshot.docs.map((doc) => ({ ...doc.data(), id: doc.id }));
  },

  async write(table, id, data, { merge }) {
    await db().collection(table).doc(id).set(stripUndefined(data), { merge });
  },

  async remove(table, id) {
    await db().collection(table).doc(id).delete();
  },

  newId(table) {
    return db().collection(table).doc().id;
  },
};

// Firestore rejects `undefined` field values outright, where Postgres simply
// stored NULL. Callers built for Postgres pass undefined freely.
function stripUndefined(row: Row): Row {
  const out: Row = {};
  for (const [key, value] of Object.entries(row)) {
    if (value !== undefined) out[key] = value;
  }
  return out;
}

const adminOverflow: OverflowStore = {
  async put(suggestedPath, json) {
    // Server writes use admin credentials, which bypass Storage rules, so no
    // uid segment is needed. Kept under the same `overflow/` root as the client
    // for one obvious place to inspect or purge.
    const path = `overflow/server/${suggestedPath}`;
    await bucket()
      .file(path)
      .save(json, { contentType: 'application/json', resumable: false });
    return path;
  },
  async get(path) {
    const [buf] = await bucket().file(path).download();
    return buf.toString('utf8');
  },
  async delete(path) {
    await bucket().file(path).delete({ ignoreNotFound: true });
  },
};

/**
 * Drop-in replacement for getAnonSupabaseClient() / getServiceRoleSupabaseClient().
 *
 * Admin credentials bypass Security Rules by design, which is the same posture
 * the service-role Supabase key had. Handlers must therefore keep scoping their
 * own queries by user id — the rules do not do it for them here.
 */
export function getServerDb() {
  return createQueryApi(
    adminAdapter,
    createTableHooks(adminAdapter, adminOverflow),
  );
}

// ── Storage shim ───────────────────────────────────────────────────────────
// Unlike the client, admin credentials can mint genuinely time-limited signed
// URLs. That matters: the server hands these to external providers (fal), and
// a non-expiring URL to a user's private model would stay live forever.

export function getServerStorage(): StorageApi {
  return {
    from(bucketName: string): StorageBucket {
      const file = (path: string) =>
        bucket().file(bucketPath(bucketName, path));

      return {
        async upload(path, body, options) {
          try {
            const target = file(path);

            if (!options?.upsert) {
              const [exists] = await target.exists();
              if (exists) {
                return failStorage(
                  new Error(`Object already exists at ${path}`),
                  null,
                );
              }
            }

            const buffer = await toBuffer(body);
            await target.save(buffer, {
              resumable: false,
              ...(options?.contentType && {
                contentType: options.contentType,
              }),
            });
            return okStorage({ path });
          } catch (error) {
            return failStorage(error, null);
          }
        },

        async download(path) {
          try {
            const [buf] = await file(path).download();
            return okStorage(new Blob([new Uint8Array(buf)]));
          } catch (error) {
            return failStorage(error, null);
          }
        },

        async createSignedUrl(path, expiresIn) {
          try {
            const [signedUrl] = await file(path).getSignedUrl({
              action: 'read',
              expires: Date.now() + expiresIn * 1000,
            });
            return okStorage({ signedUrl, path });
          } catch (error) {
            return failStorage(error, null);
          }
        },

        async createSignedUrls(paths, expiresIn) {
          try {
            const urls = await Promise.all(
              paths.map(async (path) => {
                const [signedUrl] = await file(path).getSignedUrl({
                  action: 'read',
                  expires: Date.now() + expiresIn * 1000,
                });
                return { signedUrl, path };
              }),
            );
            return okStorage(urls);
          } catch (error) {
            return failStorage(error, null);
          }
        },

        async remove(paths) {
          try {
            await Promise.all(
              paths.map((path) => file(path).delete({ ignoreNotFound: true })),
            );
            return okStorage(null);
          } catch (error) {
            return failStorage(error, null);
          }
        },

        async list(prefix, options) {
          try {
            const dir = bucketPath(bucketName, prefix ?? '');
            const [files] = await bucket().getFiles({
              prefix: dir.endsWith('/') ? dir : `${dir}/`,
            });

            // Supabase returns basenames; strip the prefix path.
            let entries = files.map((f) => ({
              name: f.name.split('/').pop() ?? f.name,
            }));

            // GCS has no server-side name filter, so `search` is applied here.
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
            const [found] = await file(path).exists();
            return okStorage(found);
          } catch (error) {
            return failStorage(error, false);
          }
        },
      };
    },
  };
}

async function toBuffer(
  body: Blob | File | ArrayBuffer | Uint8Array | string,
): Promise<Buffer> {
  if (typeof body === 'string') return Buffer.from(body, 'utf8');
  if (body instanceof Uint8Array) return Buffer.from(body);
  if (body instanceof ArrayBuffer) return Buffer.from(new Uint8Array(body));
  return Buffer.from(new Uint8Array(await body.arrayBuffer()));
}

export { adminAdapter, adminOverflow, bucket as adminBucket };
