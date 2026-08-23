#!/usr/bin/env node
// Runs as `postbuild`, so every `npm run build` — local or on Vercel — gets
// it. Makes the built server function runnable on a host that has ONLY the
// function directory: no repo node_modules above it, no symlink targets
// outside it, no runtime module resolution that can miss.
//
// Two jobs:
//
// 1. FLATTEN nitro's traced dependencies. nf3 lays traced packages out as a
//    `.nf3/` store plus symlinks; on Vercel the links resolve against the
//    build machine's paths (/vercel/path0/...) while the function runs from
//    /var/task, so every link dangles. Each symlink is replaced with a real
//    copy of its target (dereferenced by hand at every depth — cpSync's
//    `dereference` only applies to the top-level path, nodejs/node#41586).
//
// 2. VENDOR the bundle's runtime externals. Rolldown leaves bare-package
//    `require()` calls made from CommonJS files inside node_modules as
//    runtime requires (`__require("google-auth-library")` and friends —
//    firebase-admin's dependency set, pulled in when its CJS entries are
//    bundled via the vite aliases). The bundle is scanned for those ids and
//    each package is npm-installed into the function at the exact version
//    from the repo's node_modules, producing a bog-standard CJS tree.
//
//    One pin: jose is forced to v5 in the vendored tree. jwks-rsa requires
//    jose from CommonJS; jose v6 is ESM-only, which modern Node handles via
//    require(esm) but Vercel's /opt/rust/nodejs.js loader does not
//    (ERR_REQUIRE_ESM at cold start — the FUNCTION_INVOCATION_FAILED that
//    took the site down). jose v5 ships real CJS, and the two calls jwks-rsa
//    makes (importJWK, exportSPKI) are identical in both majors.

import fs from 'node:fs';
import path from 'node:path';
import { builtinModules } from 'node:module';
import { spawnSync } from 'node:child_process';

const OUTPUT_ROOTS = [
  '.vercel/output/functions/__server.func', // vercel preset
  '.output/server', //                         node-server preset
];

const STORE_DIR = '.nf3';
const BUILTINS = new Set(builtinModules);
const JOSE_OVERRIDE = '^5.10.0';

// ── 1. flatten ─────────────────────────────────────────────────────────────

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

function flatten(root, nodeModules) {
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
    console.error(`[self-contained] ${root}: symlinks remain after flatten:`);
    for (const l of leftover) console.error(`  - ${l}`);
    process.exit(1);
  }
  return links.length;
}

// ── 2. vendor ──────────────────────────────────────────────────────────────

function packageName(id) {
  const parts = id.split('/');
  return id.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0];
}

/** Bare package ids the bundle resolves at runtime instead of bundling. */
function scanRuntimeExternals(bundlePath) {
  const code = fs.readFileSync(bundlePath, 'utf8');
  const found = new Set();
  // createRequire calls emitted for CJS requires rolldown left external.
  const requireRe = /__require(?:\$\d+)?\(["']([^"'\n]+)["']\)/g;
  for (const m of code.matchAll(requireRe)) found.add(m[1]);
  // Static ESM imports of bare specifiers that survived bundling (tslib).
  const importRe = /^import[^\n"']*["']([a-z@][^"'\n]*)["'];?$/gm;
  for (const m of code.matchAll(importRe)) found.add(m[1]);

  const packages = new Set();
  for (const id of found) {
    if (id.startsWith('node:')) continue;
    const name = packageName(id);
    if (BUILTINS.has(name)) continue;
    packages.add(name);
  }
  return [...packages].sort();
}

function repoVersionOf(name) {
  const manifest = path.resolve('node_modules', name, 'package.json');
  if (!fs.existsSync(manifest)) {
    console.error(
      `[self-contained] bundle requires "${name}" at runtime but it is not ` +
        `installed in the repo — cannot pin a version`,
    );
    process.exit(1);
  }
  return JSON.parse(fs.readFileSync(manifest, 'utf8')).version;
}

function vendor(root, nodeModules, packages) {
  const manifestPath = path.join(root, 'package.json');
  const manifest = fs.existsSync(manifestPath)
    ? JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
    : { name: 'server-function', version: '1.0.0', private: true };

  manifest.dependencies = manifest.dependencies ?? {};
  for (const name of packages) {
    manifest.dependencies[name] = repoVersionOf(name);
  }
  manifest.overrides = { ...manifest.overrides, jose: JOSE_OVERRIDE };
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');

  const result = spawnSync(
    process.platform === 'win32' ? 'npm.cmd' : 'npm',
    [
      'install',
      '--omit=dev',
      '--no-audit',
      '--no-fund',
      '--no-package-lock',
      '--ignore-scripts',
      '--loglevel=error',
    ],
    { cwd: root, stdio: 'inherit', shell: process.platform === 'win32' },
  );
  if (result.status !== 0) {
    console.error(`[self-contained] ${root}: npm install failed`);
    process.exit(result.status ?? 1);
  }

  // Hard verification: every scanned external must now resolve, and any jose
  // in the tree must be the CJS-shipping v5 line.
  for (const name of packages) {
    if (!fs.existsSync(path.join(nodeModules, name, 'package.json'))) {
      console.error(
        `[self-contained] ${root}: "${name}" missing after install`,
      );
      process.exit(1);
    }
  }
  const joseDirs = [
    path.join(nodeModules, 'jose'),
    path.join(nodeModules, 'jwks-rsa', 'node_modules', 'jose'),
  ].filter((dir) => fs.existsSync(path.join(dir, 'package.json')));
  for (const dir of joseDirs) {
    const manifestJson = fs.readFileSync(
      path.join(dir, 'package.json'),
      'utf8',
    );
    const version = JSON.parse(manifestJson).version;
    if (!version.startsWith('5.')) {
      console.error(
        `[self-contained] ${root}: jose@${version} in vendored tree — the ` +
          `v5 override did not take, require('jose') would hit ESM again`,
      );
      process.exit(1);
    }
  }
}

// ── main ───────────────────────────────────────────────────────────────────

let sawOutput = false;

for (const root of OUTPUT_ROOTS) {
  const resolvedRoot = path.resolve(root);
  const bundle = path.join(resolvedRoot, 'index.mjs');
  if (!fs.existsSync(bundle)) continue;
  sawOutput = true;

  const nodeModules = path.join(resolvedRoot, 'node_modules');
  fs.mkdirSync(nodeModules, { recursive: true });

  const materialized = flatten(root, nodeModules);
  const packages = scanRuntimeExternals(bundle);
  if (packages.length > 0) vendor(resolvedRoot, nodeModules, packages);

  console.log(
    `[self-contained] ${root}: ${materialized} symlinks materialized, ` +
      `vendored [${packages.join(', ')}]`,
  );
}

if (!sawOutput) {
  console.log('[self-contained] no build output found; nothing to do');
}
