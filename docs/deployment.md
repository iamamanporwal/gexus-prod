# GEXUS — Production Deployment Runbook

Target: a public, no-login, guest-only deployment of this fork, launched with the
least work that is still safe to leave running unattended.

Everything in this document was verified against the tree at commit `ab45cbc`
(`feat: remove auth and run as a single local identity`). Where a step depends on
something I could not verify from here (your hosting account, your Supabase
dashboard), it is marked **[verify]**.

Target host: **Vercel** (Nitro `vercel` preset — build verified, see §5).

---

## Status — the codebase is Vercel-ready

Everything in this section is **done and verified**. A Vercel-style build (no
`.env.local`, vars from `process.env` only, `NITRO_PRESET=vercel`) exits 0, and
local dev is unaffected because every new var defaults to the old behaviour.

| Change                              | Where                                                           | Effect                                                                                                                                                                                      |
| ----------------------------------- | --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Node pinned to 22.12.0              | [.node-version](../.node-version)                               | Vercel reads this. Node 20 builds fine and then 500s on every request (§1.2).                                                                                                               |
| Function limits raised              | [vite.config.ts](../vite.config.ts) → `vercel.functions`        | Generated config now carries `maxDuration: "max"`, `memory: 2048`. Verified in `.vc-config.json`.                                                                                           |
| Wall-clock budget on the agent loop | [aiChat.ts](../src/server/aiChat.ts) `deadlineStopCondition`    | Added as a second `stopWhen` condition. The loop stops itself cleanly and **persists** instead of being killed mid-write (§5.2).                                                            |
| CORS lockdown                       | [api.ts](../src/server/api.ts) `ALLOWED_ORIGIN`                 | Was hard-coded `*`. Now env-driven; `*` only when unset.                                                                                                                                    |
| Sourcemaps no longer ship           | [vite.config.ts](../vite.config.ts) `uploadsSourcemapsToSentry` | ~400 `.map` files were going to the CDN, publishing the source. Now generated only when there's a Sentry token to upload them to. **Static output: 80 MB → 39 MB.**                         |
| Sentry org de-hardcoded             | [vite.config.ts](../vite.config.ts)                             | Was `org: 'adamcad'` — upstream's project. Any build with a token in scope would have uploaded this fork's sourcemaps there.                                                                |
| Asset caching fixed                 | [vercel.json](../vercel.json)                                   | Nitro's generated rule targets `/assets/*` but files serve from `/cadam/assets/*`, so nothing was cached — every visitor re-downloaded the 9.6 MB WASM.                                     |
| `/` → `/cadam` redirect             | [vercel.json](../vercel.json)                                   | The base path means `/` is otherwise a 404.                                                                                                                                                 |
| Model picker gated on keys          | [useAvailableModels.ts](../src/hooks/useAvailableModels.ts)     | Only models whose provider key is set are offered, and an unusable default is corrected. Previously the default (`openai/gpt-5.6-sol`) was guaranteed to fail with no `OPENROUTER_API_KEY`. |

Typecheck clean, `npm run lint` 0 errors, 16/16 tests pass.

**What is NOT done:** the identity work in §2. That is a product decision, not a
config task — see the next section. Deploy privately (§0) until it's made.

---

## What I need from you

### A. Decisions only you can make

| #   | Decision                                     | Why it blocks me                                                                                                                                  | Default if you don't care |
| --- | -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------- |
| 1   | **Public launch, or private/invited group?** | This is the big one. Public ⇒ §2 (guest identity + RLS) is mandatory. Private ⇒ you can ship today behind a password and defer §2.                | Assume public             |
| 2   | **Vercel plan: Hobby or Pro?**               | Sets the function timeout ceiling: ~300s vs ~800s. With `stopWhen: stepCountIs(60)` (§5.2) this decides whether complex models can finish at all. | Pro                       |
| 3   | **Monthly AI spend ceiling**                 | Sizes the per-guest quota in §3.2. "20 generations/guest/day" vs "3" is a budget question, not a technical one.                                   | —                         |
| 4   | **Which models to offer**                    | The picker currently exposes several providers. Each one you keep is a key to hold and a cost to carry.                                           | Keep the default only     |
| 5   | **Keep mesh generation (FAL)?**              | It's the only feature needing a public webhook + a paid third party. Cutting it removes a whole class of setup.                                   | Keep                      |
| 6   | **Domain name**                              | Needed for the CORS allowlist (§3.1) and `WEBHOOK_BASE_URL`.                                                                                      | Vercel's `*.vercel.app`   |

### B. Accounts to create / confirm

| Service             | Do you need it?                                                                                                                                | What I need from it                          |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------- |
| **Supabase**        | **You already have an account** — your deleted project was "iamamanporwal's Project". You need a **new project**, not a new account. See §1.1. | Project URL, `anon` key, `service_role` key  |
| **Vercel**          | Yes, if you don't have one                                                                                                                     | Project connected to this repo               |
| **Model providers** | You already have all five keys in `.env.local`                                                                                                 | Confirm which to keep; set spend caps (§3.2) |
| **Sentry**          | Optional                                                                                                                                       | DSN, or say "skip"                           |
| **PostHog**         | Optional                                                                                                                                       | Project key, or say "skip"                   |

