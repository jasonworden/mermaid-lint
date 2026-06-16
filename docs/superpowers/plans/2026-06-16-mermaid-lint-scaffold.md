# mermaid-lint Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build and publish a 4-package pnpm monorepo that validates Mermaid diagrams in Markdown files, with a CLI tool and Vitest/Jest test-runner adapters.

**Architecture:** A shared `@mermaid-lint/core` package provides extraction, validation (via `mermaid.parse()` + jsdom), and file discovery. The `mermaid-lint` CLI and `@mermaid-lint/vitest`/`@mermaid-lint/jest` adapters each depend on core and add a thin integration layer.

**Tech Stack:** Node >=20, pnpm workspaces, ESM (.mjs), mermaid v11, jsdom, dompurify, vitest v2, jest v29, biome v1

---

## Task 1: Monorepo root scaffold

**Files:**
- Create: `package.json`
- Create: `pnpm-workspace.yaml`
- Create: `vitest.config.mjs`
- Create: `biome.json`
- Create: `.gitignore`
- Create: `packages/core/package.json`
- Create: `packages/cli/package.json`
- Create: `packages/vitest/package.json`
- Create: `packages/jest/package.json`

- [ ] **Step 1: Create root `package.json`**

```json
{
  "name": "mermaid-lint",
  "private": true,
  "type": "module",
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest",
    "lint": "biome check ."
  },
  "devDependencies": {
    "@biomejs/biome": "^1.9.4",
    "vitest": "^2.0.0"
  }
}
```

- [ ] **Step 2: Create `pnpm-workspace.yaml`**

```yaml
packages:
  - "packages/*"
```

- [ ] **Step 3: Create `vitest.config.mjs`**

```js
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: [
      'packages/core/test/**/*.test.mjs',
      'packages/cli/test/**/*.test.mjs',
      'packages/vitest/test/**/*.test.mjs',
    ],
  },
});
```

- [ ] **Step 4: Create `biome.json`**

```json
{
  "$schema": "https://biomejs.dev/schemas/1.9.4/schema.json",
  "files": {
    "ignore": ["**/node_modules", "**/pnpm-lock.yaml", "**/.git"]
  },
  "linter": {
    "enabled": true,
    "rules": {
      "recommended": true
    }
  },
  "formatter": {
    "enabled": true,
    "indentStyle": "space",
    "indentWidth": 2
  },
  "javascript": {
    "formatter": {
      "quoteStyle": "single",
      "trailingCommas": "all"
    }
  }
}
```

- [ ] **Step 5: Create `.gitignore`**

```
node_modules/
dist/
.DS_Store
*.local
```

- [ ] **Step 6: Create `packages/core/package.json`**

```json
{
  "name": "@mermaid-lint/core",
  "version": "0.1.0",
  "type": "module",
  "description": "Core extraction, validation, and discovery utilities for mermaid-lint",
  "exports": {
    ".": "./index.mjs"
  },
  "files": ["src", "index.mjs"],
  "engines": { "node": ">=20" },
  "dependencies": {
    "dompurify": "^3.2.6",
    "jsdom": "^26.1.0",
    "mermaid": "^11.8.1"
  }
}
```

- [ ] **Step 7: Create `packages/cli/package.json`**

```json
{
  "name": "mermaid-lint",
  "version": "0.1.0",
  "type": "module",
  "description": "Validate Mermaid diagrams in Markdown files",
  "bin": {
    "mermaid-lint": "./bin/mermaid-lint.mjs"
  },
  "files": ["bin"],
  "engines": { "node": ">=20" },
  "dependencies": {
    "@mermaid-lint/core": "workspace:*"
  }
}
```

- [ ] **Step 8: Create `packages/vitest/package.json`**

```json
{
  "name": "@mermaid-lint/vitest",
  "version": "0.1.0",
  "type": "module",
  "description": "Vitest adapter for mermaid-lint",
  "exports": {
    ".": "./index.mjs"
  },
  "files": ["index.mjs"],
  "engines": { "node": ">=20" },
  "peerDependencies": {
    "vitest": ">=1.0.0"
  },
  "dependencies": {
    "@mermaid-lint/core": "workspace:*"
  }
}
```

- [ ] **Step 9: Create `packages/jest/package.json`**

