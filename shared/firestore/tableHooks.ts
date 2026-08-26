// The two Firestore-specific behaviours the generic query builder cannot own.
//
// Both exist because Postgres was doing this work invisibly and Firestore does
// not do it at all. Neither is optional: without them the app loses data in ways
// that no query reveals.

import type { FirestoreAdapter, Row, TableHooks } from './queryBuilder.ts';

// Firestore's hard per-document ceiling. Exceeding it fails the write outright.
const FIRESTORE_DOC_LIMIT_BYTES = 1_048_576;

// Spill well before the ceiling. The estimate below counts the JSON payload but
// not Firestore's own field-name and index overhead, so the headroom absorbs
// both that and a final part arriving after the last check.
const OVERFLOW_THRESHOLD_BYTES = 700_000;

// Marker left in place of an offloaded field. `afterRead` swaps it back for the
// real value, so call sites never learn this happened.
type OverflowPointer = {
  __overflow: true;
  path: string;
  bytes: number;
};

function isOverflowPointer(value: unknown): value is OverflowPointer {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as { __overflow?: unknown }).__overflow === true &&
    typeof (value as { path?: unknown }).path === 'string'
  );
}

export function approximateJsonBytes(value: unknown): number {
  try {
    // Byte length, not string length: OpenSCAD output and model reasoning are
    // full of multi-byte characters and `.length` would undercount them.
    return new TextEncoder().encode(JSON.stringify(value) ?? '').length;
  } catch {
    return 0;
  }
}

/**
 * Fields large enough to threaten the document limit, by table.
 *
 * `messages.parts` is the real hazard. It accumulates every step of an agentic
 * turn — reasoning, tool calls, and full OpenSCAD source — and aiChat.ts caps a
 * parametric turn at 60 steps with PARAMETRIC_MAX_OUTPUT_TOKENS = 64000. That
 * can exceed 1 MB in a single row. Postgres jsonb absorbs it (limit ~1 GB);
 * Firestore rejects the write and the message is lost.
 */
const OVERFLOW_CANDIDATES: Record<string, string[]> = {
  messages: ['parts', 'content', 'metadata'],
  conversations: ['settings'],
  meshes: ['prompt'],
  images: ['prompt'],
};

/**
 * Rows that must be deleted alongside a parent, replacing the 5 ON DELETE
 * CASCADE foreign keys the Postgres schema declared.
 *
 * Order matters: `previews` references `meshes`, so previews go first.
 */
const CASCADES: Record<string, { table: string; column: string }[]> = {
  conversations: [
    { table: 'previews', column: 'conversation_id' },
    { table: 'messages', column: 'conversation_id' },
    { table: 'images', column: 'conversation_id' },
    { table: 'meshes', column: 'conversation_id' },
  ],
  meshes: [{ table: 'previews', column: 'mesh_id' }],
};

export interface OverflowStore {
  /**
   * Persists an offloaded field and returns the path it actually used.
   *
   * The store owns its own pathing rather than accepting one, because Storage
   * Security Rules authorize by path: a client-written blob must sit under the
   * writer's uid or no rule can permit it. `suggestedPath` is a uniqueness hint
   * the implementation is free to prefix.
   */
  put(suggestedPath: string, json: string): Promise<string>;
  /** Retrieves a previously offloaded field by the path `put` returned. */
  get(path: string): Promise<string>;
  /** Removes an offloaded field. Best-effort; must not throw. */
  delete(path: string): Promise<void>;
}

/**
 * Column defaults, which Firestore does not have.
 *
 * This is not cosmetic. Firestore's `orderBy` **silently excludes documents
 * that lack the ordered field** — so a message written without `created_at`
 * would be stored successfully and then be invisible to the query that lists a
 * conversation's messages. Present but unreachable is the worst failure mode
 * available, and no error is raised anywhere.
 *
 * Mirrors the DEFAULT clauses in supabase/schemas/*.sql.
 */
const DEFAULTS: Record<string, () => Row> = {
  conversations: () => ({
    created_at: nowIso(),
    updated_at: nowIso(),
    privacy: 'private',
    settings: {},
  }),
  messages: () => ({
    created_at: nowIso(),
    rating: 0,
    parts: [],
    metadata: {},
  }),
  // A missing `status` is not a harmless omission. Three separate consumers
  // branch on it, and every one of them reads ABSENT as FINISHED:
  //
  //   - falWebhook.ts refuses to process a row whose status is not 'pending'
  //     ("Mesh already uploaded"), so a mesh created without one throws away
  //     its own completion callback and never finishes.
  //   - useMeshData / useImageData poll only while pending, so the UI never
  //     refreshes into the finished model.
  //   - useGlbPreview filters previews on `status == 'success'`.
  //
  // These are the DEFAULT 'pending' clauses from
  // supabase/schemas/{meshes,images,previews}.sql. Losing them in the
  // migration is what left every generation stuck on the spinner.
  images: () => ({ created_at: nowIso(), status: 'pending', prompt: {} }),
  meshes: () => ({
    created_at: nowIso(),
    status: 'pending',
    file_type: 'glb',
    prompt: {},
  }),
  previews: () => ({
    created_at: nowIso(),
    updated_at: nowIso(),
    status: 'pending',
  }),
  prompts: () => ({ created_at: nowIso(), type: 'chat' }),
  profiles: () => ({
    created_at: nowIso(),
    updated_at: nowIso(),
    notifications_enabled: false,
  }),
};

