// Types for the Supabase-Storage-compatible shim.
//
// The app uses six methods across ~35 call sites, measured:
//   .upload() .download() .createSignedUrl() .createSignedUrls()
//   .remove()  .list()
//
// Both the client (firebase/storage) and server (firebase-admin) implement this
// interface, but note the signed-URL caveat below — it is a genuine behavioural
// difference, not just a different function name.

// A discriminated union, not `{ data: T; error: Error | null }`.
//
// This is what lets `if (error) throw` narrow `data` to non-null at the call
// site — the pattern used throughout mesh.ts and imageGen.ts. With a
// non-discriminated shape, every one of those call sites has to re-check `data`
// or cast, and casting is how a real null slips through to production.
export type StorageResult<T> =
  | { data: T; error: null }
  | { data: null; error: Error };

// Supabase's createSignedUrls reports failure *per item* rather than failing the
// whole batch, and call sites filter on it (`.filter(i => !i.error && ...)`).
// Reproduced so a single unreadable object doesn't discard the rest.
export type SignedUrl = {
  signedUrl: string;
  path?: string;
  error?: string | null;
};

export type StorageEntry = { name: string; id?: string };

export type ListOptions = {
  /** Substring filter on the entry name. */
  search?: string;
  limit?: number;
  offset?: number;
};

export type UploadOptions = {
  contentType?: string;
  upsert?: boolean;
};

export interface StorageBucket {
  /**
   * Supabase rejects an upload to an existing path unless `upsert: true`.
   * Firebase always overwrites, so the shim emulates the check to preserve
   * the behaviour call sites were written against.
   */
  upload(
    path: string,
    body: Blob | File | ArrayBuffer | Uint8Array | string,
    options?: UploadOptions,
  ): Promise<StorageResult<{ path: string } | null>>;

  download(path: string): Promise<StorageResult<Blob | null>>;

  /**
   * IMPORTANT — the two implementations differ:
   *
   * - Server (admin SDK): a real signed URL that expires after `expiresIn`.
   * - Client (web SDK): `getDownloadURL()`, which returns a **non-expiring**
   *   token URL. The web SDK cannot mint time-limited URLs; that is an
   *   admin-credential operation.
   *
   * So `expiresIn` is honoured on the server and ignored on the client. Client
   * URLs stay valid until the object is deleted or its token is revoked. Do not
   * hand a client-minted URL to an untrusted party expecting it to lapse.
   */
  createSignedUrl(
    path: string,
    expiresIn: number,
  ): Promise<StorageResult<SignedUrl | null>>;

  createSignedUrls(
    paths: string[],
    expiresIn: number,
  ): Promise<StorageResult<SignedUrl[] | null>>;

  remove(paths: string[]): Promise<StorageResult<null>>;

  /** Lists immediate entries under a prefix. Names are basenames, as Supabase returns. */
  list(
    prefix?: string,
    options?: ListOptions,
  ): Promise<StorageResult<StorageEntry[] | null>>;

  /** Whether an object exists. Supabase returns this as `{ data: boolean }`. */
  exists(path: string): Promise<StorageResult<boolean>>;
}

export interface StorageApi {
  from(bucket: string): StorageBucket;
}

export const okStorage = <T>(data: T): StorageResult<T> => ({
  data,
  error: null,
});

// `empty` is accepted but ignored: on the error branch of the union `data` is
// always null, which is what makes narrowing work. The parameter is kept so the
// ~40 existing call sites in the two shims need no edit.
export const failStorage = <T>(
  error: unknown,
  _empty?: T,
): StorageResult<T> => ({
  data: null,
  error: error instanceof Error ? error : new Error(String(error)),
});

/**
 * Supabase buckets are separate namespaces; Firebase has one bucket with a
 * folder convention. Prefixing keeps the four logical buckets isolated and
 * keeps the existing `<uid>/<conversationId>/...` paths intact underneath,
 * which matters because Security Rules key on that uid segment.
 */
export function bucketPath(bucket: string, path: string): string {
  const clean = path.replace(/^\/+/, '');
  return `${bucket}/${clean}`;
}