```json
{
  "name": "@mermaid-lint/jest",
  "version": "0.1.0",
  "type": "module",
  "description": "Jest adapter for mermaid-lint",
  "exports": {
    ".": "./index.mjs"
  },
  "files": ["index.mjs"],
  "engines": { "node": ">=20" },
  "peerDependencies": {
    "jest": ">=27.0.0"
  },
  "dependencies": {
    "@mermaid-lint/core": "workspace:*"
  },
  "devDependencies": {
    "@jest/globals": "^29.0.0",
    "jest": "^29.0.0",
    "jest-environment-node": "^29.0.0"
  },
  "scripts": {
    "test": "NODE_OPTIONS=--experimental-vm-modules jest"
  },
  "jest": {
    "testMatch": ["**/test/**/*.test.mjs"],
    "testEnvironment": "node",
    "extensionsToTreatAsEsm": [".mjs"],
    "transform": {}
  }
}
```

- [ ] **Step 10: Install dependencies**

```bash
cd ~/code/jw/mermaid-lint && pnpm install
```

Expected: lock file created, all packages installed.

- [ ] **Step 11: Commit**

```bash
git add package.json pnpm-workspace.yaml vitest.config.mjs biome.json .gitignore packages/core/package.json packages/cli/package.json packages/vitest/package.json packages/jest/package.json pnpm-lock.yaml
git commit -m "chore: scaffold monorepo with 4-package pnpm workspace"
```

---

## Task 2: `@mermaid-lint/core` — extract

**Files:**
- Create: `packages/core/src/extract.mjs`
- Create: `packages/core/test/extract.test.mjs`

- [ ] **Step 1: Write failing tests**

