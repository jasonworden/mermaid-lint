# mermaid-lint

Validate Mermaid diagrams embedded in Markdown files. Uses the official `mermaid.parse()` API — catches real syntax errors, not just missing diagram-type keywords.

## Packages

| Package | npm | Description |
|---|---|---|
| [`@mermaid-lint/cli`](packages/cli) | [![npm](https://img.shields.io/npm/v/@mermaid-lint/cli.svg)](https://www.npmjs.com/package/@mermaid-lint/cli) | CLI — `npx mermaid-lint` |
| [`@mermaid-lint/vitest`](packages/vitest) | [![npm](https://img.shields.io/npm/v/@mermaid-lint/vitest.svg)](https://www.npmjs.com/package/@mermaid-lint/vitest) | Vitest adapter |
| [`@mermaid-lint/jest`](packages/jest) | [![npm](https://img.shields.io/npm/v/@mermaid-lint/jest.svg)](https://www.npmjs.com/package/@mermaid-lint/jest) | Jest adapter |
| [`@mermaid-lint/core`](packages/core) | [![npm](https://img.shields.io/npm/v/@mermaid-lint/core.svg)](https://www.npmjs.com/package/@mermaid-lint/core) | Core utilities (extract, validate, discover) |

## CLI

```bash
npx mermaid-lint                        # validate git-tracked *.md / *.mdx / *.markdown / *.mmd
npx mermaid-lint --all                  # scan every supported file on disk
npx mermaid-lint "docs/**/*.md"         # glob pattern (quoted to prevent shell expansion)
npx mermaid-lint --quiet                # failures only
npx mermaid-lint --format json          # machine-readable JSON output
npx mermaid-lint --strict               # treat semantic warnings as errors (exit 1)
npx mermaid-lint --no-semantic          # skip semantic checks (syntax errors only)
```

**Exit codes:** `0` = all valid · `1` = validation failures (or warnings with `--strict`) · `2` = usage/IO error

### JSON output schema

```json
{
  "version": "0.3.0",
  "files": [
    {
      "path": "docs/api.md",
      "diagrams": [
        { "line": 42, "col": 1, "type": "flowchart", "ok": true,
          "warnings": [{ "rule": "duplicate-ids", "message": "node \"A\" declared with label \"Start\" (line 2) and \"Begin\" (line 7)", "line": 7 }] },
        { "line": 89, "col": 1, "type": "sequenceDiagram", "ok": false,
          "error": { "message": "Expecting 'SPACE'", "line": 2, "col": 5 }, "warnings": [] }
      ]
    }
  ],
  "summary": {
    "files": 5, "diagrams": 12, "ok": 10, "errors": 2, "warnings": 1,
    "types": { "flowchart": 6, "sequenceDiagram": 3, "classDiagram": 3 }
  }
}
```

### Usage in non-JavaScript projects

mermaid-lint only requires Node.js ≥20 — it works in any project regardless of language.

**Python / Go / Rust / any project with Markdown docs:**

```bash
# Validate all Markdown in a docs/ folder
npx mermaid-lint "docs/**/*.md"

# Scan everything recursively (no git required)
npx mermaid-lint --all

# Machine-readable output for CI scripts
npx mermaid-lint --format json --all | python -c "
import sys, json
out = json.load(sys.stdin)
if out['summary']['errors']:
    for f in out['files']:
        for d in f['diagrams']:
            if not d['ok']:
                print(f\"{f['path']}:{d['line']}: {d['error']['message']}\")
    sys.exit(1)
"
```

**Pre-commit hook (any language):**

```yaml
# .pre-commit-config.yaml
repos:
  - repo: local
    hooks:
      - id: mermaid-lint
        name: Validate Mermaid diagrams
        language: node
        entry: npx mermaid-lint
        types: [markdown]
        pass_filenames: true
```

## Vitest

```ts
// mermaid.test.ts
import { defineMermaidTests } from '@mermaid-lint/vitest'

defineMermaidTests()                      // auto-discovers git-tracked *.md
defineMermaidTests({ root: '/my/docs' }) // explicit root
```

## Jest

```ts
// mermaid.test.mjs
import { defineMermaidTests } from '@mermaid-lint/jest'

defineMermaidTests()
```

Requires `NODE_OPTIONS=--experimental-vm-modules` (Jest + native ESM).

## How it works

```mermaid
flowchart LR
    src[".md / .mdx / .mmd files"]
    discover["discoverFiles()"]
    extract["extractMermaidBlocks()"]
    validate["validateBlock()"]
    ok(["✓ valid"])
    err(["✗ error + location"])

    src --> discover
    discover --> extract
    extract --> validate
    validate --> ok
    validate --> err
```

- **Discovery:** `git ls-files -- '*.md' '*.mdx' '*.markdown' '*.mmd'` by default; `--all` falls back to recursive filesystem scan
- **Extraction:** Parses fenced ` ```mermaid ``` ` blocks (handles CRLF, indentation, info-strings, unclosed fences); `.mmd` files treated as a single diagram
- **Validation:** Calls `mermaid.parse()` via a lazily-bootstrapped jsdom window — same parser your renderer uses

## Semantic warnings

In addition to syntax errors, mermaid-lint detects semantic issues that `mermaid.parse()` accepts but which produce broken rendered diagrams.

**Duplicate node IDs with conflicting labels** (flowchart / graph only): Mermaid silently picks one label when the same node ID is declared twice with different labels. mermaid-lint flags the conflict:

```
docs/api.md:7:1: warning: duplicate-ids: node "A" declared with label "Start" (line 2) and "Begin" (line 7)
```

Suppress per-diagram with a Mermaid comment:

```
%% mermaid-lint-disable duplicate-ids
flowchart LR
  A[Start] --> B[End]
```

Or disable globally for a run with `--no-semantic`.

## Performance

Benchmarks run on Apple M4 Max (64 GB), Node.js 22 vs [`mermaid-check`](https://github.com/sammcj/mermaid-check) v0.1.0 (Go). Each corpus is a single Markdown file with the given number of flowchart diagrams, ~1/3 of which have duplicate-ID conflicts.

| Diagrams | mermaid-lint (ms/d) | mermaid-check (ms/d) |
|---|---|---|
| 50 | 407 (8.1) | 15 (0.30) |
| 200 | 553 (2.8) | 18 (0.09) |
| 500 | 684 (1.4) | 14 (0.03) |
| 1000 | 1018 (1.0) | 16 (0.02) |

**mermaid-check is ~30–60× faster** because it's a Go binary with a custom parser. mermaid-lint's cost is dominated by a fixed ~400 ms startup (Node.js process + loading the mermaid.js library); the semantic checker itself adds negligible overhead on top of `mermaid.parse()`.

The trade-off: mermaid-lint validates against the **official mermaid.js parser** — the same one your renderer uses — so it catches the exact set of errors your diagrams will hit in production. mermaid-check uses a custom Go parser which may diverge on edge cases.

Run `pnpm bench` to reproduce (requires `mermaid-check` on `PATH`).

## Development

```bash
pnpm install
pnpm test                              # vitest (core + cli + vitest adapter)
pnpm --filter @mermaid-lint/jest test  # jest adapter
pnpm lint                              # biome
```