**On Supabase specifically — is it required?** Yes, and it is not swappable without a
rewrite. The app uses four distinct Supabase products: Postgres (7 tables),
Storage (4 buckets), Realtime (mesh completion push,
[MeshRealtimeProvider.tsx:41](../src/contexts/MeshRealtimeProvider.tsx#L41)), and
— after §2 — Auth for the anonymous guest sessions. 19 client files import the
Supabase client directly. Replacing it is a project, not a config change. Stay on
Supabase.

### C. Credentials to hand me (or set yourself in Vercel)

Everything in §5.4's table. Of those, only the three Supabase values are actually
new — the rest already exist in your local [.env.local](../.env.local) and can be
copied across. **Your old Supabase keys are dead** (the project is deleted), so
those three must come from the new project.

### D. What I can do without you

Phase 5 is **done** (see Status above). Still available without you: phase 2 (the
guest identity + RLS migration), phase 3.2 (the per-guest quota), and phase 4
(the removals) — all code in this repo.

I need you for the dashboard toggles (anonymous sign-ins, provider spend caps),
the env vars, and decision #1 above.

---

## 0. Read this first: the one thing that blocks launch

This fork cannot be hosted as-is. Not "should not" — the code says so itself, in
[supabase/migrations/20260801000000_remove_auth.sql:17](../supabase/migrations/20260801000000_remove_auth.sql#L17):

> The app is now single-user by construction. **Do not deploy this anywhere
> reachable from the internet: the anon key grants full read/write.**

Three separate things are wrong for a public deploy, and they compound:

| #   | Problem                              | Where                                                                                                                                                               | Consequence if hosted as-is                                                                                                                                                                                |
| --- | ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Every visitor **is the same user**   | [shared/localUser.ts:10](../shared/localUser.ts#L10) — `LOCAL_USER_ID` is a hard-coded UUID                                                                         | Visitor B opens the app and sees visitor A's conversations, models and images in the sidebar. Not a leak you can apologise for — it's the default view.                                                    |
| 2   | **RLS is off on every table**        | migration step 3 drops all policies and runs `ALTER TABLE … DISABLE ROW LEVEL SECURITY`                                                                             | The anon key ships in the JS bundle. Anyone who opens devtools can `select`, `update` or `delete` **every row in every table** — including other people's data, and including `DELETE FROM conversations`. |
| 3   | **No usage limit, on your API keys** | [src/server/billingClient.ts:76](../src/server/billingClient.ts#L76) — `isBypassed()` returns true whenever `ENVIRONMENT === 'local'`, handing out 3,000,000 tokens | Every guest gets effectively unlimited generation against your Anthropic / OpenAI / OpenRouter / FAL keys. One scripted loop against the open endpoint drains your balance.                                |

There was a fourth — `Access-Control-Allow-Origin: '*'` on every API route,
letting any website call your chat endpoint from a visitor's browser. **Fixed**:
[api.ts](../src/server/api.ts) now reads `ALLOWED_ORIGIN`. Set it, or the `*`
fallback is still in play.

Problems 1–3 are not config and are not fixed. They need the work in §2.

**"Guest login" is the right product decision and it is compatible with fixing
all of this.** What you want is not "no identity" — it's "identity without a
sign-up form." Supabase has a first-class feature for exactly that
(Anonymous Sign-ins): it issues a real JWT with a unique `sub` per browser, with
no email, no password and no UI. That gives you back per-user isolation and
lets RLS do its job, while the visitor still just… lands on the app and types.

Phase 2 below is that change. It is the only phase I would call non-negotiable.

### If you need something live _today_ and can accept a private URL

Skip phases 2 and 3, deploy per phase 5, and turn on Vercel's **Deployment
Protection → Vercel Authentication** (project setting, no code — it requires a
Vercel login to view). Zero code changes, safe because nobody untrusted reaches
it — but it is **not** a public launch, and everyone who does get in still shares
one identity. Treat this as a staging URL, not the launch.

---

## 1. Phase 1 — Provision infrastructure

### 1.1 New Supabase project

Your previous project is **gone, not paused**. `lmcsykfeijmapwgoztfu.supabase.co`
returns `NXDOMAIN` from both `8.8.8.8` and `1.1.1.1`; Supabase withdraws the DNS
record on project deletion, and deleted projects are not recoverable. Assume the
old data is unrecoverable unless you have a `pg_dump` somewhere.

1. Create a new project at [supabase.com/dashboard](https://supabase.com/dashboard).
   Pick a region near your users, not near you — every page load hits it.
2. **Do not use the free tier for the launch.** Free projects auto-pause after
   7 days of inactivity, and that pause is what eventually became your deletion.
   A paused project fails exactly the same way your app just did. Pro tier, or
   accept that you will re-do this.
3. Record from Settings → API: project URL, `anon` key, `service_role` key.
4. Link and push the schema:

   ```powershell
   npx supabase link --project-ref <new-project-ref>
   npx supabase db push
   ```

   This applies all 8 migrations in [supabase/migrations/](../supabase/migrations/).
   Step 4 of the auth migration creates the four storage buckets (`images`,
   `meshes`, `previews`, `temp-multiview`) directly in SQL, so unlike a plain
   `config.toml` setup you do **not** need to create them by hand.

5. **[verify]** In the dashboard, confirm all four buckets exist under Storage
   before moving on. A missing bucket surfaces much later as a confusing
   "Bucket not found" mid-generation.

### 1.2 Node version

Use **Node 22.12.0**. Not 20.

Node 20 passes the `engines` check in [package.json](../package.json) and the dev
server prints a normal ready banner — then every request 500s, because
`@supabase/supabase-js` v2.108 needs a global `WebSocket` during SSR that Node 20
does not have:

```
Error: Node.js 20 detected without native WebSocket support.
  at @supabase/realtime-js/dist/main/lib/websocket-factory.js:103
  at src/lib/supabase.ts:21:25
```

Pin it so this cannot bite you or your host:

```powershell
"22.12.0" | Out-File -Encoding utf8 -NoNewline .node-version
```

Add `"packageManager": "npm@10"` and keep the existing `engines` block. Most
hosts (Railway, Render, Fly, Vercel) read `.node-version`.

---

## 2. Phase 2 — Guest identity (the non-negotiable one)

Goal: each browser silently gets its own real Supabase user; RLS comes back on;
nothing about the UX changes.

### 2.1 Turn on anonymous sign-ins

Supabase dashboard → Authentication → Sign In / Up → **Allow anonymous sign-ins**.

While you are there, Authentication → Rate Limits: cap anonymous sign-ins (the
default is generous). Also enable CAPTCHA on that endpoint if you expect
traffic — each anonymous sign-in creates a real `auth.users` row, and an
unprotected endpoint is a free way to fill your database.

### 2.2 Replace the constant with a session

[shared/localUser.ts](../shared/localUser.ts) is the whole identity layer, and it
has exactly two consumers: 26 client call sites and one server function. Rewrite
it as a session accessor rather than a const.

New `shared/guestUser.ts`:

```ts
import { supabase } from '@/lib/supabase';

let cachedUserId: string | null = null;

/** Signs in anonymously on first call; reuses the persisted session after that. */
export async function ensureGuestSession(): Promise<string> {
  if (cachedUserId) return cachedUserId;

  const { data: existing } = await supabase.auth.getSession();
  if (existing.session) {
    cachedUserId = existing.session.user.id;
    return cachedUserId;
  }

  const { data, error } = await supabase.auth.signInAnonymously();
  if (error) throw error;
  cachedUserId = data.user!.id;
  return cachedUserId;
}

/** Synchronous read for call sites that run after the boot gate. */
export function guestUserId(): string {
  if (!cachedUserId) throw new Error('guest session not initialised');
  return cachedUserId;
}
```

Critical: `persistSession: false` is currently hard-coded in
[src/lib/supabase.ts:22-25](../src/lib/supabase.ts#L22-L25). **Flip it to
`true`** and re-enable `autoRefreshToken`, or every reload creates a brand-new
guest and the visitor loses their history:

```ts
export const supabase = createClient<Database>(supabaseUrl, supabaseKey, {
  auth: { persistSession: true, autoRefreshToken: true },
});
```

### 2.3 Gate the app on the session

In [src/App.tsx](../src/App.tsx), await `ensureGuestSession()` before rendering
the routed tree (a full-screen spinner is fine — it is one round trip). This is
what makes the synchronous `guestUserId()` safe everywhere downstream.

### 2.4 Swap the 26 call sites

All of them consume `LOCAL_USER_ID` as a plain string, so this is mechanical —
`LOCAL_USER_ID` → `guestUserId()`. Full list, verified:

| File                                                                              | Lines                         |
| --------------------------------------------------------------------------------- | ----------------------------- |
| [src/views/EditorView.tsx](../src/views/EditorView.tsx)                           | 82, 272, 311                  |
| [src/views/HistoryView.tsx](../src/views/HistoryView.tsx)                         | 67, 119, 123                  |
| [src/views/PromptView.tsx](../src/views/PromptView.tsx)                           | 134, 150, 259                 |
| [src/components/chat/ChatSession.tsx](../src/components/chat/ChatSession.tsx)     | 468, 495                      |
| [src/components/Sidebar.tsx](../src/components/Sidebar.tsx)                       | 59                            |
| [src/components/TextAreaChat.tsx](../src/components/TextAreaChat.tsx)             | 859, 1141, 1145, 1161         |
| [src/contexts/MeshRealtimeProvider.tsx](../src/contexts/MeshRealtimeProvider.tsx) | 41                            |
| [src/hooks/usePreview.ts](../src/hooks/usePreview.ts)                             | 25                            |
| [src/services/conversationService.ts](../src/services/conversationService.ts)     | 39                            |
| [src/services/profileService.ts](../src/services/profileService.ts)               | 13, 18, 70, 80, 107, 125, 136 |

Two need thought rather than substitution:

- **[src/services/profileService.ts](../src/services/profileService.ts)** uses
  `LOCAL_USER_ID` inside React Query keys (lines 13, 80, 136). Those keys must
  include the guest id or one visitor's cached profile bleeds into the next
  session in the same tab.
- **[src/contexts/MeshRealtimeProvider.tsx:41](../src/contexts/MeshRealtimeProvider.tsx#L41)**
  subscribes to a realtime channel named after the user id. With RLS on,
  Realtime also needs the table added to the `supabase_realtime` publication and
  RLS-aware broadcast — **[verify]** mesh completion still pushes through after
  phase 2.5, because this is the piece most likely to silently stop working.

### 2.5 Turn RLS back on

New migration, e.g. `supabase/migrations/20260822000000_restore_rls_for_guests.sql`.
Note the table-by-table differences — this is not a uniform policy:

```sql
-- conversations / images / meshes / previews / prompts / profiles: own rows only.
-- `conversations` additionally allows public read for the share links.
-- `messages` has NO user_id column — it is scoped through its conversation FK.

ALTER TABLE public.conversations ENABLE ROW LEVEL SECURITY;
CREATE POLICY conversations_own ON public.conversations
  FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- Keeps /share/$id working: `privacy` is an enum ('public','private'),
-- default 'private' — see supabase/schemas/conversations.sql:8
CREATE POLICY conversations_public_read ON public.conversations
  FOR SELECT TO anon, authenticated
  USING (privacy = 'public');

ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;
CREATE POLICY messages_via_conversation ON public.messages
  FOR ALL TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.conversations c
    WHERE c.id = messages.conversation_id AND c.user_id = auth.uid()
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.conversations c
    WHERE c.id = messages.conversation_id AND c.user_id = auth.uid()
  ));

-- images / meshes / previews / prompts / profiles all have user_id: repeat the
-- conversations_own shape for each.
```

Then restore the per-user storage policies. Uploads already write to
`<user_id>/<conversation_id>/…`, so the upstream prefix check works unchanged —
it was only dropped because `auth.uid()` was always NULL:

```sql
DROP POLICY IF EXISTS "Local access to app buckets" ON storage.objects;

CREATE POLICY "Guests access own folder" ON storage.objects
  FOR ALL TO authenticated
  USING (
    bucket_id IN ('images','meshes','previews')
    AND (storage.foldername(name))[1] = auth.uid()::text
  )
  WITH CHECK (
    bucket_id IN ('images','meshes','previews')
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

-- temp-multiview is a public scratch bucket; leave it permissive but add a
-- storage lifecycle/cron cleanup so it does not grow forever.
```

**[verify]** After pushing, log in as two different guests in two browsers and
confirm each sidebar shows only its own conversations. Then re-run one of the
share links. This is the acceptance test for the entire phase.

### 2.6 Make the server trust the JWT, not a constant

Two small edits, and they are the whole server-side change:

1. **[src/services/api.ts:22-31](../src/services/api.ts#L22-L31)** — `apiJson`
   deliberately sends no `Authorization` header. Add one:

   ```ts
   const { data } = await supabase.auth.getSession();
   headers: {
     'Content-Type': 'application/json',
     ...(data.session && { Authorization: `Bearer ${data.session.access_token}` }),
     ...init.headers,
   }
   ```

   Do the same wherever the chat transport is configured — the streaming call in
   [src/server/aiChat.ts](../src/server/aiChat.ts) is reached from the client
   through the AI SDK, not through `apiJson`.

2. **[src/server/api.ts:38-40](../src/server/api.ts#L38-L40)** — `requireUser()`
   is the single chokepoint where identity enters the server, and it currently
   ignores its argument. Make it verify:

   ```ts
   export async function requireUser(request: Request) {
     const token = request.headers.get('Authorization')?.replace('Bearer ', '');
     if (!token) throw new Error('Unauthorized');
     const { data, error } = await getAnonSupabaseClient().auth.getUser(token);
     if (error || !data.user) throw new Error('Unauthorized');
     return data.user;
   }
   ```

   `isUnauthorizedError` already exists next to it and the handlers already
   branch on it, so 401s wire themselves up. Making this `async` will ripple
   into its callers in [src/server/aiChat.ts:991](../src/server/aiChat.ts#L991)
   and [src/server/mesh.ts:383](../src/server/mesh.ts#L383) — both already sit
   in async functions.

Note that `billing.getStatus(email)` and friends are keyed by **email**, and an
anonymous user has none. Simplest correct move: key on `user.id` instead. See
phase 3.2.

---

## 3. Phase 3 — Abuse and cost controls

Phase 2 stops guests reading each other's data. It does nothing about spend.
With `ENVIRONMENT=local` every guest is handed 3,000,000 tokens.

### 3.1 Lock down CORS — done, but you must set the var

[api.ts](../src/server/api.ts) used to hard-code
`Access-Control-Allow-Origin: '*'`, letting any site on the internet spend your
API budget from a visitor's browser. It now reads `ALLOWED_ORIGIN`, and adds
`Vary: Origin` when pinned so a shared cache can't serve one origin's response
to another.

The fallback when unset is still `*` — deliberately, so local dev and Vercel
preview URLs keep working without per-environment config. **That means setting
`ALLOWED_ORIGIN` in Vercel is a required step, not an optional one.** Verified
locally: with the var unset the header is still `*`.

### 3.2 Put a real cap on generation

You have two options; pick one, do not launch with neither.

**Option A — flip the bypass into a real quota (recommended).**
[src/server/billingClient.ts](../src/server/billingClient.ts) already has the
whole shape: `consume()`, `refund()`, `getStatus()`, and the UI already renders
balances and a "limit reached" state. Instead of `devStatus()` returning three
million, back it with a `guest_quota` table keyed on `user_id` — e.g. 20
generations per guest per day. You are reusing existing plumbing, and
[src/components/LimitReachedMessage.tsx](../src/components/LimitReachedMessage.tsx)
already exists to render the wall.

**Option B — IP rate limit at the edge.** Cloudflare rate-limiting rules on
`/cadam/api/*`, or an Upstash Ratelimit call at the top of the chat handler.
Faster to ship, but a determined abuser rotates IPs and it does nothing about
one enthusiastic user.

Either way, also set **hard spend caps in each provider dashboard** —
OpenRouter, Anthropic, OpenAI, FAL all support them. **[verify]** This is your
backstop for when the application-level cap has a bug, and it is 5 minutes of
work.

### 3.3 Protect the webhook

[src/routes/api/fal-webhook.ts](../src/routes/api/fal-webhook.ts) accepts
unauthenticated POSTs — it must, FAL calls it. Confirm
[src/server/falWebhook.ts](../src/server/falWebhook.ts) verifies FAL's signature
before trusting the payload; if it does not, add a shared secret in the callback
URL query string. `WEBHOOK_BASE_URL` must be your public HTTPS origin in
production — in local dev it falls back to the request origin
([src/server/env.ts:12-16](../src/server/env.ts#L12-L16)), which will not work
for an external caller.

---

## 4. Phase 4 — Removals

Now the part you asked about directly. Ordered by ratio of noise removed to risk
taken.

### 4.1 Safe to delete outright

| Path                                                                                                                                      | Why                                                                                                                                                                                                 |
| ----------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ~~src/components/NewProductBanner.tsx~~                                                                                                   | **Done** — deleted. Promoted `adam.new`; was already dead code, imported nowhere.                                                                                                                   |
| [src/routes/\_layout/subscription.tsx](../src/routes/_layout/subscription.tsx)                                                            | **Done** — kept as a route so old links do not 404, but retargeted from `accounts.adam.new` to `/settings`. Deleting the file would mean regenerating `routeTree.gen.ts`.                           |
| [src/routes/api/billing-checkout.ts](../src/routes/api/billing-checkout.ts), [billing-products.ts](../src/routes/api/billing-products.ts) | The `https://adam.new/app` fallback redirect is **fixed** — the return URL now derives from the request origin. The billing service itself is still upstream's, and `BILLING_SERVICE_URL` is unset. |
| ~~src/config/billing.ts~~                                                                                                                 | **Done** — deleted, with the 8 buttons that read `BILLING_URL = 'https://accounts.adam.new/billing'`.                                                                                               |
| [benchmarks/](../benchmarks/)                                                                                                             | 13 demo GIFs. Nothing imports them; they only bloat your clone and image. Keep them in the repo if you want the README, exclude from the Docker context.                                            |

### 4.2 Delete only after choosing Option B in 3.2

If you went with Option A (real quota), **keep all of these** — you are reusing
them. If Option B, remove this cluster. Note the import graph, verified, so you
know the blast radius before you start:

```
src/components/CreditsButton.tsx        ← src/components/Layout.tsx
src/components/FreePlanTrialPill.tsx    ← src/views/PromptView.tsx
src/components/LimitReachedMessage.tsx  ← src/views/PromptView.tsx,
                                          src/components/chat/ChatSession.tsx
src/components/LowPromptsWarningMessage.tsx ← src/views/PromptView.tsx
src/components/billing/TrialDialog.tsx  ← FreePlanTrialPill, LimitReachedMessage,
                                          LowPromptsWarningMessage
src/services/subscriptionService.ts     ← TrialDialog, src/views/SettingsView.tsx
src/hooks/useTokenPacks.ts              ← src/views/SettingsView.tsx
src/hooks/useBillingProducts.ts         ← TrialDialog, useTokenPacks
```

`PromptView` and `SettingsView` each lose several imports, and `PromptView`'s
`lowPrompts` / `limitReached` memos ([lines 73-81](../src/views/PromptView.tsx#L73-L81))
go with them. Keep [src/hooks/useBilling.ts](../src/hooks/useBilling.ts) and
`/api/billing-status` regardless — with Option B, have it report your rate-limit
budget so the UI still has something truthful to show.

### 4.3 Keep, despite appearances

- **Sentry** ([src/client.tsx:23](../src/client.tsx#L23)) and **PostHog**
  ([src/lib/posthog.ts:17](../src/lib/posthog.ts#L17)) both self-disable on an
  empty key — Sentry gets `dsn: ''`, PostHog logs a warning and returns early.
  Leaving the env vars blank is a valid config. For a real launch, put your own
  DSN in; you will want the error reporting on day one.
- **`ENVIRONMENT=local`** — counter-intuitively, keep it. It is the flag that
  bypasses upstream's billing service, which you do not have credentials for.
  Changing it to `production` makes `requiredEnv('BILLING_SERVICE_URL')` throw on
  the first billing call. Rename the flag later if it bothers you; do not
  repoint it at launch.
- **`shared/localUser.ts`** — the `LOCAL_USER` object is shaped like the subset
  of supabase-js's `User` the app reads, which is why phase 2 substitutes cleanly.
  Delete it only once every call site is migrated and typechecking is green.

### 4.4 Docs to correct

[README.md](../README.md)'s Quick Start is stale for this fork and will mislead
whoever deploys next. It tells you to run `npx supabase functions serve` (there
is no `supabase/functions/` directory here — all backend logic is TanStack Start
routes under [src/routes/api/](../src/routes/api/)) and to set up ngrok (only
needed for the FAL webhook in local dev). Trim both.

---

## 5. Phase 5 — Build and deploy

### 5.1 Vercel works — verified

I ran the build both ways. Both succeed on Node 22.12.0, exit 0.

Default (no config) gives `node-server`, output `.output/`. With the Vercel
preset — which Nitro **auto-detects on Vercel**, so you don't have to set
anything:

```
[nitro:vercel] Using nodejs22.x runtime.
[nitro:vercel] Using web entry format.
  - Build Directory: .vercel/output
  - Nitro Preset: vercel
[prerender] Prerendered 1 pages: /cadam
```

The generated function config is already right for this app:

```json
// .vercel/output/functions/__server.func/.vc-config.json
{
  "handler": "index.mjs",
  "launcherType": "Nodejs",
  "supportsResponseStreaming": true,
  "runtime": "nodejs22.x"
}
```

`supportsResponseStreaming: true` is the important line — the streaming chat
works on Vercel without intervention.

Sizes are comfortable: the function is 28 MB (Vercel's limit is 250 MB unzipped)
and static output is 80 MB. The 9.6 MB `openscad.wasm` is emitted as a plain
static asset at `/cadam/assets/openscad-<hash>.wasm` and served off the CDN — the
heavy CAD work runs as WASM in the visitor's browser, not on your server, so
function sizing is not a scaling concern.

Routing is a single catch-all: `.vercel/output/config.json` sends `/(.*)` to one
`__server` function. That matters in 5.2 — there is no separate per-route
function to give a different timeout to.

**No preset config needed.** Leave [vercel.json](../vercel.json) as it is
(currently `{}`) apart from the header fix in 5.2b. Just connect the repo.

### 5.2 The one real Vercel risk: the 60-step agent loop

This is the thing to go in knowing, and it deserves a number rather than a
hand-wave.

[src/server/aiChat.ts:1288](../src/server/aiChat.ts#L1288):

```ts
stopWhen: stepCountIs(conversation.type === 'parametric' ? 60 : 5),
```

Sixty agentic tool-calling steps for a parametric conversation. Each step is a
full model round trip. The V8 engine in [benchmarks/](../benchmarks/) (22
dimensions, 8 colors) is exactly the kind of prompt that uses a lot of them. At a
plausible 10-20 s per step, a worst-case generation runs **10-20 minutes**.

Vercel function ceilings **[verify — these change]**: roughly 300 s on Hobby,
800 s on Pro with Fluid compute. So:

- **Hobby (~5 min): complex models will be cut off mid-generation.** Not a maybe.
- **Pro (~13 min): covers most of the range, but not the tail.**

And when the function is killed you don't just lose the response — you lose the
write. `createUIMessageStreamResponse` is configured with
`consumeSseStream: consumeStream` ([line 1564](../src/server/aiChat.ts#L1564)),
which exists precisely so the stream keeps draining and persisting after a client
disconnect. A killed function takes the half-finished conversation with it.

**Mitigations — 1 and 3 are implemented, 2 is yours to tune:**

1. **Ceiling raised — done.** [vite.config.ts](../vite.config.ts) passes
   `vercel.functions` to the `nitro()` plugin (`NitroPluginConfig` extends
   `NitroConfig`, so no separate `nitro.config.ts` is needed):

   ```ts
   vercel: { functions: { maxDuration: 'max', memory: 2048 } }
   ```

   `'max'` asks for the highest the current plan allows rather than a number
   that silently becomes wrong on a plan change. Verified in the build output:

   ```json
   { "maxDuration": "max", "memory": 2048, "supportsResponseStreaming": true }
   ```

   Per-route `functionRules` are supported by the preset but pointless here —
   there is only one function (5.1), so the base `functions` config is the knob.

2. **Lower `stopWhen` — your call.** 60 is generous. Try 30 and see whether real
   prompts suffer; failing fast beats timing out having spent the tokens anyway.
   One line at [aiChat.ts](../src/server/aiChat.ts).

3. **Wall-clock budget — done.** `deadlineStopCondition` in
   [aiChat.ts](../src/server/aiChat.ts) is added as a second `stopWhen`
   condition (the AI SDK accepts an array and stops when _any_ condition is
   met), so it composes with the step cap rather than replacing it.

   It is evaluated between steps, so it never truncates a step already in
   flight — which is exactly why the budget wants headroom: one more step still
   has to fit. That is what the ~85% guidance is for. Set
   `CHAT_TIME_BUDGET_SECONDS` (255 on Hobby, 680 on Pro); leave it unset for a
   container and the step cap alone governs, unchanged from before.

   This is the mitigation that actually removes the data-loss mode. Without it,
   a killed function takes the half-finished conversation with it and the user
   watches their prompt disappear.

If real prompts still hit the ceiling after this, that is the signal to move to a
container (Railway/Render/Fly — `node .output/server/index.mjs`, same codebase,
`CHAT_TIME_BUDGET_SECONDS` unset, no timeout). Do not pre-optimise for it: Vercel
is very likely fine for launch, and switching later is a config change, not a
rewrite.

### 5.2b Two build-output fixes worth doing

**Assets are not getting their cache headers.** The generated
`.vercel/output/config.json` sets 1-year immutable caching on `/assets/(.*)`, but
because `baseURL` is `/cadam` the files are actually served from
`/cadam/assets/*`. The rule never matches, so every visitor re-downloads the
9.6 MB WASM and all hashed JS on every visit. Fix in
[vercel.json](../vercel.json):

```json
{
  "headers": [
    {
      "source": "/cadam/assets/(.*)",
      "headers": [
        {
          "key": "cache-control",
          "value": "public, max-age=31536000, immutable"
        }
      ]
    }
  ]
}
```

**Sourcemaps are shipping to production.** [vite.config.ts:79](../vite.config.ts#L79)
sets `sourcemap: true`, which is most of why `static/` is 80 MB. The Sentry plugin
is already wired up — have it upload sourcemaps and delete them from the output
(`sourcemaps.filesToDeleteAfterUpload`), so you keep readable stack traces without
publishing your source. Also exclude the 7.8 MB `public/cadam-launch.gif`; it is a
README asset the app never loads.

### 5.3 Base path decision

[vite.config.ts:9](../vite.config.ts#L9) sets `appBase = '/cadam'`, so the app
serves at `yourdomain.com/cadam` and `/` is a 404. That value feeds four things:
Vite's `base`, the router `basepath`, the SPA `maskPath`, and the dev WASM
middleware — plus [src/services/api.ts:3-6](../src/services/api.ts#L3-L6) derives
every API URL from `BASE_URL`, and
[src/routes/\_\_root.tsx:5-6](../src/routes/__root.tsx#L5-L6) derives favicon paths.

**Launch with `/cadam` as-is** and redirect `/` to it in
[vercel.json](../vercel.json) — one line, alongside the header fix from 5.2b:

```json
{
  "redirects": [{ "source": "/", "destination": "/cadam", "permanent": false }]
}
```

Changing `appBase` to `'/'` instead means `normalizedAppBase` becomes `''`, and
`spa.maskPath: ''` is the kind of empty-string edge case that fails at runtime
rather than at build. The Vercel build I ran also nests all static output under
`static/cadam/`, so the base path is load-bearing in the output layout too. Not a
fight worth having on launch day — do it in the first quiet week, with the
prerender output checked.

### 5.4 Environment variables on the host

`VITE_*` vars are **inlined at build time**, so they must be present in the build
environment, not just at runtime. Setting them only as runtime secrets produces a
bundle pointing at `http://localhost` — the fallback in
[src/lib/supabase.ts:13](../src/lib/supabase.ts#L13).

| Variable                                      | Value                                                 | Exposed to browser        |
| --------------------------------------------- | ----------------------------------------------------- | ------------------------- |
| `VITE_SUPABASE_URL`                           | new project URL                                       | **yes**                   |
| `VITE_SUPABASE_ANON_KEY`                      | new anon key                                          | **yes**                   |
| `SUPABASE_SERVICE_ROLE_KEY`                   | new service role key                                  | no — never prefix `VITE_` |
| `OPENROUTER_API_KEY`                          | routes everything except `google/*` and `anthropic/*` | no                        |
| `ANTHROPIC_API_KEY`                           | `anthropic/*` models                                  | no                        |
| `GOOGLE_API_KEY`                              | `google/*` models                                     | no                        |
| `OPENAI_API_KEY`                              | if you keep OpenAI-direct models                      | no                        |
| `FAL_KEY`                                     | mesh generation                                       | no                        |
| `ENVIRONMENT`                                 | `local` — see 4.3                                     | no                        |
| `WEBHOOK_BASE_URL`                            | your public HTTPS origin                              | no                        |
| `BILLING_SERVICE_URL` / `_KEY`                | leave empty (bypassed)                                | no                        |
| `VITE_SENTRY_DSN` / `VITE_SENTRY_ENVIRONMENT` | your DSN / `production`                               | yes                       |
| `VITE_POSTHOG_PROJECT_KEY`                    | your key, or empty to disable                         | yes                       |
| `NGROK_URL` / `ADAM_URL`                      | leave empty                                           | no                        |

**New vars added by the deploy-readiness work** (all optional — unset keeps the
local behaviour, which is why nothing broke locally):

| Variable                                              | Value                        | What it does                                                                                                                                                                                  |
| ----------------------------------------------------- | ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ALLOWED_ORIGIN`                                      | `https://<your-domain>`      | Pins CORS to your origin. **Unset falls back to `*`**, which lets any website call your chat endpoint from a visitor's browser and spend your API credits. Set this on any public deployment. |
| `CHAT_TIME_BUDGET_SECONDS`                            | `255` on Hobby, `680` on Pro | Stops the 60-step agent loop before the platform kills the function, so the conversation still persists. ~85% of your plan's ceiling. Unset = no deadline.                                    |
| `SENTRY_ORG` / `SENTRY_PROJECT` / `SENTRY_AUTH_TOKEN` | your Sentry values           | Set **all three or none**. With the token, sourcemaps upload then delete from the output; without it, no sourcemaps are generated at all.                                                     |

I confirmed the only client-exposed vars in the whole tree are the Sentry,
PostHog and Supabase ones — no provider API key reaches the browser. Keep it
that way: a `VITE_` prefix on any key above ships it to every visitor.
`ALLOWED_ORIGIN` and `CHAT_TIME_BUDGET_SECONDS` are read at runtime, not
inlined, so changing them in Vercel's settings takes effect without a rebuild.

### 5.5 Deploy to Vercel

**Vercel project settings** — the defaults are almost right; only the framework
preset needs attention:

| Setting          | Value                                                                                                    |
| ---------------- | -------------------------------------------------------------------------------------------------------- |
| Framework Preset | **Other** (do not pick Vite — it would override the output dir)                                          |
| Build Command    | `npm run build`                                                                                          |
| Output Directory | leave **empty** (Nitro writes Build Output API v3 to `.vercel/output`, which Vercel reads automatically) |
| Install Command  | `npm ci`                                                                                                 |
| Node Version     | 22.x (or let `.node-version` from 1.2 drive it)                                                          |

Nitro detects Vercel from its CI env vars and switches to the `vercel` preset on
its own — no `NITRO_PRESET` needed. If you ever want to force it (e.g. to
reproduce the Vercel build locally), that env var is the lever:

```powershell
$env:NITRO_PRESET="vercel"; npm run build   # → .vercel/output
```

Local sanity check before you push:

```powershell
npm ci
npm run build          # tsc -b && vite build
npx vite preview       # serves the built output
```

Then open `http://localhost:4173/cadam` — remember the base path; `/` is a 404 by
design (5.3).

Two nits worth clearing while you're here: `caniuse-lite` is 14 months stale and
Browserslist warns on every build (`npx update-browserslist-db@latest`), and
`rolldown` emits a plugin-timings notice that is informational only.

**Deploy order matters.** Do the Supabase project (§1.1) and set the env vars
(§5.4) _before_ the first deploy — `VITE_*` vars are baked in at build time, so a
deploy that runs before they exist produces a bundle pointing at `http://localhost`
and you will chase a phantom bug.

---

## 6. Launch checklist

Run every one of these against the deployed URL, not localhost.

**Isolation** — the point of phase 2

- [ ] Two different browsers → two different sidebars, no overlap
- [ ] With the anon key from devtools, `select * from conversations` returns only your own rows
- [ ] Same, for an `update` and a `delete` — both must be denied
- [ ] A `/share/$id` link on a `privacy = 'public'` conversation opens in a logged-out browser
- [ ] Reload the page → same conversations still there (proves `persistSession: true`)

**Function**

- [ ] Prompt → OpenSCAD generation → 3D preview renders
- [ ] Parameter sliders update the model without re-generating
- [ ] Export .STL, .SCAD, .DXF
- [ ] Image upload as reference
- [ ] Mesh generation completes **and the realtime update arrives** (the fragile one — see 2.4)
- [ ] Each configured model provider answers at least once

**Cost**

- [ ] Generation blocked after the cap is hit, with a sensible message
- [ ] Provider dashboard hard spend caps set — all four
- [ ] `curl` the chat endpoint from an unlisted origin → CORS rejection
- [ ] `curl` it with no `Authorization` header → 401

**Vercel-specific**

- [ ] Build log says `Nitro Preset: vercel` and `nodejs22.x` — not `node-server`
- [ ] `/` redirects to `/cadam` (5.3), and `/cadam` loads
- [ ] A **long, complex** prompt (copy the V8 engine one from [benchmarks/13-v8-engine.md](../benchmarks/13-v8-engine.md)) completes without a `FUNCTION_INVOCATION_TIMEOUT` — this is the 5.2 risk, and a short test prompt will not surface it
- [ ] After that generation, reload: the full conversation persisted (proves the stream drained, not just streamed)
- [ ] Response headers on `/cadam/assets/*` show `max-age=31536000` (5.2b)
- [ ] No `.map` files reachable under `/cadam/assets/` (5.2b)

**Operations**

- [ ] Sentry receives a deliberately thrown error
- [ ] Supabase is on a paid tier (no auto-pause)
- [ ] A `pg_dump` backup exists, and you have restored it once
- [ ] `temp-multiview` has a cleanup job

---

## 7. Honest effort estimate

| Phase                     | Work                                                               | Status                                                                                                                 |
| ------------------------- | ------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------- |
| 5 — Vercel readiness      | Config, function limits, timeout budget, CORS, sourcemaps, caching | ✅ **Done** — see Status at the top                                                                                    |
| 5.2 — Timeout mitigations | Wall-clock budget                                                  | ✅ **Done**; only `stopWhen: 60` left to tune if you want                                                              |
| 1 — Provision             | ~30 min of dashboard clicking, then I run `db push`                | ⬜ Needs your Supabase project                                                                                         |
| 2 — Guest identity + RLS  | 4–8 h, mostly the 26 call sites and verifying realtime             | ⬜ **Required for a public URL.** Skipping it means every visitor shares one account and anyone can wipe the database. |
| 3.2 — Per-guest quota     | 2–4 h                                                              | ⬜ Required for a public URL — otherwise a stranger's script bills you                                                 |
| 4 — Removals              | 1–2 h                                                              | ⬜ Cosmetic. After launch is fine.                                                                                     |

**Two different timelines, depending on decision #1:**

- **Private URL (you + invited people): ~40 minutes, and it's all yours.** Create
  the Supabase project, let me push the schema, connect Vercel, set the env vars,
  flip on Deployment Protection. The code is ready.
- **Public URL: that 40 minutes plus 1–2 focused days** for phases 2 and 3.2.

The identity model is the expensive part, and it is the part that decides whether
this is a launch or an incident. Vercel was the easy half — the preset
auto-detects, streaming was already on, and the build passed untouched.

My recommendation: do the private deploy now. It proves the hosted Supabase wiring
end to end against a real deployment, which is the thing most likely to surprise
you, and it costs almost nothing to redo as public later.