`packages/core/test/extract.test.mjs`:
```js
import { describe, it, expect } from 'vitest';
import { extractMermaidBlocks } from '../src/extract.mjs';

describe('extractMermaidBlocks', () => {
  it('extracts a single block', () => {
    const md = '# Doc\n\n```mermaid\nflowchart LR\n  A --> B\n```\n';
    const blocks = extractMermaidBlocks('test.md', md);
    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toMatchObject({
      path: 'test.md',
      line: 3,
      col: 1,
      body: 'flowchart LR\n  A --> B',
    });
  });

  it('returns empty array when no mermaid blocks', () => {
    const blocks = extractMermaidBlocks('test.md', '# No mermaid here\n');
    expect(blocks).toHaveLength(0);
  });

  it('marks unclosed fence with sentinel body', () => {
    const md = '```mermaid\nflowchart LR\n  A --> B\n';
    const blocks = extractMermaidBlocks('test.md', md);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].body).toBe('__UNCLOSED_FENCE__');
  });

  it('extracts multiple blocks in order', () => {
    const md = '```mermaid\nflowchart LR\n  A-->B\n```\n\n```mermaid\nsequenceDiagram\n  A->>B: hi\n```\n';
    const blocks = extractMermaidBlocks('test.md', md);
    expect(blocks).toHaveLength(2);
    expect(blocks[0].body).toContain('flowchart');
    expect(blocks[1].body).toContain('sequenceDiagram');
  });

  it('normalises CRLF line endings in body', () => {
    const md = '```mermaid\r\nflowchart LR\r\n  A-->B\r\n```\r\n';
    const blocks = extractMermaidBlocks('test.md', md);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].body).toBe('flowchart LR\n  A-->B');
  });

  it('accepts info-string after opening fence', () => {
    const md = '```mermaid {hl_lines="1"}\nflowchart LR\n  A-->B\n```\n';
    const blocks = extractMermaidBlocks('test.md', md);
    expect(blocks).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run tests — verify they fail**

```bash
cd ~/code/jw/mermaid-lint && pnpm test 2>&1 | head -20
```

Expected: `Cannot find module '../src/extract.mjs'`

- [ ] **Step 3: Implement `packages/core/src/extract.mjs`**

```js
const FENCE_RE = /^(\s*)```mermaid(\s.*)?$/;
const CLOSE_RE = /^\s*```\s*$/;

export function extractMermaidBlocks(path, text) {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const blocks = [];
  let i = 0;
  while (i < lines.length) {
    const m = FENCE_RE.exec(lines[i]);
    if (!m) { i++; continue; }
    const openerLine = i + 1;
    const col = m[1].length + 1;
    const bodyLines = [];
    i++;
    let closed = false;
    while (i < lines.length) {
      if (CLOSE_RE.test(lines[i])) { closed = true; break; }
      bodyLines.push(lines[i]);
      i++;
    }
    if (!closed) {
      blocks.push({ path, line: openerLine, col, body: '__UNCLOSED_FENCE__' });
    } else {
      blocks.push({ path, line: openerLine, col, body: bodyLines.join('\n') });
    }
    i++;
  }
  return blocks;
}
```

- [ ] **Step 4: Run tests — verify they pass**

```bash
cd ~/code/jw/mermaid-lint && pnpm test 2>&1 | grep -E "PASS|FAIL|✓|×"
```

Expected: all 6 extract tests pass.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/extract.mjs packages/core/test/extract.test.mjs
git commit -m "feat(core): add mermaid block extractor with tests"
```

---

## Task 3: `@mermaid-lint/core` — validate

**Files:**
- Create: `packages/core/src/validate.mjs`
- Create: `packages/core/test/validate.test.mjs`

- [ ] **Step 1: Write failing tests**

`packages/core/test/validate.test.mjs`:
```js
import { describe, it, expect } from 'vitest';
import { validateBlock } from '../src/validate.mjs';

describe('validateBlock', () => {
  it('accepts a valid flowchart', async () => {
    const result = await validateBlock('flowchart LR\n  A --> B');
    expect(result.ok).toBe(true);
  });

  it('accepts a valid sequenceDiagram', async () => {
    const result = await validateBlock('sequenceDiagram\n  Alice->>Bob: Hello');
    expect(result.ok).toBe(true);
  });

  it('rejects an empty block', async () => {
    const result = await validateBlock('');
    expect(result.ok).toBe(false);
    expect(result.error.message).toContain('empty');
  });

  it('rejects the unclosed fence sentinel', async () => {
    const result = await validateBlock('__UNCLOSED_FENCE__');
    expect(result.ok).toBe(false);
    expect(result.error.message).toContain('unclosed');
  });

  it('rejects invalid mermaid syntax', async () => {
    const result = await validateBlock('flowchart LR\n  A -->|broken label B');
    expect(result.ok).toBe(false);
    expect(result).toHaveProperty('error.message');
  });
});
```

- [ ] **Step 2: Run tests — verify they fail**

```bash
cd ~/code/jw/mermaid-lint && pnpm test 2>&1 | grep -E "validate|FAIL|Cannot"
```

Expected: `Cannot find module '../src/validate.mjs'`

- [ ] **Step 3: Implement `packages/core/src/validate.mjs`**

```js
// Mermaid v11 calls DOMPurify.sanitize during parse for some diagram types.
// DOMPurify requires a DOM window at module-evaluation time, so we bootstrap
// jsdom lazily before the first mermaid import via a dynamic import chain.
let _mermaidPromise = null;

async function loadMermaid() {
  if (!globalThis.window) {
    const { JSDOM } = await import('jsdom');
    const { window } = new JSDOM('');
    Object.defineProperty(globalThis, 'window', { value: window, writable: true, configurable: true });
    Object.defineProperty(globalThis, 'document', { value: window.document, writable: true, configurable: true });
    // sequenceDiagram `box` parser references bare `Option` (HTMLOptionElement),
    // which jsdom attaches to window but not globalThis.
    Object.defineProperty(globalThis, 'Option', { value: window.Option, writable: true, configurable: true });
  }
  const { default: mermaid } = await import('mermaid');
  mermaid.initialize({ startOnLoad: false, securityLevel: 'loose' });
  return mermaid;
}

function getMermaid() {
  if (!_mermaidPromise) _mermaidPromise = loadMermaid();
  return _mermaidPromise;
}

export async function validateBlock(body) {
  if (body === '__UNCLOSED_FENCE__') {
    return { ok: false, error: { message: 'unclosed ```mermaid fence (no closing ``` found)' } };
  }
  if (!body || !body.trim()) {
    return { ok: false, error: { message: 'empty mermaid block' } };
  }
  try {
    const mermaid = await getMermaid();
    await mermaid.parse(body, { suppressErrors: false });
    return { ok: true };
  } catch (err) {
    const message = err?.message ?? String(err);
    const line = typeof err?.hash?.line === 'number' ? err.hash.line : undefined;
    const col = typeof err?.hash?.loc?.first_column === 'number' ? err.hash.loc.first_column + 1 : undefined;
    return { ok: false, error: { message, line, col } };
  }
}
```

- [ ] **Step 4: Run tests — verify they pass**

```bash
cd ~/code/jw/mermaid-lint && pnpm test 2>&1 | grep -E "validate|✓|×|passed|failed"
```

Expected: all 5 validate tests pass. (These hit real mermaid.parse — expect ~2-5s first run.)

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/validate.mjs packages/core/test/validate.test.mjs
git commit -m "feat(core): add mermaid block validator with jsdom bootstrap"
```

---

## Task 4: `@mermaid-lint/core` — discover

**Files:**
- Create: `packages/core/src/discover.mjs`
- Create: `packages/core/test/discover.test.mjs`

- [ ] **Step 1: Write failing tests**

`packages/core/test/discover.test.mjs`:
```js
import { describe, it, expect } from 'vitest';
import { discoverFiles } from '../src/discover.mjs';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

describe('discoverFiles', () => {
  it('returns explicit paths that exist', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'mermaid-lint-'));
    const file = join(tmp, 'test.md');
    writeFileSync(file, '# test');
    expect(discoverFiles({ paths: [file] })).toContain(file);
  });

  it('filters out non-existent explicit paths', () => {
    expect(discoverFiles({ paths: ['/non/existent/file.md'] })).toHaveLength(0);
  });

  it('discovers all .md files with all:true', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'mermaid-lint-'));
    writeFileSync(join(tmp, 'a.md'), '# a');
    writeFileSync(join(tmp, 'b.md'), '# b');
    writeFileSync(join(tmp, 'c.txt'), 'not md');
    const result = discoverFiles({ root: tmp, all: true });
    expect(result).toHaveLength(2);
    expect(result.every(p => p.endsWith('.md'))).toBe(true);
  });

  it('skips node_modules with all:true', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'mermaid-lint-'));
    writeFileSync(join(tmp, 'real.md'), '# real');
    const nm = join(tmp, 'node_modules');
    mkdirSync(nm);
    writeFileSync(join(nm, 'ignored.md'), '# ignored');
    const result = discoverFiles({ root: tmp, all: true });
    expect(result.some(p => p.includes('node_modules'))).toBe(false);
  });

  it('returns empty array when git ls-files fails (not a git repo)', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'mermaid-lint-'));
    const result = discoverFiles({ root: tmp });
    expect(result).toEqual([]);
  });
});
```

- [ ] **Step 2: Run tests — verify they fail**

```bash
cd ~/code/jw/mermaid-lint && pnpm test 2>&1 | grep -E "discover|Cannot"
```

Expected: `Cannot find module '../src/discover.mjs'`

- [ ] **Step 3: Implement `packages/core/src/discover.mjs`**

```js
import { execFileSync, existsSync, readdirSync, statSync } from 'node:fs';

export function discoverFiles(opts = {}) {
  const { root = '.', all = false, paths } = opts;
  if (paths && paths.length > 0) {
    return paths.filter(p => {
      if (!existsSync(p)) return false;
      try { return statSync(p).isFile(); } catch { return false; }
    });
  }
  return all ? discoverAll(root) : discoverTracked(root);
}

function discoverTracked(root) {
  try {
    const out = execFileSync('git', ['ls-files', '-z', '--', '*.md'], {
      cwd: root,
      encoding: 'utf8',
    });
    return out.split('\0').filter(Boolean);
  } catch {
    return [];
  }
}

function discoverAll(root) {
  return readdirSync(root, { recursive: true, withFileTypes: true })
    .filter(e => e.isFile() && e.name.endsWith('.md'))
    .map(e => `${e.parentPath ?? e.path}/${e.name}`)
    .filter(p => !p.includes('/node_modules/') && !p.includes('/.git/'));
}
```

- [ ] **Step 4: Run tests — verify they pass**

```bash
cd ~/code/jw/mermaid-lint && pnpm test 2>&1 | grep -E "discover|✓|×|passed|failed"
```

Expected: all 5 discover tests pass.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/discover.mjs packages/core/test/discover.test.mjs
git commit -m "feat(core): add file discovery (git-tracked, --all, explicit paths)"
```

---

## Task 5: `@mermaid-lint/core` — wire package

**Files:**
- Create: `packages/core/index.mjs`

- [ ] **Step 1: Create `packages/core/index.mjs`**

```js
export { extractMermaidBlocks } from './src/extract.mjs';
export { validateBlock } from './src/validate.mjs';
export { discoverFiles } from './src/discover.mjs';
```

- [ ] **Step 2: Verify all core tests still pass**

```bash
cd ~/code/jw/mermaid-lint && pnpm test 2>&1 | tail -5
```

Expected: all tests pass, no failures.

- [ ] **Step 3: Commit**

```bash
git add packages/core/index.mjs
git commit -m "feat(core): wire package exports"
```

---

## Task 6: `mermaid-lint` CLI

**Files:**
- Create: `packages/cli/bin/mermaid-lint.mjs`
- Create: `packages/cli/test/cli.test.mjs`

- [ ] **Step 1: Write failing tests**

`packages/cli/test/cli.test.mjs`:
```js
import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

// import.meta.dirname = packages/cli/test — go up one level to reach packages/cli/bin/
const BIN = resolve(import.meta.dirname, '../bin/mermaid-lint.mjs');

function run(args, cwd) {
  return spawnSync('node', [BIN, ...args], { cwd, encoding: 'utf8' });
}

describe('mermaid-lint CLI', () => {
  it('exits 0 for a file with a valid diagram', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'mermaid-lint-'));
    writeFileSync(join(tmp, 'valid.md'), '```mermaid\nflowchart LR\n  A --> B\n```\n');
    const r = run([join(tmp, 'valid.md')], tmp);
    expect(r.status).toBe(0);
  });

  it('exits 1 for a file with an invalid diagram', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'mermaid-lint-'));
    writeFileSync(join(tmp, 'bad.md'), '```mermaid\nflowchart LR\n  A -->|broken\n```\n');
    const r = run([join(tmp, 'bad.md')], tmp);
    expect(r.status).toBe(1);
    expect(r.stdout).toContain('parse error');
  });

  it('exits 2 when no files matched', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'mermaid-lint-'));
    const r = run(['/nonexistent/file.md'], tmp);
    expect(r.status).toBe(2);
  });

  it('prints --help without error', () => {
    const r = run(['--help'], '.');
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('Usage:');
  });

  it('--quiet suppresses per-file progress', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'mermaid-lint-'));
    writeFileSync(join(tmp, 'ok.md'), '```mermaid\nflowchart LR\n  A-->B\n```\n');
    const noisy = run([join(tmp, 'ok.md')], tmp);
    const quiet = run(['--quiet', join(tmp, 'ok.md')], tmp);
    expect(quiet.stderr.length).toBeLessThan(noisy.stderr.length);
  });
});
```

- [ ] **Step 2: Run tests — verify they fail**

```bash
cd ~/code/jw/mermaid-lint && pnpm test 2>&1 | grep -E "cli|Cannot|FAIL"
```

Expected: error about missing `bin/mermaid-lint.mjs`.

- [ ] **Step 3: Implement `packages/cli/bin/mermaid-lint.mjs`**

```js
#!/usr/bin/env node
import { readFileSync, existsSync, statSync } from 'node:fs';
import { discoverFiles, extractMermaidBlocks, validateBlock } from '@mermaid-lint/core';

