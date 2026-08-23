import { sentryVitePlugin } from '@sentry/vite-plugin';
import { tanstackStart } from '@tanstack/react-start/plugin/vite';
import { nitro } from 'nitro/vite';
import fs from 'node:fs';
import path from 'path';
import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';

// Serve at the domain root.
//
// Upstream used '/cadam' because the app was mounted as a sub-path of
// adam.new. On a dedicated domain that sub-path buys nothing and costs a lot:
// '/' 404s unless a redirect is in place, and under Vercel's Build Output API
// the generated .vercel/output/config.json supersedes vercel.json's routing —
// so a redirect declared there never fires. Serving at the root removes the
// whole class of problem instead of papering over it.
// Typed as `string`, not inferred as the literal '/', so the sub-path branches
// below stay type-checked and this remains a one-line change if the app ever
// needs mounting under a prefix again.
const appBase: string = '/';

// ── Vercel project settings this config assumes ────────────────────────────
//
// Recorded here because they live in the Vercel dashboard and cannot be
// expressed in the repo. There is deliberately no vercel.json: its schema
// rejects unknown keys (so no comments), and under the Build Output API its
// routing directives are superseded by the generated config.json anyway.
//
//   Framework Preset : Other          <- NOT Vite. Vite makes Vercel look for
//                                        dist/ and ignore .vercel/output, which
//                                        404s every path including /api/*.
//   Build Command    : npm run build
//   Output Directory : (leave empty)  <- setting it also bypasses .vercel/output
//   Install Command  : npm ci
//   Node.js Version  : 22.x           (or driven by .node-version)
//
// A correct build log says: "Nitro Preset: vercel" and
// "Build Directory: .vercel/output".

// Router basepath and the SPA mask want a real path, never the empty string
// that stripping the trailing slash off '/' would produce.
const normalizedAppBase = appBase === '/' ? '/' : appBase.replace(/\/$/, '');

// Asset and API URLs are derived from BASE_URL at runtime, which is '/' here.
// Kept as a separate constant because the dev WASM middleware needs a prefix
// that does not double up the slash.
const assetPathPrefix = normalizedAppBase === '/' ? '' : normalizedAppBase;

// Sourcemap generation and the Sentry plugin are driven by the same switch:
// there is no reason to emit .map files for a build that cannot upload them.
const uploadsSourcemapsToSentry = Boolean(process.env.SENTRY_AUTH_TOKEN);

// Nitro's stock Vercel node entry (presets/vercel/runtime/vercel.node.mjs in
// this beta) redefines req.socket.remoteAddress on EVERY request without
// `configurable`, so the second request arriving on a kept-alive socket dies
// with "TypeError: Cannot redefine property: remoteAddress" and takes the
// whole function process with it. Reproduced against the built artifact over
// plain node:http with an agent reusing one socket. This transform makes the
// property configurable so per-request redefinition is legal. Guarded: if a
// future nitro version changes the entry so the pattern no longer matches,
// the build fails here instead of shipping an unpatched entry.
function fixNitroVercelNodeEntry(): Plugin {
  const BROKEN = 'Object.defineProperty(req.socket, "remoteAddress", { get() {';
  const FIXED =
    'Object.defineProperty(req.socket, "remoteAddress", { configurable: true, get() {';
  return {
    name: 'fix-nitro-vercel-node-entry',
    transform(code, id) {
      if (!id.includes('vercel.node')) {
        return null;
      }
      if (code.includes(BROKEN)) return code.replace(BROKEN, FIXED);
      if (code.includes('configurable: true')) return null; // fixed upstream
      throw new Error(
        'nitro vercel.node entry changed; revisit fixNitroVercelNodeEntry()',
      );
    },
  };
}

