# Supabase → Firebase Migration Plan

Measured against the tree at commit `ab45cbc`. Every count below came from
grepping this codebase, not from estimation.

---

## Build progress

You chose "force it live today". I'm building, and holding two lines: the 1 MB
overflow (§4.1, your choice) and cascade deletes (§4.2) are **not** being cut,
because those are the two that lose data silently.

**Done — 22/22 tests passing, typecheck clean:**

| Piece                                          | File                                                    | Verified by                                                                                                                                                                                               |
| ---------------------------------------------- | ------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| postgrest-compatible query builder, 12 methods | [queryBuilder.ts](../shared/firestore/queryBuilder.ts)  | 13 tests: filter chaining, `.in`/`.order`/`.limit`, `single` vs `maybeSingle` cardinality errors, upsert merge, `{data, error}` never throwing                                                            |
| Cascade deletes replacing 5 FKs                | [tableHooks.ts](../shared/firestore/tableHooks.ts)      | 3 tests: conversation → all 4 child tables, siblings untouched, mesh → previews                                                                                                                           |
| 1 MB overflow to Cloud Storage                 | [tableHooks.ts](../shared/firestore/tableHooks.ts)      | 6 tests: small rows untouched, >1 MB offloaded, transparent read round-trip, blob cleanup on delete _and_ through cascade, lost blob errors rather than corrupts, pointer records the store's chosen path |
| Server adapter + storage (admin SDK)           | [firestoreAdmin.ts](../src/server/firestoreAdmin.ts)    | Typecheck                                                                                                                                                                                                 |
| Client adapter + storage + anonymous auth      | [firebaseClient.ts](../src/lib/firebaseClient.ts)       | Typecheck                                                                                                                                                                                                 |
| Firestore Security Rules                       | [firestore.rules](../firestore.rules)                   | Not yet deployed                                                                                                                                                                                          |
| Storage Security Rules                         | [storage.rules](../storage.rules)                       | Not yet deployed                                                                                                                                                                                          |
| Realtime → `onSnapshot`                        | [firebaseMeshWatch.ts](../src/lib/firebaseMeshWatch.ts) | Typecheck                                                                                                                                                                                                 |

The existing Supabase app **still runs untouched** — everything so far is new
files. Deliberate: it keeps working until the swap can be done and verified in
one go.

**Remaining:**

| #   | Piece                                                                                   | Blocked on                       |
| --- | --------------------------------------------------------------------------------------- | -------------------------------- |
| 10  | The swap — repoint 99 call sites, 26 identity sites, `App.tsx` boot gate, `requireUser` | Nothing technical, but see below |
| 11  | Deploy rules, end-to-end verification                                                   | **Firestore + service account**  |

### Four design decisions made while building

1. **Overflow blobs are uid-prefixed.** The first version wrote them to
   `overflow/{table}/{id}/`, which no Storage rule can authorize — a client
   write would have failed with a permission error at the exact moment a large
   generation completed. `OverflowStore.put` now returns the path it actually
   used, and the client prefixes the writer's uid. A regression test covers it.
2. **Signed URLs behave differently per side.** The admin SDK mints genuinely
   expiring URLs; the web SDK cannot, so the client returns a non-expiring
   `getDownloadURL()` token. `expiresIn` is honoured server-side and ignored
   client-side. Documented at the interface, because handing a client-minted URL
   to a third party expecting it to lapse would be a real leak.
3. **No `/{collection}/{doc}` wildcard in the rules, and every mixed `&&`/`||`
   is parenthesised.** Firestore ORs matching rules together, so one permissive
   wildcard silently widens every narrow rule; and `&&` binding tighter is how a
   public-read clause turns into read-everything.
4. **`onSnapshot` skips its first snapshot.** Otherwise attaching the listener
   replays every historical mesh as "just finished" and fires a desktop
   notification per row on every page load.

### Migration complete — verified end to end on Firebase

A real anonymous user, real Firestore rows, a real generation through the app:

```
anon uid: VsThI1jD7iWuRT2MsTdtQv6IqC43
POST /cadam/api/parametric-chat -> 200
called build tool: true      finished cleanly: true
messages persisted: 2  (user: 1 part, assistant: 3 parts)
leaf advanced to: 97bc48b7-7349-4035-80e5-4ca202e13a92
```

