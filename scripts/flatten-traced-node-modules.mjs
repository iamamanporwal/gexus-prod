#!/usr/bin/env node
// Runs as `postbuild`, so every `npm run build` — local or on Vercel — gets it.
//
// Nitro traces externalized server dependencies (vite.config.ts traceDeps)
// into the build output with nf3, which lays them out as a `.nf3/` store of
// versioned package dirs plus symlinks from the expected node_modules paths.
// Two properties of that layout do not survive deployment:
//
//   - On Windows the links are junctions, which always record absolute paths.
//   - On Vercel, the links resolve against /vercel/path0/... at build time,
//     but the function executes from /var/task — every link dangles, the
//     entry's static `import "firebase-admin/app"` throws at cold start, and
//     each request dies as FUNCTION_INVOCATION_FAILED before reaching the app.
//
// Fix: after the build, replace each symlink with a real copy of its target
// and drop the store, leaving a self-contained node_modules that resolves the
// same way on any host. Idempotent — a tree with no symlinks is a no-op.

import fs from 'node:fs';
import path from 'node:path';

const OUTPUT_ROOTS = [
  '.vercel/output/functions/__server.func', // vercel preset
  '.output/server', //                         node-server preset
];

const STORE_DIR = '.nf3';

function collectSymlinks(dir, found) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === STORE_DIR) continue; // deleted wholesale below
    const full = path.join(dir, entry.name);
    if (entry.isSymbolicLink()) {
      found.push(full);
    } else if (entry.isDirectory()) {
      collectSymlinks(full, found);
    }
  }
  return found;
}

function removeLink(link) {
  try {
    fs.unlinkSync(link);
  } catch {
    // Windows directory junctions sometimes refuse unlink; rmdir removes the
    // junction itself without touching its target.
    fs.rmdirSync(link);
  }
}

let sawOutput = false;

for (const root of OUTPUT_ROOTS) {
  const nodeModules = path.resolve(root, 'node_modules');
  if (!fs.existsSync(nodeModules)) continue;
  sawOutput = true;

  const links = collectSymlinks(nodeModules, []);
  for (const link of links) {
    // realpath resolves junctions, relative links, and chains through the
    // store; dereference:true also flattens any links inside the target.
    const target = fs.realpathSync(link);
    removeLink(link);
    fs.cpSync(target, link, { recursive: true, dereference: true });
  }

  const store = path.join(nodeModules, STORE_DIR);
  if (fs.existsSync(store)) fs.rmSync(store, { recursive: true, force: true });

  const leftover = collectSymlinks(nodeModules, []);
  if (leftover.length > 0) {
    console.error(`[flatten-traced] ${root}: symlinks remain after flatten:`);
    for (const l of leftover) console.error(`  - ${l}`);
    process.exit(1);
  }

  console.log(
    `[flatten-traced] ${root}: materialized ${links.length} symlinks, removed ${STORE_DIR}/`,
  );
}

if (!sawOutput) {
  console.log('[flatten-traced] no build output found; nothing to do');
}
