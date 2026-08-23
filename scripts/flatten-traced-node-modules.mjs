#!/usr/bin/env node
// Runs as `postbuild`, so every `npm run build` — local or on Vercel — gets it.
//
// Nitro traces externalized server dependencies (vite.config.ts traceDeps)
// into the build output with nf3, which lays them out as a `.nf3/` store of
// versioned package dirs plus symlinks from the expected node_modules paths.
// That layout does not survive deployment: on Vercel the links resolve
// against /vercel/path0/... at build time, but the function executes from
// /var/task — every link dangles, the entry's static
// `import "firebase-admin/app"` throws at cold start, and each request dies
// as FUNCTION_INVOCATION_FAILED before reaching the app.
//
// Fix: after the build, replace each symlink with a real copy of its target
// and drop the store, leaving a self-contained node_modules that resolves
// the same way on any host. Idempotent — a tree with no symlinks is a no-op.
//
// The copy is hand-rolled rather than fs.cpSync({ dereference: true })
// because cpSync only dereferences the top-level path: symlinks nested
// inside the copied tree are recreated as symlinks (nodejs/node#41586).
// nf3's Linux layout nests exactly such links (store packages carry their
// own node_modules of version-conflicted deps), which is how the first
// deploy of this script failed its own verification on Vercel while
// passing on Windows, where nf3's junction layout keeps every link
// top-level. copyReal stats through links at every depth, so the result
// contains none regardless of layout.

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

/** Copy src to dst following every symlink, at any depth, to real content. */
function copyReal(src, dst) {
  const stat = fs.statSync(src); // statSync resolves symlinks
  if (stat.isDirectory()) {
    fs.mkdirSync(dst, { recursive: true });
    for (const name of fs.readdirSync(src)) {
      copyReal(path.join(src, name), path.join(dst, name));
    }
  } else {
    fs.copyFileSync(src, dst); // preserves the file mode (.bin executables)
  }
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
    const target = fs.realpathSync(link);
    removeLink(link);
    copyReal(target, link);
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
