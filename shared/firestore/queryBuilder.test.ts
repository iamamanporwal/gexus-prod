import assert from 'node:assert/strict';
import { describe, it, beforeEach } from 'node:test';
import {
  createQueryApi,
  type FirestoreAdapter,
  type QuerySpec,
  type Row,
} from './queryBuilder.ts';
import {
  createTableHooks,
  approximateJsonBytes,
  type OverflowStore,
} from './tableHooks.ts';

// In-memory stand-in for Firestore. Exercises the builder and hooks without
// credentials, so the query semantics are verified before any network access.
function memoryAdapter() {
  const tables = new Map<string, Map<string, Row>>();
  let seq = 0;

  const table = (name: string) => {
    if (!tables.has(name)) tables.set(name, new Map());
    return tables.get(name)!;
  };

  const adapter: FirestoreAdapter = {
    async read(spec: QuerySpec) {
      let rows = [...table(spec.table).values()].map((r) => ({ ...r }));

      for (const filter of spec.filters) {
        rows =
          filter.kind === 'eq'
            ? rows.filter((r) => r[filter.column] === filter.value)
            : rows.filter((r) => filter.values.includes(r[filter.column]));
      }

      for (const order of [...spec.orders].reverse()) {
        rows.sort((a, b) => {
          const l = a[order.column] as never;
          const r = b[order.column] as never;
          const cmp = l < r ? -1 : l > r ? 1 : 0;
          return order.ascending ? cmp : -cmp;
        });
      }

      return spec.limit === null ? rows : rows.slice(0, spec.limit);
    },
    async write(name, id, data, { merge }) {
      const existing = merge ? table(name).get(id) : undefined;
      table(name).set(id, { ...existing, ...data });
    },
    async remove(name, id) {
      table(name).delete(id);
    },
    newId() {
      seq += 1;
      return `generated-${seq}`;
    },
  };

  return { adapter, tables };
}

function memoryOverflow() {
  const blobs = new Map<string, string>();
  const store: OverflowStore = {
    // Prefixes the suggested path, the way the real client store prefixes the
    // caller's uid — so the tests also cover the pointer recording whatever
    // path the store actually chose rather than the one it was handed.
    async put(suggestedPath, json) {
      const path = `overflow/test-uid/${suggestedPath}`;
      blobs.set(path, json);
      return path;
    },
    async get(path) {
      const found = blobs.get(path);
      if (found === undefined) throw new Error(`missing blob ${path}`);
      return found;
    },
    async delete(path) {
      blobs.delete(path);
    },
  };
  return { store, blobs };
}

function harness() {
  const { adapter, tables } = memoryAdapter();
  const { store, blobs } = memoryOverflow();
  const db = createQueryApi(adapter, createTableHooks(adapter, store));
  return { db, tables, blobs };
}

