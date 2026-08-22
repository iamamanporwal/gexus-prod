// A postgrest-compatible query builder over Firestore.
//
// The point of this file is that the existing ~63 database call sites keep
// working unchanged. They all speak a narrow dialect — measured, not guessed:
//
//   .select() .insert() .update() .upsert() .delete()
//   .eq() .in() .order() .limit() .single() .maybeSingle() .overrideTypes()
//
// so the builder implements exactly that and nothing else. Anything outside the
// dialect is absent rather than approximated: a shim that silently returns the
// wrong rows is far worse than one that fails to compile.
//
// The client (firebase/firestore) and the server (firebase-admin) ship different
// SDKs, so the builder is written against the small FirestoreAdapter interface
// below and each environment supplies its own implementation.

import type { Database } from '../database.ts';

export type Row = Record<string, unknown>;

/** Unwraps `R[]` to `R`, leaving non-array types alone. */
type ElementOf<T> = T extends (infer E)[] ? E : T;

/**
 * postgrest's `overrideTypes` default: the override's fields win, everything
 * else on the base row survives. Applied element-wise for array results.
 */
type MergeOne<Base, Override> = Omit<Base, keyof Override> & Override;

type MergeOverride<Base, Override> = Base extends (infer BE)[]
  ? Override extends (infer OE)[]
    ? Array<MergeOne<BE, OE>>
    : Array<MergeOne<BE, Override>>
  : MergeOne<Base, Override>;

export type Filter =
  | { kind: 'eq'; column: string; value: unknown }
  | { kind: 'in'; column: string; values: unknown[] };

export type Order = { column: string; ascending: boolean };

export type QuerySpec = {
  table: string;
  filters: Filter[];
  orders: Order[];
  limit: number | null;
};

export interface FirestoreAdapter {
  /** Reads matching documents. Must inject the document id as `id`. */
  read(spec: QuerySpec): Promise<Row[]>;
  /** Creates or overwrites one document. `merge` gives upsert semantics. */
  write(
    table: string,
    id: string,
    data: Row,
    options: { merge: boolean },
  ): Promise<void>;
  /** Deletes one document by id. */
  remove(table: string, id: string): Promise<void>;
  /** Generates an id for a row inserted without one. */
  newId(table: string): string;
}

// Mirrors postgrest-js: callers destructure `{ data, error }` and never catch.
export type Result<T> = { data: T; error: Error | null };

const ok = <T>(data: T): Result<T> => ({ data, error: null });
const fail = <T>(error: Error, empty: T): Result<T> => ({ data: empty, error });

/**
 * Behaviour that cannot live in a generic builder, because it is per-table:
 * cascade deletes (Firestore has none) and oversized-document handling
 * (Firestore caps a document at 1 MB). Wired up in firestoreClient.ts.
 */
export type TableHooks = {
  /**
   * Runs before a row is written. Returns the row to actually persist.
   * `isInsert` distinguishes a create from an update, because column defaults
   * apply only on create.
   */
  beforeWrite?: (
    table: string,
    row: Row,
    context?: { isInsert: boolean },
  ) => Promise<Row>;
  /** Runs after a row is read. Returns the row to hand back to the caller. */
  afterRead?: (table: string, row: Row) => Promise<Row>;
  /** Runs before a row is deleted, for dependent-row cleanup. */
  beforeDelete?: (table: string, row: Row) => Promise<void>;
  /** Runs after a row is created, standing in for AFTER INSERT triggers. */
  afterInsert?: (table: string, row: Row) => Promise<void>;
};

class QueryBuilder<T = Row> implements PromiseLike<Result<T>> {
  private spec: QuerySpec;
  private mode: 'select' | 'insert' | 'update' | 'upsert' | 'delete' = 'select';
  private payload: Row[] = [];
  private returnsRows = false;
  private cardinality: 'many' | 'one' | 'maybeOne' = 'many';
  private ignoreDuplicates = false;

  // Declared explicitly rather than as constructor parameter properties: the
  // test runner uses Node's strip-only TypeScript mode, which rejects those.
  private adapter: FirestoreAdapter;
  private hooks: TableHooks;

  constructor(adapter: FirestoreAdapter, hooks: TableHooks, table: string) {
    this.adapter = adapter;
    this.hooks = hooks;
    this.spec = { table, filters: [], orders: [], limit: null };
  }

  // Firestore has no server-side column projection. Returning the whole
  // document is a superset of what was asked for, which every call site
  // tolerates (they destructure named fields). Not narrowing also avoids a
  // class of bug where a field the shim dropped was needed downstream.
  select(_columns?: string): QueryBuilder<T> {
    this.returnsRows = true;
    return this;
  }