function serveOpenScadWasmInDev(): Plugin {
  return {
    name: 'serve-openscad-wasm-in-dev',
    configureServer(server) {
      const wasmPath = path.resolve(
        __dirname,
        'src/vendor/openscad-wasm/openscad.wasm',
      );

      server.middlewares.use((req, res, next) => {
        if (!req.url) return next();

        const url = new URL(req.url, 'http://localhost');
        if (
          url.pathname !==
          `${assetPathPrefix}/src/vendor/openscad-wasm/openscad.wasm`
        ) {
          return next();
        }

        res.statusCode = 200;
        res.setHeader('Content-Type', 'application/wasm');
        res.setHeader('Cache-Control', 'no-cache');
        fs.createReadStream(wasmPath)
          .on('error', (error) => next(error))
          .pipe(res);
      });
    },
  };
}

export default defineConfig({
  base: appBase,
  plugins: [
    fixNitroVercelNodeEntry(),
    serveOpenScadWasmInDev(),
    tanstackStart({
      router: {
        basepath: normalizedAppBase,
      },
      spa: {
        enabled: true,
        maskPath: normalizedAppBase,
      },
    }),
    nitro({
      baseURL: normalizedAppBase,
      inlineDynamicImports: true,
      // firebase-admin is BUNDLED, entered through its CJS files via the
      // resolve.alias entries below. The obvious alternatives are all dead
      // ends, each one found by shipping it:
      //
      //   - Bundling its normal entries dies at import time: the package's
      //     ESM shims read `mod.SDK_VERSION` off a default import of a CJS
      //     file, which bundler interop resolves to undefined
      //     ("Cannot read properties of undefined (reading 'SDK_VERSION')").
      //   - Externalizing + tracing (nitro traceDeps) dies on Vercel's
      //     runtime: its /opt/rust/nodejs.js loader hooks Module._load
      //     without require(esm) support, so jwks-rsa's require('jose') —
      //     jose v6 is ESM-only — throws ERR_REQUIRE_ESM at cold start and
      //     every request is FUNCTION_INVOCATION_FAILED. Plain Node 22/24
      //     handles the same tree fine, which is why the identical artifact
      //     served 200s in an isolated container while production crashed.
      //
      // Bundling through the CJS entries sidesteps both: no shim in the
      // graph, and require('jose') becomes build-time interop instead of a
      // runtime resolution against a loader Vercel controls.
      // Long-lived caching for content-hashed assets. Declared here rather than
      // in vercel.json because Nitro's generated .vercel/output/config.json is
      // authoritative for routing under the Build Output API — headers set in
      // vercel.json never apply. Matters most for the 9.6 MB openscad.wasm,
      // which every visitor would otherwise re-download on each visit.
      routeRules: {
        '/assets/**': {
          headers: { 'cache-control': 'public, max-age=31536000, immutable' },
        },
      },
      // Vercel-only; ignored by every other preset, so this is safe to leave
      // set when building for a container or locally.
      //
      // The parametric chat handler runs an agentic loop capped at 60 tool-call
      // steps (src/server/aiChat.ts), each one a full model round trip, so a
      // complex model can legitimately take many minutes. `'max'` asks for the
      // highest ceiling the current plan allows rather than hard-coding a
      // number that silently becomes wrong on a plan change. A killed function
      // loses the conversation write, not just the response — see the
      // wall-clock budget in aiChat.ts, which stops cleanly before this hits.
      //
      // Routing puts every path on one catch-all function, so this base config
      // is the only knob; per-route `functionRules` would have nothing to match.
      vercel: {
        // The classic (req, res) handler entry instead of the default
        // `export default { fetch }` web object. Elimination, not preference:
        // this exact function artifact imports clean and serves 200s in an
        // isolated node:24 container, and the build/prerender pass on Vercel
        // itself — yet every deployed invocation died in the launcher, the
        // one layer between the two that cannot be reproduced locally. The
        // (req, res) handler is the invocation contract @vercel/node has
        // supported since the beginning; the object-with-fetch shape is the
        // newest and the only unproven variable left. Streaming is unaffected
        // — srvx's toNodeHandler pipes web ReadableStream bodies through, so
        // the SSE chat responses still stream. The entry itself needs the
        // one-line repair in fixNitroVercelNodeEntry() below.
        entryFormat: 'node',
        functions: {
          // Provisioning values a green deploy does NOT validate — they only
          // bite at invocation, as FUNCTION_INVOCATION_FAILED with nothing in
          // the build log. With the artifact itself proven healthy in an
          // isolated container, these are pinned to the most conservative GA
          // values while bringing the function up:
          //
          //   - runtime: nitro guesses from the BUILD machine's Node (24 on
          //     Vercel today), which is unrelated to what the account's
          //     function platform accepts. nodejs22.x matches .node-version
          //     and the engines field.
          //   - maxDuration 'max' and memory 2048 are dropped to platform
          //     defaults. The chat loop's wall clock is governed by
          //     CHAT_TIME_BUDGET_SECONDS (see aiChat.ts); raise these again
          //     one at a time once the function is serving.
          runtime: 'nodejs22.x',
        },
      },
    }),
    react(),
    // Upstream's Sentry org was hard-coded here, so any build with an auth
    // token in scope would have uploaded this fork's sourcemaps to someone
    // else's project. Env-driven now, and inert when SENTRY_AUTH_TOKEN is unset
    // (the plugin warns and skips), which is the local-dev case.
    sentryVitePlugin({
      org: process.env.SENTRY_ORG,
      project: process.env.SENTRY_PROJECT,
      authToken: process.env.SENTRY_AUTH_TOKEN,
      disable: !uploadsSourcemapsToSentry,
      // Without this the plugin throws on any upload failure — a wrong org
      // slug, an expired token, a Sentry outage — and takes the whole
      // deployment down with it. Sourcemap upload is observability, not a
      // build input; failing it must never fail the build. The warning still
      // lands in the build log for whoever set the credentials.
      errorHandler(error) {
        console.warn('[sentry] sourcemap upload failed (non-fatal):', error);
      },
      sourcemaps: {
        // Upload, then delete from the output: readable stack traces in Sentry
        // without publishing the source on the CDN.
        filesToDeleteAfterUpload: [
          'dist/**/*.map',
          '.output/**/*.map',
          '.vercel/output/**/*.map',
        ],
      },
    }),
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@shared': path.resolve(__dirname, './shared'),
      // Enter firebase-admin through its CJS implementation, skipping the
      // package's ESM shims — see the note on the nitro plugin above. Exact
      // subpath matches; only these four are imported (src/server).
      'firebase-admin/app': path.resolve(
        __dirname,
        'node_modules/firebase-admin/lib/app/index.js',
      ),
      'firebase-admin/auth': path.resolve(
        __dirname,
        'node_modules/firebase-admin/lib/auth/index.js',
      ),
      'firebase-admin/firestore': path.resolve(
        __dirname,
        'node_modules/firebase-admin/lib/firestore/index.js',
      ),
      'firebase-admin/storage': path.resolve(
        __dirname,
        'node_modules/firebase-admin/lib/storage/index.js',
      ),
    },
  },
  build: {
    chunkSizeWarningLimit: 1000,

    outDir: 'dist/cadam',
    emptyOutDir: true,

    // Production sourcemaps exist only to be uploaded to Sentry and then
    // deleted from the output (see the plugin's filesToDeleteAfterUpload).
    // With no auth token there is no upload, so the delete step never runs and
    // ~400 .map files would ship to the CDN — publishing the whole source and
    // most of the static payload. Generate them only when they have somewhere
    // to go. This is build-only; `vite dev` has its own sourcemaps regardless.
    sourcemap: uploadsSourcemapsToSentry,
  },
  environments: {
    client: {
      build: {
        outDir: 'dist/cadam',
        rollupOptions: {
          output: {
            manualChunks(id) {
              if (
                id.includes('/node_modules/react/') ||
                id.includes('/node_modules/react-dom/') ||
                id.includes('/node_modules/@tanstack/react-router/') ||
                id.includes('/node_modules/@tanstack/react-start/') ||
                id.includes('/node_modules/lucide-react/')
              ) {
                return 'vendor';
              }
            },
          },
        },
      },
    },
    server: {
      build: {
        outDir: 'dist/server',
      },
    },
  },
  preview: {
    port: 4173,
    host: true,
  },
  server: {
    port: 3000,
    open: false,
  },
  optimizeDeps: {
    exclude: ['@zip.js/zip.js', 'three', 'three-stdlib', '@sentry/vite-plugin'],
  },
});