describe('query builder: postgrest compatibility', () => {
  let h: ReturnType<typeof harness>;
  beforeEach(() => {
    h = harness();
  });

  it('inserts and reads back with .select().single()', async () => {
    const { data, error } = await h.db
      .from('conversations')
      .insert([{ id: 'c1', user_id: 'u1', title: 'first' }])
      .select()
      .single();

    assert.equal(error, null);
    assert.equal((data as Row).title, 'first');
  });

  it('reuses the row id as the document id', async () => {
    await h.db.from('conversations').insert([{ id: 'c1', user_id: 'u1' }]);
    assert.ok(h.tables.get('conversations')!.has('c1'));
  });

  it('generates an id when the row omits one', async () => {
    const { data } = await h.db
      .from('messages')
      .insert([{ conversation_id: 'c1', role: 'user' }])
      .select()
      .single();

    assert.match((data as Row).id as string, /^generated-/);
  });

  it('chains multiple .eq() filters', async () => {
    await h.db.from('conversations').insert([
      { id: 'c1', user_id: 'u1', type: 'parametric' },
      { id: 'c2', user_id: 'u2', type: 'parametric' },
      { id: 'c3', user_id: 'u1', type: 'creative' },
    ]);

    const { data } = await h.db
      .from('conversations')
      .select('*')
      .eq('user_id', 'u1')
      .eq('type', 'parametric');

    assert.equal((data as Row[]).length, 1);
    assert.equal((data as Row[])[0].id, 'c1');
  });

  it('supports .in(), .order() and .limit()', async () => {
    await h.db.from('messages').insert([
      { id: 'm1', conversation_id: 'c1', created_at: 3 },
      { id: 'm2', conversation_id: 'c1', created_at: 1 },
      { id: 'm3', conversation_id: 'c2', created_at: 2 },
    ]);

    const { data } = await h.db
      .from('messages')
      .select('*')
      .in('conversation_id', ['c1', 'c2'])
      .order('created_at', { ascending: true })
      .limit(2);

    assert.deepEqual(
      (data as Row[]).map((r) => r.id),
      ['m2', 'm3'],
    );
  });

  it('.single() errors on no rows, .maybeSingle() returns null', async () => {
    const single = await h.db
      .from('conversations')
      .select('*')
      .eq('id', 'nope')
      .single();
    assert.ok(single.error, 'single() must error when nothing matches');
    assert.equal(single.data, null);

    const maybe = await h.db
      .from('conversations')
      .select('*')
      .eq('id', 'nope')
      .maybeSingle();
    assert.equal(maybe.error, null);
    assert.equal(maybe.data, null);
  });

  it('.single() errors when more than one row matches', async () => {
    await h.db.from('conversations').insert([
      { id: 'c1', user_id: 'u1' },
      { id: 'c2', user_id: 'u1' },
    ]);

    const { error } = await h.db
      .from('conversations')
      .select('*')
      .eq('user_id', 'u1')
      .single();

    assert.ok(error);
    assert.match(error!.message, /Expected at most one row/);
  });

  it('updates matching rows and can return them', async () => {
    await h.db.from('conversations').insert([{ id: 'c1', title: 'old' }]);

    const { data, error } = await h.db
      .from('conversations')
      .update({ title: 'new' })
      .eq('id', 'c1')
      .select()
      .single();

    assert.equal(error, null);
    assert.equal((data as Row).title, 'new');
    assert.equal(h.tables.get('conversations')!.get('c1')!.title, 'new');
  });

  it('update leaves unmatched rows alone', async () => {
    await h.db.from('conversations').insert([
      { id: 'c1', title: 'a' },
      { id: 'c2', title: 'b' },
    ]);

    await h.db.from('conversations').update({ title: 'z' }).eq('id', 'c1');

    assert.equal(h.tables.get('conversations')!.get('c2')!.title, 'b');
  });

  it('upsert merges into an existing row', async () => {
    await h.db
      .from('profiles')
      .insert([{ id: 'p1', full_name: 'A', extra: 1 }]);
    await h.db.from('profiles').upsert([{ id: 'p1', full_name: 'B' }]);

    const row = h.tables.get('profiles')!.get('p1')!;
    assert.equal(row.full_name, 'B');
    assert.equal(row.extra, 1, 'merge must preserve untouched fields');
  });

  it('returns rows as an array without .single()', async () => {
    await h.db.from('conversations').insert([{ id: 'c1' }, { id: 'c2' }]);
    const { data } = await h.db.from('conversations').select('*');
    assert.ok(Array.isArray(data));
    assert.equal((data as Row[]).length, 2);
  });

  it('never throws — errors arrive as { error }', async () => {
    // A read against an empty collection is empty, not an exception. (An
    // unknown *table name* is now a compile error, since `from` is typed
    // against the Database schema — which is the point of typing it.)
    const { data, error } = await h.db.from('prompts').select('*');
    assert.equal(error, null);
    assert.deepEqual(data, []);
  });
});