  eq(column: string, value: unknown): this {
    this.spec.filters.push({ kind: 'eq', column, value });
    return this;
  }

  in(column: string, values: unknown[]): this {
    this.spec.filters.push({ kind: 'in', column, values });
    return this;
  }

  order(column: string, options?: { ascending?: boolean }): this {
    this.spec.orders.push({ column, ascending: options?.ascending ?? true });
    return this;
  }

  limit(count: number): this {
    this.spec.limit = count;
    return this;
  }

  // Both narrow the result from a list to one row, mirroring postgrest. The
  // conditional unwraps the element type so `.from('meshes').select().single()`
  // yields a typed mesh row rather than an array of them.
  single(): QueryBuilder<ElementOf<T>> {
    this.cardinality = 'one';
    return this as unknown as QueryBuilder<ElementOf<T>>;
  }

  maybeSingle(): QueryBuilder<ElementOf<T> | null> {
    this.cardinality = 'maybeOne';
    return this as unknown as QueryBuilder<ElementOf<T> | null>;
  }

  // Type-level only — no runtime effect, exactly like postgrest-js.
  //
  // The important detail is that postgrest *merges* the override into the base
  // row type by default rather than replacing it. Replacing looks like it works
  // and then every field the override didn't mention becomes a type error at
  // the call site, which is how this was wrong the first time.
  overrideTypes<
    NewResult,
    Options extends { merge?: boolean } = { merge: true },
  >(): QueryBuilder<
    Options extends { merge: false } ? NewResult : MergeOverride<T, NewResult>
  > {
    return this as unknown as QueryBuilder<
      Options extends { merge: false } ? NewResult : MergeOverride<T, NewResult>
    >;
  }

  insert(rows: Row | Row[]): this {
    this.mode = 'insert';
    this.payload = Array.isArray(rows) ? rows : [rows];
    return this;
  }

  update(patch: Row): this {
    this.mode = 'update';
    this.payload = [patch];
    return this;
  }

  // `onConflict` is implicit here: Firestore documents are keyed by id, so
  // set-with-merge already resolves on the primary key. `ignoreDuplicates`
  // is honoured — it means "leave the existing document alone".
  upsert(
    rows: Row | Row[],
    options?: { onConflict?: string; ignoreDuplicates?: boolean },
  ): this {
    this.mode = 'upsert';
    this.payload = Array.isArray(rows) ? rows : [rows];
    this.ignoreDuplicates = options?.ignoreDuplicates ?? false;
    return this;
  }

  delete(): this {
    this.mode = 'delete';
    return this;
  }

  // Thenable rather than a promise, so a chain can be awaited at any point —
  // exactly how postgrest-js behaves.
  then<TResult1 = Result<T>, TResult2 = never>(
    onfulfilled?:
      | ((value: Result<T>) => TResult1 | PromiseLike<TResult1>)
      | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    return this.execute().then(onfulfilled, onrejected);
  }

  private async execute(): Promise<Result<T>> {
    try {
      switch (this.mode) {
        case 'select':
          return await this.runSelect();
        case 'insert':
        case 'upsert':
          return await this.runWrite(this.mode === 'upsert');
        case 'update':
          return await this.runUpdate();
        case 'delete':
          return await this.runDelete();
      }
    } catch (error) {
      return fail(
        error instanceof Error ? error : new Error(String(error)),
        this.emptyValue(),
      );
    }
  }

  private emptyValue(): T {
    return (this.cardinality === 'many' ? [] : null) as T;
  }

  private async hydrate(rows: Row[]): Promise<Row[]> {
    const hook = this.hooks.afterRead;
    if (!hook) return rows;
    return Promise.all(rows.map((row) => hook(this.spec.table, row)));
  }

  private shape(rows: Row[]): Result<T> {
    if (this.cardinality === 'many') return ok(rows as T);
    if (rows.length === 1) return ok(rows[0] as T);

    if (rows.length === 0) {
      // .single() treats "no rows" as an error, matching postgrest's PGRST116;
      // .maybeSingle() returns null without one.
      return this.cardinality === 'one'
        ? fail(new Error('No rows found'), null as T)
        : ok(null as T);
    }

    return fail(
      new Error(`Expected at most one row, got ${rows.length}`),
      null as T,
    );
  }

  private async runSelect(): Promise<Result<T>> {
    return this.shape(await this.hydrate(await this.adapter.read(this.spec)));
  }