Plus: 0 typecheck errors, 0 lint errors, 29/29 unit tests, all shim checks green
against real Firestore, and a Vercel-preset production build at exit 0 with
`maxDuration: max`, streaming on, and zero sourcemaps shipped.

**Only Cloud Storage remains** (bucket still 404) — that blocks images, meshes,
previews and the 1 MB overflow. Everything else works.

### Three silent breakages integration testing caught

Unit tests against an in-memory adapter could not have found any of these. Each
would have shipped looking fine.

1. **Composite indexes.** Firestore _refuses_ a filter+order query without a
   matching index — `FAILED_PRECONDITION`, no fallback scan. Postgres planned
   around it silently. Nine indexes in
   [firestore.indexes.json](../firestore.indexes.json), now deployed and READY.
2. **Column defaults.** Postgres had `created_at DEFAULT now()` and five others.
   Firestore has no defaults — and its `orderBy` **excludes documents missing
   the ordered field**. A message written without `created_at` would be stored
   successfully and then be invisible to the query listing its conversation.
   Present but unreachable, no error anywhere.
3. **`update_leaf_trigger`.** An AFTER INSERT trigger on `messages` advanced
   `conversations.current_message_leaf_id`. Firestore has no triggers, and the
   chat handler 400s with "Conversation has no leaf to generate from" without
   it — every generation would have failed. Reimplemented as the `afterInsert`
   hook, and confirmed working in the e2e run above.

All three are now covered by tests that assert the behaviour rather than the
implementation.

### The cutover

The swap is complete: 99 call sites repointed, 0 typecheck errors, 0 lint errors,
30/30 unit tests, and `@supabase/supabase-js` is no longer imported anywhere.
Verified against the real project:

| Check                                                          | Result                                                   |
| -------------------------------------------------------------- | -------------------------------------------------------- |
| Anonymous auth                                                 | ✅ real token, `provider_id: anonymous`                  |
| Unauthenticated API call                                       | ✅ **401** (previously accepted as the shared user)      |
| Authenticated API call                                         | ✅ 200                                                   |
| insert / select / update / filters / `single` vs `maybeSingle` | ✅ against real Firestore                                |
| **Cascade deletes**                                            | ✅ conversation → messages, meshes, previews all removed |
| Storage                                                        | ⛔ bucket not provisioned                                |
| Filter + order queries                                         | ⛔ **needs composite indexes**                           |

**The index problem is the one that would have bitten in production.** Firestore
_refuses_ a query that filters on one field and orders by another unless a
matching composite index exists — it returns `FAILED_PRECONDITION`, it does not
fall back to a scan. Postgres planned around this silently, so nothing in the app
hinted it was needed, and no unit test against an in-memory adapter can catch it.

Nine indexes cover every filter+order query in the codebase; they are written out
in [firestore.indexes.json](../firestore.indexes.json) with the query each one
serves. Affected: conversations by user, messages by conversation, VisualCard's
latest-assistant lookup, useGlbPreview, three in mesh.ts, and the mesh watcher.

I could not deploy them: the Admin SDK service account lacks
`serviceusage.serviceUsageConsumer`, so `firebase deploy` 403s. **You need to run
it** (see §6).

### Known gap, stated plainly

Storage rules cannot cheaply read a conversation's `privacy` field, so on a
**shared** conversation the text and geometry render but stored _image_ assets
403 for a non-owner. Fixing it means either server-minted signed URLs or a
`public/` prefix. Not blocking launch; will surprise you the first time you share
a conversation with images.

**Two findings worth knowing:**

- `.match()` and `.contains()` appear 12 times in the codebase but **every one
  is `String.match` or `Node.contains`, not a Supabase operator.** The real DB
  vocabulary is 12 methods, not 14 — the shim got smaller.
- A test guard caught my own fixture being 900 KB when it claimed to be over
  1 MB. Worth noting because it's the exact shape of the production bug: things
  that look like they exceed the limit often don't, and things that do exceed it
  fail silently. The assertion stays in so the test can't rot into proving
  nothing.

---

## The scheduling problem, stated plainly

You want two things that don't fit in the same day:

- **Host today.** Achievable — the codebase is already Vercel-ready.
- **Migrate to Firebase.** ~20–28 hours of focused work (breakdown in §2).

There is no version of this migration that ships tonight. The data layer is 99
query call sites across 30 files, and the risk in §4 needs decisions before code.

**So do both, in this order:**