describe('column defaults (Firestore has none)', () => {
  it('stamps created_at on insert', async () => {
    // Firestore's orderBy EXCLUDES documents missing the ordered field, so a
    // message without created_at is stored and then invisible to the query
    // that lists a conversation. Silent data loss, no error anywhere.
    const h = harness();

    await h.db
      .from('messages')
      .insert([{ id: 'm1', conversation_id: 'c1', role: 'user' }]);

    const stored = h.tables.get('messages')!.get('m1')!;
    assert.ok(stored.created_at, 'created_at must be defaulted');
    assert.equal(stored.rating, 0, 'rating default from the schema');
  });

  it('returns the defaulted row from insert().select()', async () => {
    const h = harness();
    const { data } = await h.db
      .from('conversations')
      .insert([{ id: 'c1', user_id: 'u1' }])
      .select()
      .single();

    assert.ok((data as Row).created_at);
    assert.equal((data as Row).privacy, 'private');
  });

  it('does not overwrite an explicitly provided value', async () => {
    const h = harness();
    await h.db
      .from('conversations')
      .insert([{ id: 'c1', user_id: 'u1', privacy: 'public' }]);

    assert.equal(h.tables.get('conversations')!.get('c1')!.privacy, 'public');
  });

  it('refreshes updated_at on update, not created_at', async () => {
    const h = harness();
    await h.db.from('conversations').insert([{ id: 'c1', user_id: 'u1' }]);
    const created = h.tables.get('conversations')!.get('c1')!.created_at;

    await h.db.from('conversations').update({ title: 'x' }).eq('id', 'c1');

    const after = h.tables.get('conversations')!.get('c1')!;
    assert.equal(after.created_at, created, 'created_at must be immutable');
    assert.ok(after.updated_at, 'updated_at must be maintained');
  });
});

describe('update_leaf_trigger (replacing an AFTER INSERT trigger)', () => {
  it('advances the conversation leaf when a message is inserted', async () => {
    // The chat handler reads current_message_leaf_id to find the branch to
    // generate from, and 400s with "Conversation has no leaf to generate from"
    // when it is null. Without this, every generation fails.
    const h = harness();

    await h.db.from('conversations').insert([{ id: 'c1', user_id: 'u1' }]);
    await h.db
      .from('messages')
      .insert([{ id: 'm1', conversation_id: 'c1', role: 'user' }]);

    assert.equal(
      h.tables.get('conversations')!.get('c1')!.current_message_leaf_id,
      'm1',
    );
  });

  it('moves the leaf to the newest message', async () => {
    const h = harness();
    await h.db.from('conversations').insert([{ id: 'c1', user_id: 'u1' }]);
    await h.db
      .from('messages')
      .insert([{ id: 'm1', conversation_id: 'c1', role: 'user' }]);
    await h.db
      .from('messages')
      .insert([{ id: 'm2', conversation_id: 'c1', role: 'assistant' }]);

    assert.equal(
      h.tables.get('conversations')!.get('c1')!.current_message_leaf_id,
      'm2',
    );
  });

  it('does not fire for other tables', async () => {
    const h = harness();
    await h.db.from('conversations').insert([{ id: 'c1', user_id: 'u1' }]);
    await h.db
      .from('images')
      .insert([{ id: 'i1', conversation_id: 'c1', user_id: 'u1' }]);

    assert.equal(
      h.tables.get('conversations')!.get('c1')!.current_message_leaf_id,
      undefined,
    );
  });
});

describe('cascade deletes (replacing ON DELETE CASCADE)', () => {
  it('deletes messages, images, meshes and previews with a conversation', async () => {
    const h = harness();

    await h.db.from('conversations').insert([{ id: 'c1', user_id: 'u1' }]);
    await h.db.from('messages').insert([{ id: 'm1', conversation_id: 'c1' }]);
    await h.db.from('images').insert([{ id: 'i1', conversation_id: 'c1' }]);
    await h.db.from('meshes').insert([{ id: 'x1', conversation_id: 'c1' }]);
    await h.db
      .from('previews')
      .insert([{ id: 'p1', conversation_id: 'c1', mesh_id: 'x1' }]);

    await h.db.from('conversations').delete().eq('id', 'c1');

    for (const table of [
      'conversations',
      'messages',
      'images',
      'meshes',
      'previews',
    ]) {
      assert.equal(
        h.tables.get(table)?.size ?? 0,
        0,
        `${table} should have no orphans left`,
      );
    }
  });

  it('leaves other conversations untouched', async () => {
    const h = harness();

    await h.db.from('conversations').insert([{ id: 'c1' }, { id: 'c2' }]);
    await h.db.from('messages').insert([
      { id: 'm1', conversation_id: 'c1' },
      { id: 'm2', conversation_id: 'c2' },
    ]);

    await h.db.from('conversations').delete().eq('id', 'c1');

    assert.equal(h.tables.get('messages')!.size, 1);
    assert.ok(h.tables.get('messages')!.has('m2'));
  });

  it('cascades meshes -> previews on a direct mesh delete', async () => {
    const h = harness();

    await h.db.from('meshes').insert([{ id: 'x1', conversation_id: 'c1' }]);
    await h.db.from('previews').insert([{ id: 'p1', mesh_id: 'x1' }]);

    await h.db.from('meshes').delete().eq('id', 'x1');

    assert.equal(h.tables.get('previews')!.size, 0);
  });
});