  private async runWrite(merge: boolean): Promise<Result<T>> {
    const written: Row[] = [];

    for (const row of this.payload) {
      // Postgres rows carry their own `id`; reuse it as the document id so a
      // read by id stays a direct document lookup rather than a query.
      const id =
        typeof row.id === 'string' && row.id
          ? row.id
          : this.adapter.newId(this.spec.table);

      const stamped: Row = { ...row, id };

      // `ignoreDuplicates: true` means an existing document wins outright.
      // Used by aiMessages.ts to record input rows idempotently, where
      // overwriting would clobber a status the server has since advanced.
      if (this.ignoreDuplicates) {
        const [existing] = await this.adapter.read({
          table: this.spec.table,
          filters: [{ kind: 'eq', column: 'id', value: id }],
          orders: [],
          limit: 1,
        });
        if (existing) {
          written.push(existing);
          continue;
        }
      }

      const prepared = this.hooks.beforeWrite
        ? await this.hooks.beforeWrite(this.spec.table, stamped, {
            isInsert: true,
          })
        : stamped;

      await this.adapter.write(this.spec.table, id, prepared, { merge });

      // Stands in for AFTER INSERT triggers — notably update_leaf_trigger on
      // messages, without which the chat handler has no branch to generate
      // from. Must run after the row exists, and must see the defaulted row
      // (the trigger copies fields the defaults may have supplied).
      await this.hooks.afterInsert?.(this.spec.table, prepared);

      // Callers get the row as persisted, defaults included — otherwise an
      // insert().select().single() would return a row missing created_at while
      // the stored one has it.
      written.push(prepared);
    }

    if (!this.returnsRows) return ok(null as T);
    return this.shape(await this.hydrate(written));
  }

  private async runUpdate(): Promise<Result<T>> {
    const targets = await this.adapter.read({ ...this.spec, limit: null });
    if (targets.length === 0) {
      return this.returnsRows ? this.shape([]) : ok(null as T);
    }

    const patch = this.payload[0] ?? {};
    const updated: Row[] = [];

    for (const target of targets) {
      const id = target.id as string;
      const merged: Row = { ...target, ...patch, id };
      const prepared = this.hooks.beforeWrite
        ? await this.hooks.beforeWrite(this.spec.table, merged, {
            isInsert: false,
          })
        : merged;

      await this.adapter.write(this.spec.table, id, prepared, { merge: true });
      updated.push(prepared);
    }

    if (!this.returnsRows) return ok(null as T);
    return this.shape(await this.hydrate(updated));
  }

  private async runDelete(): Promise<Result<T>> {
    const targets = await this.adapter.read({ ...this.spec, limit: null });

    for (const target of targets) {
      // Firestore has no ON DELETE CASCADE, and subcollections are not removed
      // with their parent either. Dependent rows are deleted explicitly here or
      // orphaned forever — billable, and invisible to every query.
      if (this.hooks.beforeDelete) {
        await this.hooks.beforeDelete(this.spec.table, target);
      }
      await this.adapter.remove(this.spec.table, target.id as string);
    }

    if (!this.returnsRows) return ok(null as T);
    return this.shape(targets);
  }
}

// ── Typed entry point ──────────────────────────────────────────────────────
//
// The generated Database types in shared/database.ts describe the schema and
// stay valid: the collections carry the same fields the Postgres tables did.
// Threading them through here is what keeps call sites typed after the move off
// supabase-js — without it every row degrades to `Record<string, unknown>` and
// ~25 call sites start handling `unknown`.
//
// The types are no longer *generated* from a live schema, so they can drift as
// the app changes. That is a real cost of leaving Postgres, but a stale type is
// far better than no type.

type PublicTables = Database['public']['Tables'];
export type TableName = keyof PublicTables & string;
export type RowOf<T extends TableName> = PublicTables[T]['Row'];

export function createQueryApi(adapter: FirestoreAdapter, hooks: TableHooks) {
  return {
    from<T extends TableName>(table: T) {
      // Rows are read back from Firestore as plain objects; the cast asserts
      // the schema the collection is written with. Writes go through the same
      // typed surface, so the assertion holds as long as the Database types
      // match the collections — the same assumption supabase-js made.
      return new QueryBuilder<RowOf<T>[]>(
        adapter,
        hooks,
        table,
      ) as QueryBuilder<RowOf<T>[]>;
    },
  };
}

export type QueryApi = ReturnType<typeof createQueryApi>;
export { QueryBuilder };