function parseArgs(argv) {
  const args = { quiet: false, all: false, paths: [], help: false, error: null };
  for (const a of argv) {
    if (a === '--quiet') args.quiet = true;
    else if (a === '--all') args.all = true;
    else if (a === '--help' || a === '-h') args.help = true;
    else if (a.startsWith('--')) { args.error = `unknown flag: ${a}`; break; }
    else args.paths.push(a);
  }
  return args;
}

function printHelp() {
  process.stdout.write(`Usage: mermaid-lint [--all] [--quiet] [paths...]

  paths      Files to validate. Overrides default discovery.
  (no args)  Default: git-tracked *.md files.
  --all      Scan every *.md on disk; skips node_modules/.
  --quiet    Suppress per-file progress; only failures + summary.

Exit codes:
  0  all blocks valid
  1  one or more blocks failed validation
  2  usage error, IO error, or no markdown files found
`);
}

async function main(argv) {
  const args = parseArgs(argv);
  if (args.help) { printHelp(); return 0; }
  if (args.error) { process.stderr.write(`${args.error}\n`); printHelp(); return 2; }

  const files = discoverFiles({ all: args.all, paths: args.paths.length ? args.paths : undefined });

  if (files.length === 0) {
    process.stderr.write(
      args.paths.length > 0
        ? 'no markdown files matched the given paths\n'
        : args.all
          ? 'no markdown files found on disk\n'
          : 'no tracked markdown files found (is this a git checkout? try --all)\n',
    );
    return 2;
  }

  let blockCount = 0;
  let failures = 0;

  for (const file of files) {
    if (!args.quiet) process.stderr.write(`scanning ${file}\n`);
    let text;
    try {
      text = readFileSync(file, 'utf8');
    } catch (err) {
      failures++;
      process.stdout.write(`${file}:0:0: parse error: cannot read file: ${err.message}\n`);
      continue;
    }
    const blocks = extractMermaidBlocks(file, text);
    for (const block of blocks) {
      blockCount++;
      const r = await validateBlock(block.body);
      if (!r.ok) {
        failures++;
        const loc = r.error.line != null ? `:${r.error.line}` : '';
        const msg = r.error.message.replace(/\s*\n\s*/g, ' | ');
        process.stdout.write(`${block.path}:${block.line}:${block.col}${loc}: parse error: ${msg}\n`);
      }
    }
  }

  process.stderr.write(
    `checked ${blockCount} diagram${blockCount !== 1 ? 's' : ''} in ${files.length} file${files.length !== 1 ? 's' : ''} — ${failures === 0 ? 'all valid' : `${failures} failure${failures !== 1 ? 's' : ''}`}\n`,
  );
  return failures > 0 ? 1 : 0;
}

