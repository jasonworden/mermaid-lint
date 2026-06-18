# mermaid-lint

Validate Mermaid diagrams embedded in Markdown files. Uses the official `mermaid.parse()` API — catches real syntax errors, not just missing diagram-type keywords.

**[jasonworden.com/mermaid-lint](http://jasonworden.com/mermaid-lint)**

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
  "version": "0.6.0",
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

## Configuration

mermaid-lint auto-discovers a config file in your project root. Supported names (in priority order):

- `mermaid-lint.config.js` / `.cjs` / `.mjs`
- `.mermaidlintrc` / `.mermaidlintrc.json`
- `.mermaidlintrc.js` / `.cjs` / `.mjs`
- `package.json` → `"mermaidLint"` field

CLI flags always override config values. A starter template is provided at [`mermaid-lint.config.example.js`](mermaid-lint.config.example.js).

```js
// mermaid-lint.config.js
export default {
  // Glob patterns to validate (used when no CLI paths given and --all not set)
  files: ['docs/**/*.md', '**/*.mmd'],

  // Glob patterns to exclude
  ignore: ['node_modules/**', 'dist/**'],

  // Treat semantic warnings as errors — equivalent to --strict
  strict: false,

  // false disables semantic checks — equivalent to --no-semantic
  semantic: true,

  // 'text' (default) or 'json'
  format: 'text',
};
```

Or as JSON in `.mermaidlintrc.json`:

```json
{
  "files": ["docs/**/*.md"],
  "ignore": ["dist/**"],
  "strict": true
}
```

Or inline in `package.json`:

```json
{
  "mermaidLint": {
    "ignore": ["dist/**"],
    "strict": true
  }
}
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
- **Validation:** Primary pass via [`@mermanjs/web`](https://github.com/Latias94/merman) WASM (Rust, ~3.7–4.4× faster). On any error, falls back to `mermaid.parse()` via jsdom for precise line/col locations and authoritative verdict

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

## Diagram types

| Type | Keyword | Supported | Notes |
|---|---|---|---|
| Flowchart | `flowchart` / `graph` | ✅ | `graph` is an alias for `flowchart` |
| Sequence | `sequenceDiagram` | ✅ | |
| Class | `classDiagram` | ✅ | |
| State | `stateDiagram-v2` | ✅ | |
| Entity-Relationship | `erDiagram` | ✅ | |
| Pie chart | `pie` | ✅ | |
| Gantt | `gantt` | ✅ | |
| Git graph | `gitGraph` | ✅ | |
| User journey | `journey` | ✅ | |
| Mindmap | `mindmap` | ✅ | |
| Quadrant chart | `quadrantChart` | ✅ | |
| Requirement | `requirementDiagram` | ✅ | |
| C4 Context | `C4Context` | ✅ | |
| Timeline | `timeline` | ✅ | |
| XY chart | `xychart-beta` | ✅ | Experimental |
| Sankey | `sankey-beta` | ✅ | Experimental |
| Block | `block-beta` | ✅ | Experimental |
| Packet | `packet-beta` | ✅ | Experimental |
| Architecture | `architecture-beta` | ✅ | Experimental |
| ZenUML | `zenuml` | ❌ | Requires separate [`@mermaid-js/mermaid-zenuml`](https://github.com/mermaid-js/zenuml-core) package; not bundled in mermaid v11 |

## Performance

Benchmarks run on Apple M4 Max (64 GB), Node.js 22. Corpus: one Markdown file with the given number of flowchart diagrams (~1/3 with duplicate-ID conflicts, all syntactically valid). Values are **total ms (ms per diagram)**.

| Diagrams | mermaid-lint v0.3.0 | mermaid-lint v0.5.0 |
|---|---|---|
| 10 | — | 108 ms (10.8 ms/d) |
| 50 | 407 ms (8.1 ms/d) | 121 ms (2.4 ms/d) |
| 200 | 553 ms (2.8 ms/d) | 159 ms (0.8 ms/d) |
| 1000 | 1018 ms (1.0 ms/d) | 260 ms (0.3 ms/d) |
| 10000 | 6643 ms (0.7 ms/d) | 1699 ms (0.2 ms/d) |
| 100000 | 62734 ms (0.63 ms/d) | 15590 ms (0.16 ms/d) |

**v0.5.0 is 3.4–4.0× faster** than v0.3.0. The fixed ~400 ms startup cost (Node.js + mermaid.js) is now eliminated on the happy path: `@mermanjs/web` WASM handles validation with ~100 ms init + ~0.1 ms/diagram. mermaid.js is only loaded when a diagram fails validation, where it supplies precise line/column error locations.

**Validation accuracy:** mermaid-lint uses `@mermanjs/web` (Rust WASM) for the fast path. When merman signals an error, mermaid.js is the authoritative fallback — it provides precise line/col locations and is the final arbiter of validity. Parity between the two parsers is enforced by a CI test suite: a corpus of 24+ valid and 10+ invalid diagrams across all major Mermaid diagram types runs on every PR, failing if merman ever accepts a diagram that mermaid.js rejects. For corpora with parse errors, both runtimes load (~500 ms total).

Run `pnpm bench` to reproduce.

## Development

```bash
pnpm install
pnpm test                              # vitest (core + cli + vitest adapter)
pnpm --filter @mermaid-lint/jest test  # jest adapter
pnpm lint                              # biome
```