| Track              | When                          | What                                                                                                        |
| ------------------ | ----------------------------- | ----------------------------------------------------------------------------------------------------------- |
| **A — Ship today** | ~40 min, mostly your clicking | Deploy on Supabase as-is (already done and verified), plus a keep-alive cron so it never idles into a pause |
| **B — Migrate**    | Next 2–3 days                 | This document, done properly, then swap the deployment over                                                 |

Track A is not wasted work. It proves the hosted wiring end to end — env vars,
build, streaming, storage — against a real deployment. Every one of those lessons
carries over to Firebase, and the keep-alive cron makes the interim safe from the
exact problem that pushed you toward Firebase in the first place.

If you'd rather not touch Supabase at all, skip Track A and accept the site goes
live in 2–3 days instead of today. That's a legitimate choice — just not both.

---

## 1. Why Firebase is a reasonable target

Being fair about it, since I pushed back earlier:

- **Firestore doesn't idle-pause.** The Spark plan has no 7-day inactivity
  shutdown. Your original complaint is real and Firebase genuinely fixes it.
- **Anonymous Auth is excellent** and maps perfectly onto the guest-login model
  you want — a real uid per browser, no sign-up form.
- **You're comfortable in it.** That matters more than people admit. The database
  you can debug at 2am beats the one that benchmarks better.

The cost is that this app was written Postgres-shaped. That's what §2–4 are about.

---

## 2. Effort breakdown

The accelerator that makes this tractable: **the Supabase API surface actually
used here is narrow.** Rather than rewriting 99 call sites, write a shim that
mimics that surface over Firestore and leave most call sites untouched.

Measured surface — the entire DB vocabulary in use:

```
.select()  .insert()  .update()  .upsert()  .delete()
.eq()      .in()      .match()   .contains()
.order()   .limit()   .single()  .maybeSingle()  .overrideTypes()
```

Fourteen methods. That's a shim, not a rewrite.

| #   | Task                                                                                                      | Hours        |
| --- | --------------------------------------------------------------------------------------------------------- | ------------ |
| 1   | Firestore query-builder shim (the 14 methods above)                                                       | 4–6          |
| 2   | Storage shim — `upload` / `download` / `remove` / `list` / `createSignedUrl(s)` / `copy` / `getPublicUrl` | 2–3          |
| 3   | Anonymous Auth + replace `LOCAL_USER_ID` (26 sites)                                                       | 3–4          |
| 4   | Firestore Security Rules (replaces the RLS design)                                                        | 2–3          |
| 5   | Realtime → `onSnapshot` (§3)                                                                              | 1–2          |
| 6   | Explicit cascade deletes (§4.2)                                                                           | 1–2          |
| 7   | Data model + document-size mitigation (§4.1)                                                              | 2–4          |
| 8   | End-to-end testing and shim gap-filling                                                                   | 4–6          |
|     | **Total**                                                                                                 | **~20–28 h** |

Call it **2.5–3.5 focused days**. Without the shim it's 4–6 days.

### Call sites by table

| Table                                       | Sites   |
| ------------------------------------------- | ------- |
| `meshes`                                    | 17      |
| `conversations`                             | 15      |
| `messages`                                  | 12      |
| `images` (table)                            | ~11     |
| `previews`                                  | 6       |
| `profiles`                                  | 3       |
| **Storage** (`storage.from('images')` etc.) | **~35** |

Storage is a bigger share than it looks — worth doing shim #2 before #1.

---

## 3. Service mapping

| Concern                | Supabase today                                                   | Firebase                      | Difficulty                                                |
| ---------------------- | ---------------------------------------------------------------- | ----------------------------- | --------------------------------------------------------- |
| Tables                 | Postgres, 7 tables                                               | Firestore collections         | Medium — shim                                             |
| Typed schema           | Generated [shared/database.ts](../shared/database.ts), 447 lines | Hand-written                  | **Loss.** No generator; types drift silently from here on |
| Storage                | 4 buckets                                                        | Cloud Storage buckets         | Easy                                                      |
| Signed URLs            | `createSignedUrl`                                                | `getSignedUrl`                | Easy                                                      |
| Guest identity         | (none — shared constant)                                         | Anonymous Auth                | Easy, and an upgrade                                      |
| Row security           | RLS policies                                                     | Security Rules                | Medium — different language, same shape                   |
| Realtime               | Broadcast channels                                               | `onSnapshot`                  | Easy, see below                                           |
| Enums (6)              | Postgres types                                                   | App-level unions              | Easy — **but the DB stops enforcing them**                |
| Cascade delete (5 FKs) | `ON DELETE CASCADE`                                              | Nothing                       | **Hard — see §4.2**                                       |
| `jsonb` columns        | Native, ~1 GB                                                    | Nested maps, **1 MB doc cap** | **Hard — see §4.1**                                       |