const code = await main(process.argv.slice(2));
process.exit(code);
```

- [ ] **Step 4: Make the bin executable**

```bash
chmod +x ~/code/jw/mermaid-lint/packages/cli/bin/mermaid-lint.mjs
```

- [ ] **Step 5: Run tests — verify they pass**

```bash
cd ~/code/jw/mermaid-lint && pnpm test 2>&1 | tail -10
```

Expected: all CLI tests pass.

- [ ] **Step 6: Commit**

```bash
git add packages/cli/bin/mermaid-lint.mjs packages/cli/test/cli.test.mjs
git commit -m "feat(cli): add mermaid-lint bin with --all, --quiet, exit codes"
```

---

## Task 7: `@mermaid-lint/vitest` adapter

**Files:**
- Create: `packages/vitest/index.mjs`
- Create: `packages/vitest/test/integration.test.mjs`

- [ ] **Step 1: Write failing integration test**

`packages/vitest/test/integration.test.mjs`:
```js
// Module-level call mirrors real-world usage: drop into any test file.
import { defineMermaidTests } from '../index.mjs';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const tmp = mkdtempSync(join(tmpdir(), 'mermaid-lint-vitest-'));
const file = join(tmp, 'valid.md');
writeFileSync(file, '# Test\n\n```mermaid\nflowchart LR\n  A --> B\n```\n');