// Tables whose `updated_at` was maintained by a Postgres BEFORE UPDATE trigger
// (see supabase/schemas/triggers.sql).
const TOUCHES_UPDATED_AT = new Set(['conversations', 'previews']);

function nowIso() {
  return new Date().toISOString();
}

function applyDefaults(table: string, row: Row, isInsert: boolean): Row {
  const defaults = DEFAULTS[table]?.() ?? {};
  const out: Row = { ...row };

  if (isInsert) {
    for (const [key, value] of Object.entries(defaults)) {
      if (out[key] === undefined || out[key] === null) out[key] = value;
    }
  } else if (TOUCHES_UPDATED_AT.has(table)) {
    out.updated_at = nowIso();
  }

  return out;
}

export function createTableHooks(
  adapter: FirestoreAdapter,
  overflow: OverflowStore,
): TableHooks {
  return {
    // Replaces the `update_leaf_trigger` AFTER INSERT trigger on messages.
    //
    // Load-bearing, not incidental: the chat handler reads
    // `conversations.current_message_leaf_id` to find the branch to generate
    // from, and returns 400 "Conversation has no leaf to generate from" when it
    // is null. Without this, every generation fails on a fresh conversation.
    async afterInsert(table, row) {
      if (table !== 'messages') return;
      const conversationId = row.conversation_id;
      if (typeof conversationId !== 'string' || !conversationId) return;

      await adapter.write(
        'conversations',
        conversationId,
        { current_message_leaf_id: row.id, updated_at: nowIso() },
        { merge: true },
      );
    },

    async beforeWrite(table, row, context) {
      const withDefaults = applyDefaults(
        table,
        row,
        context?.isInsert ?? false,
      );

      const candidates = OVERFLOW_CANDIDATES[table];
      if (!candidates) return withDefaults;
      row = withDefaults;

      // Only pay the offload cost when the row is actually near the limit.
      if (approximateJsonBytes(row) < OVERFLOW_THRESHOLD_BYTES) return row;

      const result: Row = { ...row };

      // Largest field first: offloading one big field usually brings the row
      // under the threshold without touching the others.
      const bySize = candidates
        .filter((field) => result[field] !== undefined)
        .map((field) => ({
          field,
          bytes: approximateJsonBytes(result[field]),
        }))
        .sort((a, b) => b.bytes - a.bytes);

      for (const { field, bytes } of bySize) {
        if (approximateJsonBytes(result) < OVERFLOW_THRESHOLD_BYTES) break;
        if (isOverflowPointer(result[field])) continue;

        // The store returns the real path — it may have prefixed the caller's
        // uid to satisfy Storage rules — and that is what gets recorded, so
        // reads resolve to wherever the write actually landed.
        const path = await overflow.put(
          `${table}/${String(result.id)}/${field}.json`,
          JSON.stringify(result[field]),
        );
        result[field] = {
          __overflow: true,
          path,
          bytes,
        } satisfies OverflowPointer;
      }

      const finalBytes = approximateJsonBytes(result);
      if (finalBytes >= FIRESTORE_DOC_LIMIT_BYTES) {
        // Better a loud failure than a silent truncation: the caller sees an
        // error it can surface, instead of a row that looks saved but isn't.
        throw new Error(
          `Row for "${table}" is ${finalBytes} bytes after offloading every ` +
            `oversized field, which exceeds Firestore's 1 MB document limit. ` +
            `Add the offending field to OVERFLOW_CANDIDATES.`,
        );
      }

      return result;
    },

    async afterRead(_table, row) {
      // Cheap scan: most rows carry no pointers at all.
      const pointers = Object.entries(row).filter(([, value]) =>
        isOverflowPointer(value),
      );
      if (pointers.length === 0) return row;

      const restored: Row = { ...row };
      await Promise.all(
        pointers.map(async ([field, pointer]) => {
          const { path } = pointer as OverflowPointer;
          try {
            restored[field] = JSON.parse(await overflow.get(path));
          } catch (error) {
            // Losing the pointer target would corrupt the message silently.
            throw new Error(
              `Offloaded field "${field}" could not be read from ${path}: ` +
                `${error instanceof Error ? error.message : String(error)}`,
            );
          }
        }),
      );
      return restored;
    },

    async beforeDelete(table, row) {
      const dependents = CASCADES[table];
      if (!dependents) {
        await releaseOverflow(row, overflow);
        return;
      }

      const parentId = row.id as string;

      for (const { table: childTable, column } of dependents) {
        const children = await adapter.read({
          table: childTable,
          filters: [{ kind: 'eq', column, value: parentId }],
          orders: [],
          limit: null,
        });

        for (const child of children) {
          // Recurse so meshes -> previews still cascades when a conversation
          // is what was actually deleted.
          const childHooks = createTableHooks(adapter, overflow);
          await childHooks.beforeDelete?.(childTable, child);
          await adapter.remove(childTable, child.id as string);
        }
      }

      await releaseOverflow(row, overflow);
    },
  };
}

// Offloaded blobs outlive their row unless removed here — the same orphaning
// problem as the cascade, one layer down. Best-effort: a failure to clean up
// storage must not block the delete the user asked for.
async function releaseOverflow(row: Row, overflow: OverflowStore) {
  await Promise.all(
    Object.values(row)
      .filter(isOverflowPointer)
      .map((pointer) => overflow.delete(pointer.path).catch(() => undefined)),
  );
}

export const __testing = {
  FIRESTORE_DOC_LIMIT_BYTES,
  OVERFLOW_THRESHOLD_BYTES,
  OVERFLOW_CANDIDATES,
  CASCADES,
  isOverflowPointer,
};
