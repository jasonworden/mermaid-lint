# mermaid-lint

Validate Mermaid diagrams embedded in Markdown files. Uses the official `mermaid.parse()` API — catches real syntax errors, not just missing diagram-type keywords.

**[jasonworden.com/mermaid-lint](http://jasonworden.com/mermaid-lint)**

[![npm version](https://img.shields.io/npm/v/@mermaid-lint/cli.svg)](https://www.npmjs.com/package/@mermaid-lint/cli)
[![npm downloads](https://img.shields.io/npm/dm/@mermaid-lint/cli.svg)](https://www.npmjs.com/package/@mermaid-lint/cli)
[![CI](https://github.com/jasonworden/mermaid-lint/actions/workflows/ci.yml/badge.svg)](https://github.com/jasonworden/mermaid-lint/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

⚡ **Fast by default** — a Rust/WASM parser validates the happy path in ~0.1 ms/diagram; the heavyweight pure-JS `mermaid.parse()` path loads only when a diagram actually errors. [See the benchmarks](docs/performance.md)

Catches real syntax errors as you type — here the [VS Code extension](packages/vscode) flagging an unterminated edge label in a `.mmd` file:

![Invalid Mermaid diagram flagged inline in VS Code](packages/vscode/media/demo-mmd.png)

## Quick start

```bash
npx mermaid-lint            # validate every Mermaid block in your git-tracked Markdown
```

No install, no config. mermaid-lint discovers your `.md` / `.mdx` / `.markdown` / `.mmd` files, validates every ` ```mermaid ` block, and reports the precise line and column of any error:

```text
docs/architecture.md:42:5: error: Expecting 'SPACE', got 'TXT' (sequenceDiagram)
```

The exit code is non-zero on failure, so it drops straight into CI or a pre-commit hook. From here:

- **Editor** — [VS Code extension](#vs-code-extension): live squiggles as you type, for both ` ```mermaid ` blocks and standalone `.mmd` files
- **Tests** — [Vitest](#vitest) / [Jest](#jest) adapters: fail your test run on a broken diagram
- **Lint pipeline** — [remark](#remark) · [markdownlint](#markdownlint) · [textlint](#textlint)
- **CI** — [GitHub Action](#github-actions) with inline PR annotations
- **Library** — [`@mermaid-lint/core`](https://docs.mermaidlint.com): the programmatic API, with full reference docs at [docs.mermaidlint.com](https://docs.mermaidlint.com)

## Why mermaid-lint

|  | mermaid-lint | Manual review |
|---|:---:|:---:|
| Catches Mermaid **syntax errors** | ✅ | ⚠️ easy to miss |
| Precise **line / column** of the error | ✅ | ❌ |
| All **19 Mermaid diagram types** | ✅ | ⚠️ |
| **Semantic** warnings (e.g. duplicate node IDs) | ✅ | ❌ |
| **Auto-fix** mechanical issues (`--fix`) | ✅ | ❌ |
| **Editor** squiggles as you type | ✅ VS Code | ❌ |
| Runs in **CI** / pre-commit | ✅ | ❌ |
| Setup | one command | — |

Plain Markdown linters don't validate diagram bodies — but mermaid-lint plugs
into the ones you already run: [markdownlint](#markdownlint), [remark](#remark),
and [textlint](#textlint) all gain Mermaid validation via a mermaid-lint rule.

## Packages

| Package | Published | Description |
|---|---|---|
| [`@mermaid-lint/cli`](packages/cli) | [![npm](https://img.shields.io/npm/v/@mermaid-lint/cli.svg)](https://www.npmjs.com/package/@mermaid-lint/cli) | Command-line runner |
| [`@mermaid-lint/remark`](packages/remark) | [![npm](https://img.shields.io/npm/v/@mermaid-lint/remark.svg)](https://www.npmjs.com/package/@mermaid-lint/remark) | remark-lint plugin |
| [`@mermaid-lint/markdownlint`](packages/markdownlint) | [![npm](https://img.shields.io/npm/v/@mermaid-lint/markdownlint.svg)](https://www.npmjs.com/package/@mermaid-lint/markdownlint) | markdownlint async custom rule |
| [`@mermaid-lint/textlint`](packages/textlint) | [![npm](https://img.shields.io/npm/v/@mermaid-lint/textlint.svg)](https://www.npmjs.com/package/@mermaid-lint/textlint) | textlint rule (async) |
| [`@mermaid-lint/vitest`](packages/vitest) | [![npm](https://img.shields.io/npm/v/@mermaid-lint/vitest.svg)](https://www.npmjs.com/package/@mermaid-lint/vitest) | Vitest adapter |
| [`@mermaid-lint/jest`](packages/jest) | [![npm](https://img.shields.io/npm/v/@mermaid-lint/jest.svg)](https://www.npmjs.com/package/@mermaid-lint/jest) | Jest adapter |
| [`@mermaid-lint/core`](packages/core) | [![npm](https://img.shields.io/npm/v/@mermaid-lint/core.svg)](https://www.npmjs.com/package/@mermaid-lint/core) | Core utilities (extract, validate, discover) — [API docs](https://docs.mermaidlint.com) |
| [`mermaid-lint-vscode`](packages/vscode) | [![VS Code Marketplace](https://img.shields.io/badge/Marketplace-VS%20Code-007ACC?logo=visualstudiocode)](https://marketplace.visualstudio.com/items?itemName=mermaid-lint.mermaid-lint-vscode) [![Open VSX](https://img.shields.io/open-vsx/v/mermaid-lint/mermaid-lint-vscode.svg?label=Open%20VSX)](https://open-vsx.org/extension/mermaid-lint/mermaid-lint-vscode) | VS Code extension — live squiggles in Markdown (`.md`, `.markdown`) blocks + standalone `.mmd` files |

## CLI

**Exit codes:** `0` = all valid · `1` = validation failures (or warnings with `--strict`) · `2` = usage/IO error

See [docs/cli.md](docs/cli.md) for discovery modes, glob flags, stdin, JSON
output, strict mode, semantic toggles, and `--fix` examples.

**JSON output** (`--format json`) is documented in
[docs/json-output.md](docs/json-output.md) — the full schema, field reference,
and a CI-scripting example.

For a selective project arc instead of a full changelog, see
[Release history](docs/release-history.md).

### Beyond JavaScript projects

mermaid-lint only requires Node.js ≥20 and runs via `npx`, so it works in any
project regardless of language. See [docs/ci-and-precommit.md](docs/ci-and-precommit.md)
for Python/Go/Rust recipes, pre-commit hooks (`pre-commit`, husky + lint-staged),
and CI usage.

## GitHub Actions

```yaml
- uses: jasonworden/mermaid-lint-action@v1
  with:
    files: 'docs/**/*.md **/*.mmd'
    strict: true
```

See [mermaid-lint-action](https://github.com/jasonworden/mermaid-lint-action) for full options and inline PR annotation support.

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

  // false disables ALL semantic rules — equivalent to --no-semantic
  semantic: true,

  // Per-rule severity ('off' | 'warn' | 'error'), layered over the defaults.
  // Most rules default to 'warn'; 'duplicate-ids' defaults to 'error'.
  rules: {
    'prefer-flowchart': 'warn',  // legacy `graph` keyword → prefer `flowchart`
    'require-direction': 'warn', // `flowchart`/`graph` with no direction (defaults to TD)
    'no-experimental': 'warn',   // `*-beta` diagram types (unstable syntax)
    'duplicate-ids': 'error',    // same node id, conflicting labels (wrong output)
  },

  // 'text' (default) or 'json'
  format: 'text',

  // Code-fence markers to recognize. Defaults to both, matching CommonMark:
  //   'backtick' → ```mermaid … ```
  //   'tilde'    → ~~~mermaid … ~~~
  // Restrict to ['backtick'] to ignore tilde fences.
  fences: ['backtick', 'tilde'],
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

## remark

```ts
import { remark } from 'remark';
import remarkLint from 'remark-lint';
import remarkLintMermaid from '@mermaid-lint/remark';

const result = await remark()
  .use(remarkLint)
  .use(remarkLintMermaid)
  .process(markdown);

// result.messages contains any mermaid validation errors
```

Or in `.remarkrc.mjs` to run from the command line (`npx remark --frail .`):

```js
export default {
  plugins: [
    'remark-lint',
    '@mermaid-lint/remark',
  ]
};
```

Enable strict mode (treat semantic warnings as errors):

```js
export default {
  plugins: [
    'remark-lint',
    ['@mermaid-lint/remark', { strict: true }],
  ]
};
```

Tune individual rules with `rules` (same shape as the CLI's [`rules`](#configuration)
config) — e.g. enable an off-by-default rule or silence one:

```js
['@mermaid-lint/remark', { rules: { 'no-orphan-nodes': 'error', 'no-self-loop': 'off' } }]
```

### Autofix

remark has no lint-fixer API, so fixing ships as a **separate transformer**,
`remarkMermaidFix`, alongside the report-only lint rule. It applies the same
mechanical corrections as the CLI's [`--fix`](#cli) (normalize `->` arrows, add
missing sequence-message colons; never semantic changes):

```ts
import { remark } from 'remark';
import remarkLintMermaid, { remarkMermaidFix } from '@mermaid-lint/remark';

const result = await remark()
  .use(remarkLintMermaid)   // report
  .use(remarkMermaidFix)    // fix
  .process(markdown);
```

A transformer only takes effect when remark serializes, so fixes apply under
`npx remark file.md --output` (and are inert in pure-lint runs). `remark --output`
already reserializes the whole document via `remark-stringify` on every run; the
fixer changes only the Mermaid fence bodies within that.

## markdownlint

A set of [markdownlint](https://github.com/DavidAnson/markdownlint) async custom
rules that validate Mermaid blocks as part of your existing markdownlint run — in
CI, on the command line, and inline in VS Code. There's **one rule per check**
(`mermaid-syntax` for parse errors, `mermaid-no-self-loop`, `mermaid-duplicate-ids`,
…); the default export is the `recommended` bundle, and `all`/individual rules let
you opt into more or cherry-pick. See the
[package README](packages/markdownlint/README.md#rules) for the full rule list.

### What this provides today

| Surface | Supported | Notes |
|---|---|---|
| ```` ```mermaid ```` blocks in **Markdown** (`.md`, `.markdown`, …) | ✅ | CLI, CI, and in-editor squiggles |
| Standalone **`.mmd`** diagram files | ❌ | markdownlint only processes Markdown; it never invokes the rule on `.mmd`. Use the [VS Code extension](#vs-code-extension) for `.mmd` coverage in the editor. |
| Zero-config editor setup | ❌ | requires the steps below (npm install + setting + workspace trust) |
| **Autofix** via `markdownlint-cli2 --fix` | ✅ | `mermaid-syntax` applies the same mechanical corrections as the CLI's `--fix` (normalize `->` arrows, add missing sequence-message colons). Semantic rules never autofix. |

### Autofix (`--fix`)

The `mermaid-syntax` rule wires Mermaid into markdownlint's native autofix, so
`markdownlint-cli2 --fix` corrects the mechanical mistakes inside your diagram
blocks alongside your other Markdown fixes:

```bash
npx markdownlint-cli2 --fix "**/*.md"
```

It applies exactly the corrections the [CLI's `--fix`](#cli) does — normalizing
flowchart arrows (`->` → `-->`) and inserting missing sequence-message colons.
These are meaning-preserving; semantic findings (self-loops, duplicate ids, …)
are reported but never auto-changed. Closing an unclosed fence remains CLI-only.

### CLI / CI usage

```bash
npm install --save-dev @mermaid-lint/markdownlint markdownlint-cli2
```

```js
// .markdownlint-cli2.mjs
export default {
  config: { default: true },
  customRules: ['@mermaid-lint/markdownlint'],
};
```

Run it: `npx markdownlint-cli2 "**/*.md"`. Use **`markdownlint-cli2 >= 0.17.0`** —
earlier versions bundle a `markdownlint` older than `0.37`, which predates async
custom rules, so the rules are **silently skipped** (zero errors reported).

To enable every check (including the higher-false-positive `no-orphan-nodes` and
`prefer-explicit-participants`), spread the `all` bundle:

```js
import mermaid from '@mermaid-lint/markdownlint';
export default { config: { default: true }, customRules: [...mermaid.all] };
```

### VS Code (inline squiggles, no separate extension)

Install the [markdownlint extension](https://marketplace.visualstudio.com/items?itemName=DavidAnson.vscode-markdownlint)
(**v0.50+**; it bundles a recent `markdownlint-cli2`, so async rules run), add the
package to your workspace (`npm i -D @mermaid-lint/markdownlint`), then in
`.vscode/settings.json`:

```json
{
  "markdownlint.customRules": ["./node_modules/@mermaid-lint/markdownlint"]
}
```

You must **trust the workspace** — the extension blocks custom-rule JavaScript in
untrusted workspaces. Invalid ```` ```mermaid ```` blocks in `.md` files then get
inline diagnostics as you type. (`.mmd` files are not covered — see the table
above.)

Requires `markdownlint >= 0.37.0` for async custom rule support.

## textlint

A [textlint](https://textlint.org) rule that validates ```` ```mermaid ````
blocks as part of a textlint run. textlint awaits a Promise returned from a rule,
so — unlike ESLint, whose rules are synchronous — it runs the **full** async
validator (merman + mermaid.js), the same engine the CLI uses.

```bash
npm install --save-dev textlint @textlint/textlint-plugin-markdown @mermaid-lint/textlint
```

```js
// .textlintrc.js
module.exports = {
  plugins: ['@textlint/markdown'],
  rules: {
    '@mermaid-lint/textlint': true,
  },
};
```

Run it: `npx textlint "**/*.md"`. Pass `{ strict: true }` to also report semantic
warnings (e.g. duplicate node IDs):

```js
rules: {
  '@mermaid-lint/textlint': { strict: true },
},
```

Or pass `rules` (same shape as the CLI's [`rules`](#configuration) config) to
enable an off-by-default rule or silence one:

```js
rules: {
  '@mermaid-lint/textlint': { rules: { 'no-orphan-nodes': 'error' } },
},
```

The rule is also a textlint **fixer**, so `textlint --fix` applies the same
mechanical corrections as the CLI's [`--fix`](#cli) (normalize `->` arrows,
insert missing sequence-message colons) inside your Mermaid blocks:

```bash
npx textlint --fix "**/*.md"
```

These corrections are meaning-preserving; semantic findings are reported but
never auto-changed. (List-indented fences are a no-op — textlint de-indents the
block body; use the CLI for those.)

> **Why textlint and not ESLint?** ESLint rules must be synchronous, so they
> cannot run Mermaid's async parser. See the
> [parsing-vs-linting explainer](docs/parsing-vs-linting.md) and tracking issues
> [#39](https://github.com/jasonworden/mermaid-lint/issues/39) (ESLint) and
> [#38](https://github.com/jasonworden/mermaid-lint/issues/38) (Biome).

## VS Code extension

A dedicated extension (`mermaid-lint-vscode`, in [`packages/vscode`](packages/vscode))
validates Mermaid as you type, including Markdown fences and standalone `.mmd`
files. It reports inline diagnostics, hover messages, Problems-panel entries,
and quick-fix code actions while honoring the same mermaid-lint config as the
CLI.

Install it from the
[VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=mermaid-lint.mermaid-lint-vscode)
or [Open VSX](https://open-vsx.org/extension/mermaid-lint/mermaid-lint-vscode),
or run `code --install-extension mermaid-lint.mermaid-lint-vscode`.

## Vitest

```ts
// mermaid.test.ts
import { defineMermaidTests } from '@mermaid-lint/vitest'

defineMermaidTests()                      // auto-discovers git-tracked *.md
defineMermaidTests({ root: '/my/docs' })  // explicit root
defineMermaidTests({ strict: true })      // also fail on semantic warnings
```

## Jest

```ts
// mermaid.test.mjs
import { defineMermaidTests } from '@mermaid-lint/jest'

defineMermaidTests()
```

Requires `NODE_OPTIONS=--experimental-vm-modules` (Jest + native ESM).

Both fail a test on any **syntax error** or `error`-severity semantic finding (e.g. a duplicate id); pass `strict: true` to also fail on warnings, or `rules` to tune individual checks. Need the results without registering tests? Call `lintMermaidFiles(opts)`. Full options in the [vitest](packages/vitest) / [jest](packages/jest) READMEs.

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

- **Discovery:** `git ls-files -- '*.md' '*.mdx' '*.markdown' '*.mmd'` by default; `--all` falls back to recursive filesystem scan. Add extensions with `--ext crv,foo` or `extensions: ['crv']` in config to discover other fenced-Markdown file types (e.g. [Carve](https://github.com/markup-carve/carve) `.crv`). Files you name explicitly are always linted, whatever their extension.
- **Extraction:** Parses CommonMark fenced `mermaid` blocks — backtick (` ```mermaid ` ) and tilde (`~~~mermaid`) markers, variable-length fences (4+ chars, so a body can contain ` ``` `), CRLF, indentation, info-strings, and unclosed fences. Restrict recognized markers with the [`fences`](#configuration) config option. Only `.mmd` files are treated as a single whole-file diagram — every other extension uses fenced-block extraction
- **Validation:** Primary pass via [`@mermanjs/web`](https://github.com/Latias94/merman) WASM (Rust, ~3.7–4.4× faster). On any error, falls back to `mermaid.parse()` via jsdom for precise line/col locations and authoritative verdict

## Semantic rules

In addition to syntax errors, mermaid-lint runs semantic rules over diagrams
that `mermaid.parse()` accepts but which are legacy, ambiguous, or render
incorrectly. Each rule has a per-rule severity (`off` | `warn` | `error`), and
you can tune any rule via the [`rules` config key](#configuration).

See [docs/semantic-rules.md](docs/semantic-rules.md) for the full rule table,
default severities, scopes, and example output.

Suppress one rule per-diagram with a Mermaid comment:

```
%% mermaid-lint-disable duplicate-ids
flowchart LR
  A[Start] --> B[End]
```

Use a bare `%% mermaid-lint-disable` to suppress all rules in a diagram, or disable everything for a run with `--no-semantic`.

## Diagram types

mermaid-lint validates all 19 Mermaid diagram types using the official `mermaid.parse()` API. Some alternative linters (e.g. [`maid`](https://github.com/egoist/maid)) only validate 5 types and silently pass all input for the other 14 (gantt, erDiagram, journey, mindmap, gitGraph, etc.). Every type in the table below is actively validated — none are pass-through.

| Type | Keyword | Supported | Related rules | Notes |
|---|---|---|---|---|
| Flowchart | `flowchart` / `graph` | ✅ | `duplicate-ids`, `prefer-flowchart`, `require-direction`, `no-duplicate-edges`, `no-self-loop`, `no-empty-labels`, `no-orphan-nodes`, `no-duplicate-node-declarations` | `graph` is an alias for `flowchart` |
| Sequence | `sequenceDiagram` | ✅ | `no-activate-without-deactivate`, `prefer-explicit-participants`, `sequence-duplicate-participant` | |
| Class | `classDiagram` | ✅ | `class-duplicate-class`, `no-duplicate-methods` | |
| State | `stateDiagram-v2` | ✅ | `state-duplicate-state`, `state-duplicate-transition`, `state-empty-composite`, `state-self-transition` | |
| Entity-Relationship | `erDiagram` | ✅ | `er-duplicate-attribute`, `er-duplicate-entity`, `er-standalone-entity` | |
| Pie chart | `pie` | ✅ | `pie-duplicate-label`, `pie-zero-value`, `pie-no-data` | |
| Gantt | `gantt` | ✅ | `gantt-duplicate-task-id`, `gantt-undefined-dependency`, `gantt-empty-section` | |
| Git graph | `gitGraph` | ✅ | `gitgraph-duplicate-commit-id`, `gitgraph-duplicate-tag`, `gitgraph-no-commits` | |
| User journey | `journey` | ✅ | `journey-empty-section`, `journey-score-out-of-range`, `journey-task-without-actor`, `journey-no-tasks` | |
| Mindmap | `mindmap` | ✅ | `mindmap-duplicate-sibling`, `mindmap-no-nodes`, `mindmap-deep-nesting` | |
| Quadrant chart | `quadrantChart` | ✅ | `quadrant-duplicate-point`, `quadrant-no-points`, `quadrant-missing-x-axis`, `quadrant-missing-y-axis`, `quadrant-duplicate-quadrant` | |
| Requirement | `requirementDiagram` | ✅ | - | |
| C4 Context | `C4Context` | ✅ | `c4-duplicate-id`, `c4-undefined-relationship-endpoint`, `c4-undefined-element-style`, `c4-undefined-relationship-style-endpoint` | |
| Timeline | `timeline` | ✅ | `timeline-empty-section`, `timeline-empty-event`, `timeline-no-entries` | |
| XY chart | `xychart-beta` | ✅ | `no-experimental` | Experimental |
| Sankey | `sankey-beta` | ✅ | `no-experimental` | Experimental |
| Block | `block-beta` | ✅ | `no-experimental` | Experimental |
| Packet | `packet-beta` | ✅ | `no-experimental` | Experimental |
| Architecture | `architecture-beta` | ✅ | `no-experimental` | Experimental |
| ZenUML | `zenuml` | ❌ | - | Requires separate [`@mermaid-js/mermaid-zenuml`](https://github.com/mermaid-js/zenuml-core) package; not bundled in mermaid v11 |

## Performance

The Rust/WASM fast path avoids the fixed mermaid.js + jsdom startup cost for
valid diagrams, while mermaid.js remains the authoritative fallback for parser
errors and precise line/column diagnostics.

See [docs/performance.md](docs/performance.md) for benchmarks, parser-accuracy
checks, and reproduction steps.

## Development

```bash
pnpm install
pnpm test                              # vitest (core + cli + vitest adapter)
pnpm --filter @mermaid-lint/jest test  # jest adapter
pnpm lint                              # biome
```