// Registers "Mermaid diagrams" describe block with it.each — Vitest picks it up.
defineMermaidTests({ paths: [file] });
```

- [ ] **Step 2: Run tests — verify they fail**

```bash
cd ~/code/jw/mermaid-lint && pnpm test 2>&1 | grep -E "vitest|integration|Cannot"
```

Expected: `Cannot find module '../index.mjs'`

- [ ] **Step 3: Implement `packages/vitest/index.mjs`**

```js
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { discoverFiles, extractMermaidBlocks, validateBlock } from '@mermaid-lint/core';

export function defineMermaidTests(opts = {}) {
  const files = discoverFiles(opts);
  const blocks = [];
  for (const file of files) {
    const text = readFileSync(file, 'utf8');
    blocks.push(...extractMermaidBlocks(file, text));
  }

  describe('Mermaid diagrams', () => {
    it('finds at least one diagram', () => {
      expect(blocks.length, 'no mermaid blocks found').toBeGreaterThan(0);
    });

    it.each(blocks)('$path:$line is valid', async ({ path, line, body }) => {
      const result = await validateBlock(body);
      expect(result.ok, `${path}:${line}: ${result.ok ? '' : result.error.message}`).toBe(true);
    });
  });
}
```

- [ ] **Step 4: Run tests — verify they pass**

```bash
cd ~/code/jw/mermaid-lint && pnpm test 2>&1 | tail -10
```

Expected: integration test suite passes (2 tests: "finds at least one diagram" + "valid.md:3:1 is valid").

- [ ] **Step 5: Commit**

```bash
git add packages/vitest/index.mjs packages/vitest/test/integration.test.mjs
git commit -m "feat(vitest): add defineMermaidTests adapter"
```

---

## Task 8: `@mermaid-lint/jest` adapter

**Files:**
- Create: `packages/jest/index.mjs`
- Create: `packages/jest/test/integration.test.mjs`

- [ ] **Step 1: Write failing integration test**

`packages/jest/test/integration.test.mjs`:
```js
import { defineMermaidTests } from '../index.mjs';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const tmp = mkdtempSync(join(tmpdir(), 'mermaid-lint-jest-'));
const file = join(tmp, 'valid.md');
writeFileSync(file, '# Test\n\n```mermaid\nflowchart LR\n  A --> B\n```\n');

