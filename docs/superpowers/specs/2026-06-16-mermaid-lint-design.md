# mermaid-lint design

**Date:** 2026-06-16
**Repo:** `git@github.com:jasonworden/mermaid-lint.git`

## Problem

Mermaid diagrams embedded in Markdown files can contain syntax errors that only surface at render time. Existing tools either require a separate CI step (CLI-only) or do shallow keyword-only validation. Nothing integrates directly into a Vitest or Jest test suite with zero configuration.

## Prior art

| Tool | Validation | Discovery | Test runner | Deps |
|------|-----------|-----------|-------------|------|
| `md-mermaid-lint` | `mermaid.parse()` | glob | none | mermaid + jsdom + puppeteer + canvas |
| `mermaid-md-check` (internal) | `mermaid.parse()` | git ls-files / --all | none | mermaid + jsdom + dompurify |
| `mermaid-markdown.test.mjs` (blog) | opener keyword only | git ls-files | Vitest | none |

`mermaid-lint` combines `mermaid-md-check`'s real-parse validation with test-runner integration, and publishes the CLI as a first-class artifact.

## Architecture

4-package pnpm workspace:

```
mermaid-lint/
├── packages/
│   ├── core/     — extract + validate + discover
│   ├── cli/      — bin tool
│   ├── vitest/   — Vitest adapter
│   └── jest/     — Jest adapter
├── package.json  (workspace root)
└── .github/workflows/ci.yml
```

## Packages

### `@mermaid-lint/core`

The shared foundation. Direct lift and clean-up of `extract.mjs` + `validate.mjs` from `mermaid-md-check` (TinderEngineering/architecture#1890), plus a `discoverFiles(opts?)` function.

**Exports:**
```ts
extractMermaidBlocks(path: string, text: string): Block[]
validateBlock(body: string): Promise<ValidationResult>
discoverFiles(opts?: DiscoverOptions): string[]
```

**`DiscoverOptions`:**
```ts
{
  root?: string      // default: cwd
  all?: boolean      // scan all *.md on disk (skip node_modules/.git); default: git ls-files
  paths?: string[]   // explicit file list; takes precedence over all/default
}
```

**`Block`:** `{ path: string, line: number, col: number, body: string }`
**`ValidationResult`:** `{ ok: true } | { ok: false, error: { message: string, line?: number, col?: number } }`

Validation uses `mermaid.parse()` via a lazily-bootstrapped jsdom window (same singleton pattern as `mermaid-md-check` — bootstrapped once, cached promise).

**Deps:** `mermaid`, `jsdom`, `dompurify`
**Node:** `>=20`

---

### `mermaid-lint` (CLI)

Thin bin wrapper over `@mermaid-lint/core`. Essentially `mermaid-md-check.mjs` renamed and pointed at the published core.

**Usage:**
```bash
npx mermaid-lint               # git-tracked *.md (default)
npx mermaid-lint --all         # every *.md on disk
npx mermaid-lint docs/**/*.md  # explicit paths
npx mermaid-lint --quiet       # suppress per-file progress
```

**Exit codes:** `0` = clean, `1` = validation failures, `2` = usage/IO error

**Dep:** `@mermaid-lint/core`

---

### `@mermaid-lint/vitest`

Registers a `describe` / `it.each` suite that discovers and validates all Mermaid blocks. Designed to be called from a test file — no separate config needed.

**Usage:**
```ts
// mermaid.test.ts
import { defineMermaidTests } from '@mermaid-lint/vitest'
defineMermaidTests()
defineMermaidTests({ root: '/path/to/docs' })
```

Internally calls `discoverFiles` + `validateBlock` from core, then:
```ts
describe('Mermaid diagrams', () => {
  it('finds at least one diagram', ...)
  it.each(blocks)('$path:$line is valid', ...)
})
```

**Peer dep:** `vitest >= 1.0`
**Dep:** `@mermaid-lint/core`

---

### `@mermaid-lint/jest`

Identical API to the Vitest adapter. Swaps `vitest` for `@jest/globals` imports (`describe`, `it`, `expect`).

**Usage:**
```ts
import { defineMermaidTests } from '@mermaid-lint/jest'
defineMermaidTests()
```

**Peer dep:** `jest >= 27`
**Dep:** `@mermaid-lint/core`

---

## Monorepo tooling

- **Package manager:** pnpm workspaces
- **Build:** none (pure ESM `.mjs`, no compile step)
- **Tests:** vitest at workspace root (covers core + vitest adapter; Jest adapter tested by running jest in its own package)
- **Lint/format:** biome (matches jasonworden.github.io conventions)
- **Publish:** `pnpm -r publish` on version tag via GitHub Actions
- **Node range:** `>=20` across all packages

## CI

Single workflow (`.github/workflows/ci.yml`):
1. Install (`pnpm install`)
2. Lint (`biome check`)
3. Test (`vitest run` at root + `jest` in `packages/jest`)
4. On `v*` tag: `pnpm -r publish --access public`

## What this gives over existing tools

- **vs `md-mermaid-lint`:** lighter deps (no puppeteer/canvas), git-aware discovery, test-runner integration
- **vs `mermaid-md-check`:** published, test-runner integration, Jest support
- **vs `mermaid-markdown.test.mjs`:** real syntax validation (not just opener keyword), framework-agnostic core, works in any repo without copy-paste
