# @mermaid-lint/markdownlint

[markdownlint](https://github.com/DavidAnson/markdownlint) **async custom rules** that validate Mermaid diagrams as part of your existing markdownlint run — in CI, on the command line, and inline in VS Code. Uses the official `mermaid.parse()` API, so it catches real syntax errors, not just missing diagram-type keywords — plus opt-in semantic checks (self-loops, duplicate ids, orphan nodes, …).

**[Full docs and examples →](https://github.com/jasonworden/mermaid-lint)**

## Install

```bash
npm install --save-dev @mermaid-lint/markdownlint markdownlint-cli2
```

## CLI / CI usage

The package exports **one rule per check** (mirroring how markdownlint's own
built-in rules work). The default export is the **`recommended`** bundle, so the
zero-config string form registers a sensible set:

```js
// .markdownlint-cli2.mjs
export default {
  config: { default: true },
  customRules: ['@mermaid-lint/markdownlint'],
};
```

Run it: `npx markdownlint-cli2 "**/*.md"`.

Use **`markdownlint-cli2 >= 0.17.0`** — earlier versions bundle a `markdownlint` older than `0.37`, which predates async custom rules, so the rules are **silently skipped** (zero errors reported).

## Rules

Each check is its own markdownlint rule, named after the underlying
[`@mermaid-lint/core`](https://www.npmjs.com/package/@mermaid-lint/core) rule id:

| Rule name | What it flags | In `recommended`? |
| --- | --- | --- |
| `mermaid-syntax` | Diagram fails to parse (won't render) | ✅ |
| `mermaid-duplicate-ids` | Node id reused with a conflicting label | ✅ |
| `mermaid-prefer-flowchart` | Legacy `graph` keyword instead of `flowchart` | ✅ |
| `mermaid-require-direction` | Diagram has no explicit direction | ✅ |
| `mermaid-no-experimental` | Experimental diagram type with unstable syntax | ✅ |
| `mermaid-no-duplicate-edges` | The same edge is defined more than once | ✅ |
| `mermaid-no-self-loop` | A node has an edge to itself | ✅ |
| `mermaid-no-empty-labels` | A node has an empty label | ✅ |
| `mermaid-no-activate-without-deactivate` | Sequence activation without a matching deactivation | ✅ |
| `mermaid-no-duplicate-methods` | A class declares a duplicate method | ✅ |
| `mermaid-no-orphan-nodes` | A node is declared but never connected | — (`all` only) |
| `mermaid-prefer-explicit-participants` | Sequence participant used before being declared | — (`all` only) |

**Granularity comes from which rules you register**, not from a config map —
markdownlint has no severity levels, so a rule simply reports (as an error) when
it's registered and enabled.

## Choosing which rules to run

```js
// .markdownlint-cli2.mjs
import mermaid from '@mermaid-lint/markdownlint';

export default {
  config: { default: true },
  customRules: [
    ...mermaid.all,        // every check, including the off-by-default ones
    // ...mermaid.recommended  // the default-on set (same as the string form)
    // mermaid.rules.syntax, mermaid.rules['no-self-loop']  // cherry-pick
  ],
};
```

Exports: the **default** export (= `recommended`), plus named `recommended`,
`all`, and `rules` (a map keyed by `syntax` and each core rule id, e.g.
`rules.syntax`, `rules['no-self-loop']`).

## Disabling a rule

Standard markdownlint config — by name, globally or inline:

```js
export default {
  customRules: [/* ...mermaid.all */],
  config: {
    'mermaid-no-self-loop': false, // turn one check off
  },
};
```

```md
<!-- markdownlint-disable mermaid-no-orphan-nodes -->
```

## Configuration: fences

Each rule accepts an optional `fences` array (which CommonMark fence markers to
recognize); invalid values fall back to the default of both backtick and tilde:

```js
export default {
  customRules: ['@mermaid-lint/markdownlint'],
  config: {
    'mermaid-syntax': { fences: ['backtick'] }, // ignore ~~~mermaid fences
  },
};
```

## Autofix (`--fix`)

The `mermaid-syntax` rule plugs into markdownlint's native autofix, so
`markdownlint-cli2 --fix` corrects mechanical mistakes inside your Mermaid blocks
alongside your other Markdown fixes:

```bash
npx markdownlint-cli2 --fix "**/*.md"
```

It applies the same meaning-preserving corrections as the CLI's `--fix`:

- normalize flowchart/graph arrows (`->` → `-->`)
- insert a missing sequence-message colon (`A->>B msg` → `A->>B: msg`)

Only `mermaid-syntax` offers fixes. Semantic checks (self-loops, duplicate ids, …)
are reported but never auto-changed, and closing an unclosed fence stays CLI-only
(use [`mermaid-lint --fix`](https://www.npmjs.com/package/@mermaid-lint/cli)).

## VS Code (inline squiggles, no separate extension)

Install the [markdownlint extension](https://marketplace.visualstudio.com/items?itemName=DavidAnson.vscode-markdownlint) (**v0.50+**; it bundles a recent `markdownlint-cli2`, so async rules run), add this package to your workspace, then in `.vscode/settings.json`:

```json
{
  "markdownlint.customRules": ["./node_modules/@mermaid-lint/markdownlint"]
}
```

You must **trust the workspace** — the extension blocks custom-rule JavaScript in untrusted workspaces.

## What this covers

| Surface | Supported | Notes |
| --- | --- | --- |
| ` ```mermaid ` blocks in Markdown (`.md`, `.markdown`, …) | ✅ | CLI, CI, and in-editor squiggles |
| Standalone `.mmd` files | ❌ | markdownlint only processes Markdown. Use the [VS Code extension](https://marketplace.visualstudio.com/items?itemName=mermaid-lint.mermaid-lint-vscode) for `.mmd` coverage. |
| Autofix via `markdownlint-cli2 --fix` | ✅ | `mermaid-syntax` corrects mechanical issues (arrows, missing colons); semantic rules never autofix. |

Requires `markdownlint >= 0.37.0` for async custom rule support. Validation is delegated to [`@mermaid-lint/core`](https://www.npmjs.com/package/@mermaid-lint/core).