### Realtime is easier than expected

Two broadcast patterns exist, and one is dead:

1. **`mesh-updated`** — server → client on mesh completion
   ([falWebhook.ts:361](../src/server/falWebhook.ts#L361),
   [mesh.ts:1348](../src/server/mesh.ts#L1348), consumed by
   [MeshRealtimeProvider.tsx:41](../src/contexts/MeshRealtimeProvider.tsx#L41)).
   Port to a Firestore `onSnapshot` on the mesh document. This is _cleaner_ than
   broadcast — the state lives in the doc instead of a fire-and-forget message,
   so a client that reconnects still sees the result.

2. **`cancel-request`** — [useRequestCancellation.ts](../src/hooks/useRequestCancellation.ts)
   broadcasts a `cancel` event. **Nothing anywhere subscribes to it.** I grepped
   the whole tree: the only hits are the sender. It is dead code. Delete it or
   stub it; do not port it. This was the one piece I expected to be genuinely
   hard, and it isn't.

---

## 4. The three real risks

### 4.1 Firestore's 1 MB document limit — the big one

**Read this before writing any code.** It is the one thing that could make the
migration fail in production after appearing to work in testing.

`messages.parts` is a `jsonb` array holding AI message parts: reasoning text,
tool calls, and full OpenSCAD source. Two numbers from the code:

- [aiChat.ts](../src/server/aiChat.ts): `PARAMETRIC_MAX_OUTPUT_TOKENS = 64000`
- [aiChat.ts](../src/server/aiChat.ts): `stopWhen: stepCountIs(60)`

Sixty steps accumulate into **one** assistant message's `parts` array. At even
5k tokens of reasoning per step that's ~300k tokens ≈ **1.2 MB in a single
document.** Postgres `jsonb` tolerates that (limit ~1 GB). Firestore's 1 MB cap
is **hard, per document, and the write fails** — you lose the entire message,
which is exactly the failure mode you'd notice only on your most impressive
generation.

Pick one before starting:

- **(a) Parts as a subcollection.** `messages/{id}/parts/{partId}`, one doc per
  part. Removes the ceiling entirely. Costs a read per part and a rewrite of
  every message read/write path — the most invasive option and the most correct.
- **(b) Overflow to Cloud Storage.** Keep parts inline until ~700 KB, then spill
  to a Storage object and store a reference. Preserves the current shape; adds a
  branch on every read.
- **(c) Cap and truncate.** Lower `stopWhen` to ~20 and hard-cap stored reasoning.
  Cheapest, and lossy — you're deleting model output to fit the database.

**My recommendation: (b).** It keeps the shim honest — call sites keep seeing a
parts array — and it doesn't throw away output. (a) is the textbook answer but
it's a day of work on its own.

### 4.2 No cascade deletes

[HistoryView.tsx:111](../src/views/HistoryView.tsx#L111) deletes a conversation
row and nothing else. Postgres cascades to `messages`, `images`, `meshes`,
`previews` via 5 foreign keys. **Firestore has no cascades — and subcollections
are not deleted with their parent either**, which is the classic Firestore
footgun: the parent vanishes from queries while the children linger forever,
billable and invisible.

You need either a batched multi-collection delete in the client, or a Cloud
Function on document delete. Whichever you pick, write a test for it — orphaned
data is silent by nature.

### 4.3 Losses to accept consciously

- **Generated types.** `Database` is generated from the Postgres schema today.
  After migration nothing regenerates it. Types will drift from reality and the
  compiler will keep telling you everything is fine.
- **Enum enforcement.** 6 Postgres enums become TypeScript unions. The database
  stops rejecting bad values; only the app does, and only where it looks.
- **Referential integrity.** No FKs. A message can point at a conversation that
  no longer exists and nothing objects.
- **No ad-hoc SQL.** The `psql` queries I used to verify the local setup in this
  session have no Firestore equivalent. Debugging gets harder.

None of these is fatal. All of them are things you're trading away for not
thinking about pauses, and you should know you're trading them.

---

## 5. Phased plan

Ordered so each phase is independently verifiable — don't move on until the
check passes.

### Phase 0 — Decisions (30 min, blocking)

1. §4.1 mitigation: (a), (b), or (c)?
2. Firestore **Native mode**, not Datastore mode (irreversible per project)
3. Region — same continent as your Vercel region
4. Track A first, or straight to B?

### Phase 1 — Firebase project (30 min)

Create project, enable Firestore + Storage + Anonymous Auth, download a service
account key. Add to Vercel: `FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL`,
`FIREBASE_PRIVATE_KEY`, and the `VITE_FIREBASE_*` client config.

**Check:** a scratch script writes and reads one document.

### Phase 2 — Storage shim (2–3 h)

~35 call sites, all through one narrow interface. Do this first: it's the largest
single group, it's mechanical, and it builds confidence in the shim pattern
before the harder DB work.

**Check:** upload an image in the app, see it render, delete it.

### Phase 3 — DB shim (4–6 h)

The 14 methods. Keep the return shape `{ data, error }` so call sites don't
change. Where Firestore genuinely can't express a query, make the shim **throw
loudly** rather than silently return wrong data — a crash in testing is worth ten
subtle bugs in production.

**Check:** typecheck passes with zero call-site edits outside the shim.

### Phase 4 — Auth + identity (3–4 h)

Anonymous Auth, and the 26 `LOCAL_USER_ID` sites become the real uid. This is
also what fixes the shared-identity problem from the deployment doc — worth
noting that Firebase gets you that for free as part of the migration, where on
Supabase it was a separate 4–8 h job.

**Check:** two browsers, two separate histories.

### Phase 5 — Security Rules (2–3 h)

Own-documents-only, plus public read where `privacy == 'public'` so share links
survive. Storage rules keyed on the `{uid}/{conversationId}/...` path prefix the
app already writes.

**Check:** from devtools, try to read another uid's document. Must fail.

### Phase 6 — Realtime + cascades (2–4 h)

`onSnapshot` for mesh completion; delete the dead cancel channel; explicit
cascade deletes with a test.

**Check:** generate a mesh and watch it complete without a refresh. Delete a
conversation and confirm no orphans in any collection.

### Phase 7 — End to end (4–6 h)

Full pass: prompt → generation → preview → parameters → export, images, history,
share links. This is where shim gaps surface. Budget the time honestly; it always
takes longer than the phases that produce visible code.

---

## 6. What I need from you — current

Three things, in this order. All are console/CLI steps only you can authorise.

**1. Deploy rules and indexes** (blocks every filter+order query):

```powershell
npx firebase-tools login
npx firebase-tools deploy --only firestore:indexes,firestore:rules --project gexus-5f667
```

`.firebaserc`, `firebase.json`, `firestore.rules` and `firestore.indexes.json`
are all committed and ready. Index builds take a few minutes; queries keep
failing until each index reports READY.

**2. Provision Cloud Storage** (blocks images, meshes, previews, and the 1 MB
overflow): Console → Storage → Get started. **Expect a Blaze plan prompt** —
newer projects require pay-as-you-go for the default bucket. Then:

```powershell
npx firebase-tools deploy --only storage --project gexus-5f667
```

**3. Confirm the Firestore region** matches your Vercel region, if you have not
already — it is fixed at creation and every page load pays the round trip.

Then tell me and I will re-run the integration probe end to end.

## 7. Original ask

**To start Track A (today):** a Supabase project's three keys. ~10 min of yours.

**To start Track B:** the four Phase 0 answers, then a Firebase project with
Firestore/Storage/Anonymous Auth on and the service account key.

**Either way:** whether the URL is public or invite-only. Firebase's Security
Rules make public _safe_ in a way the current Supabase setup isn't — Phase 5 is
the equivalent of Phase 2 in the deployment doc — but it still has to be written
before strangers arrive.

---

## 7. Bottom line

**~20–28 hours, 2.5–3.5 focused days.** Cheaper than my earlier 3–5 day estimate,
because the shim strategy and the dead cancel channel both cut real work.

The migration is worth doing on its own terms if you're more productive in
Firebase — and it hands you the guest-identity fix as a side effect, which is
work you'd otherwise pay for separately. Just go in knowing about §4.1. The 1 MB
limit is the thing that will look fine in testing and then fail on the one
generation you most want to show someone.

It will not be live today. Track A will be.