describe("1MB document limit (Firestore's hard cap)", () => {
  // Roughly the shape of a real parametric turn: 60 steps of reasoning plus
  // tool calls, which is what overflows the limit in production.
  const hugeParts = () =>
    Array.from({ length: 60 }, (_, step) => ({
      type: 'reasoning',
      text: `step ${step} `.repeat(3000),
    }));

  it('leaves small rows completely alone', async () => {
    const h = harness();
    await h.db
      .from('messages')
      .insert([{ id: 'm1', parts: [{ type: 'text', text: 'hi' }] }]);

    const stored = h.tables.get('messages')!.get('m1')!;
    assert.ok(Array.isArray(stored.parts), 'must stay inline');
    assert.equal(h.blobs.size, 0, 'must not touch the overflow store');
  });

  it('offloads an oversized field instead of failing the write', async () => {
    const h = harness();
    const parts = hugeParts();
    assert.ok(
      approximateJsonBytes(parts) > 1_048_576,
      'fixture must actually exceed 1MB or this test proves nothing',
    );

    const { error } = await h.db
      .from('messages')
      .insert([{ id: 'm1', conversation_id: 'c1', parts }]);

    assert.equal(error, null, 'the write must succeed');
    assert.equal(h.blobs.size, 1, 'the big field should be in the store');

    const stored = h.tables.get('messages')!.get('m1')!;
    assert.ok(
      approximateJsonBytes(stored) < 1_048_576,
      'the stored document must fit under the limit',
    );
  });

  it('restores an offloaded field transparently on read', async () => {
    const h = harness();
    const parts = hugeParts();

    await h.db
      .from('messages')
      .insert([{ id: 'm1', conversation_id: 'c1', parts }]);

    const { data, error } = await h.db
      .from('messages')
      .select('*')
      .eq('id', 'm1')
      .single();

    assert.equal(error, null);
    // The caller must not be able to tell any of this happened.
    assert.deepEqual((data as Row).parts, parts);
  });

  it('cleans up offloaded blobs when the row is deleted', async () => {
    const h = harness();

    await h.db
      .from('messages')
      .insert([{ id: 'm1', conversation_id: 'c1', parts: hugeParts() }]);
    assert.equal(h.blobs.size, 1);

    await h.db.from('messages').delete().eq('id', 'm1');
    assert.equal(h.blobs.size, 0, 'offloaded blobs must not outlive the row');
  });

  it('cleans up offloaded blobs through a cascade', async () => {
    const h = harness();

    await h.db.from('conversations').insert([{ id: 'c1' }]);
    await h.db
      .from('messages')
      .insert([{ id: 'm1', conversation_id: 'c1', parts: hugeParts() }]);

    await h.db.from('conversations').delete().eq('id', 'c1');
    assert.equal(h.blobs.size, 0);
  });

  it('records the path the store chose, not the one it was offered', async () => {
    // Regression guard: the client store prefixes the caller's uid so Storage
    // rules can authorize the write. If the pointer recorded the unprefixed
    // suggestion instead, every read of an offloaded field would 404.
    const h = harness();

    await h.db
      .from('messages')
      .insert([{ id: 'm1', conversation_id: 'c1', parts: hugeParts() }]);

    const storedPath = [...h.blobs.keys()][0];
    assert.match(storedPath, /^overflow\/test-uid\//);

    const { data, error } = await h.db
      .from('messages')
      .select('*')
      .eq('id', 'm1')
      .single();
    assert.equal(error, null, 'read must resolve the prefixed path');
    assert.ok(Array.isArray((data as Row).parts));
  });

  it('surfaces a lost blob as an error rather than silent corruption', async () => {
    const h = harness();

    await h.db
      .from('messages')
      .insert([{ id: 'm1', conversation_id: 'c1', parts: hugeParts() }]);
    h.blobs.clear();

    const { error } = await h.db
      .from('messages')
      .select('*')
      .eq('id', 'm1')
      .single();

    assert.ok(error, 'a missing blob must not read back as a partial message');
  });
});
