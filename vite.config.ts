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
        functions: {
          maxDuration: 'max',
          memory: 2048,
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