defineMermaidTests({ paths: [file] });
```

- [ ] **Step 2: Run Jest — verify it fails**

```bash
cd ~/code/jw/mermaid-lint/packages/jest && pnpm install && pnpm test 2>&1 | head -15
```

Expected: `Cannot find module '../index.mjs'`

- [ ] **Step 3: Implement `packages/jest/index.mjs`**

```js
import { readFileSync } from 'node:fs';
import { describe, expect, test } from '@jest/globals';
import { discoverFiles, extractMermaidBlocks, validateBlock } from '@mermaid-lint/core';

export function defineMermaidTests(opts = {}) {
  const files = discoverFiles(opts);
  const blocks = [];
  for (const file of files) {
    const text = readFileSync(file, 'utf8');
    blocks.push(...extractMermaidBlocks(file, text));
  }

  describe('Mermaid diagrams', () => {
    test('finds at least one diagram', () => {
      expect(blocks.length).toBeGreaterThan(0);
    });

    test.each(blocks)('$path:$line is valid', async ({ path, line, body }) => {
      const result = await validateBlock(body);
      if (!result.ok) throw new Error(`${path}:${line}: ${result.error.message}`);
      expect(result.ok).toBe(true);
    });
  });
}
```

- [ ] **Step 4: Run Jest — verify it passes**

```bash
cd ~/code/jw/mermaid-lint/packages/jest && pnpm test 2>&1 | tail -10
```

Expected: all tests pass. (Requires `NODE_OPTIONS=--experimental-vm-modules` — already set in the `test` script in `package.json`.)

- [ ] **Step 5: Commit**

```bash
cd ~/code/jw/mermaid-lint
git add packages/jest/index.mjs packages/jest/test/integration.test.mjs
git commit -m "feat(jest): add defineMermaidTests adapter"
```

---

## Task 9: GitHub Actions CI

**Files:**
- Create: `.github/workflows/ci.yml`

- [ ] **Step 1: Create `.github/workflows/ci.yml`**

```yaml
name: CI

on:
  push:
    branches: [main]
  pull_request:

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: pnpm/action-setup@v4
        with:
          version: 10

      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'pnpm'

      - name: Install dependencies
        run: pnpm install

      - name: Lint
        run: pnpm lint

      - name: Test (vitest — core, cli, vitest adapter)
        run: pnpm test

      - name: Test (jest adapter)
        run: pnpm --filter @mermaid-lint/jest test

  publish:
    needs: test
    runs-on: ubuntu-latest
    if: startsWith(github.ref, 'refs/tags/v')
    steps:
      - uses: actions/checkout@v4

      - uses: pnpm/action-setup@v4
        with:
          version: 10

      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          registry-url: 'https://registry.npmjs.org'
          cache: 'pnpm'

      - run: pnpm install

      - run: pnpm -r publish --access public --no-git-checks
        env:
          NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}
```

- [ ] **Step 2: Verify lint passes locally before pushing**

```bash
cd ~/code/jw/mermaid-lint && pnpm lint
```

Fix any biome warnings before committing.

- [ ] **Step 3: Verify all tests pass locally**

```bash
cd ~/code/jw/mermaid-lint && pnpm test && pnpm --filter @mermaid-lint/jest test
```

Expected: all suites green.

- [ ] **Step 4: Commit and push**

```bash
git add .github/workflows/ci.yml
git commit -m "ci: add GitHub Actions workflow for test + publish"
git push origin main
```

- [ ] **Step 5: Verify CI passes on GitHub**

```bash
gh run list --repo jasonworden/mermaid-lint --limit 3
```

Watch for the run to complete green.
