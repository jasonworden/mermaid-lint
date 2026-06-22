#!/usr/bin/env node
// Guard the generated API docs against Cloudflare Pages reserved-path collisions.
//
// Cloudflare Pages treats a top-level `functions/` directory as Pages Functions
// (server-side code) and a top-level `_worker.js` as an advanced-mode Worker.
// Either one makes `wrangler pages deploy` drop those paths from the static
// asset upload — the pages then 404 and fall back to the unstyled SPA index.
//
// TypeDoc's default "kind" router emits members into per-kind dirs (functions/,
// classes/, …), so `functions/` lands at the deploy root and breaks. We use the
// "structure" router (see packages/core/typedoc.json) to avoid it. This script
// fails the build if a reserved entry ever reappears at the docs root, so a
// config regression is caught in CI instead of silently shipping broken docs.
//
// Usage: node scripts/check-docs-cloudflare-safe.mjs <docs-dir>

import { existsSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

// Top-level entries that change how Cloudflare Pages serves a deployment.
// `_redirects`, `_headers`, and `_routes.json` are legitimate Pages config
// files and are intentionally NOT flagged.
const RESERVED = [
  { name: 'functions', kind: 'dir' },
  { name: '_worker.js', kind: 'file' },
];

function main(argv) {
  const docsDir = argv[2];
  if (!docsDir) {
    console.error(
      'usage: node scripts/check-docs-cloudflare-safe.mjs <docs-dir>',
    );
    return 2;
  }

  const root = resolve(docsDir);
  if (!existsSync(root)) {
    console.error(`docs directory not found: ${root}`);
    console.error(
      'Build the docs first: pnpm --filter @mermaid-lint/core docs',
    );
    return 2;
  }

  const offenders = [];
  for (const entry of RESERVED) {
    const path = join(root, entry.name);
    if (!existsSync(path)) continue;
    const isDir = statSync(path).isDirectory();
    if ((entry.kind === 'dir') === isDir) offenders.push(entry.name);
  }

  if (offenders.length > 0) {
    console.error(
      `✗ Cloudflare Pages reserved path(s) at the docs root: ${offenders.join(', ')}`,
    );
    console.error(
      'These get dropped from the static deploy (treated as Pages Functions / a Worker),',
    );
    console.error(
      'so the affected pages render unstyled. Keep "router": "structure" in',
    );
    console.error(
      'packages/core/typedoc.json. See docs/cloudflare-docs-setup.md.',
    );
    return 1;
  }

  console.error(`✓ docs root is Cloudflare Pages safe (${root})`);
  return 0;
}

process.exit(main(process.argv));
