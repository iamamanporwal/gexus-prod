/**
 * Best available human-readable message for a thrown value.
 *
 * `error instanceof Error` on its own is not enough against supabase-js: it
 * rejects with plain objects (PostgrestError, StorageError, AuthError-shaped
 * records) that carry `message` — and often `details` / `hint` — without
 * extending Error. Those fell through to the caller's generic fallback, so a
 * failure as blunt as "the database is unreachable" surfaced to the user as
 * "Failed to process prompt" with nothing to act on.
 */
export function errorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === 'string' && error.trim()) return error;

  if (typeof error === 'object' && error !== null) {
    const record = error as Record<string, unknown>;
    // `details` and `hint` are where Postgres puts the actionable part
    // (missing relation, failed constraint, connection refused).
    const parts = [record.message, record.details, record.hint]
      .filter(
        (part): part is string => typeof part === 'string' && !!part.trim(),
      )
      // A PostgrestError often repeats itself across these fields.
      .filter((part, index, all) => all.indexOf(part) === index);

    if (parts.length) return parts.join(' — ');
  }

  return fallback;
}
