# @mermaid-lint/markdownlint

A [markdownlint](https://github.com/DavidAnson/markdownlint) **async custom rule** (`ML001`) that validates Mermaid diagrams as part of your existing markdownlint run — in CI, on the command line, and inline in VS Code. Uses the official `mermaid.parse()` API, so it catches real syntax errors, not just missing diagram-type keywords.

**[Full docs and examples →](https://github.com/jasonworden/mermaid-lint)**

## Install

```bash
npm install --save-dev @mermaid-lint/markdownlint markdownlint-cli2
```

## CLI / CI usage

```js
// .markdownlint-cli2.mjs
export default {
  config: { default: true },
  customRules: ['@mermaid-lint/markdownlint'],
};
```

Run it: `npx markdownlint-cli2 "**/*.md"`.

Use **`markdownlint-cli2 >= 0.17.0`** — earlier versions bundle a `markdownlint` older than `0.37`, which predates async custom rules, so the rule is **silently skipped** (zero errors reported).

## VS Code (inline squiggles, no separate extension)

Install the [markdownlint extension](https://marketplace.visualstudio.com/items?itemName=DavidAnson.vscode-markdownlint) (**v0.50+**; it bundles a recent `markdownlint-cli2`, so async rules run), add this package to your workspace, then in `.vscode/settings.json`:

```json
{
  "markdownlint.customRules": ["./node_modules/@mermaid-lint/markdownlint"]
}
```

You must **trust the workspace** — the extension blocks custom-rule JavaScript in untrusted workspaces.

## Configuration

The rule accepts an optional `fences` array (which CommonMark fence markers to recognize); invalid values fall back to the default of both backtick and tilde:

```js
// .markdownlint-cli2.mjs
export default {
  customRules: ['@mermaid-lint/markdownlint'],
  config: {
    ML001: { fences: ['backtick'] }, // ignore ~~~mermaid fences
  },
};
```

## What this covers

| Surface | Supported | Notes |
| --- | --- | --- |
| ` ```mermaid ` blocks in Markdown (`.md`, `.markdown`, …) | ✅ | CLI, CI, and in-editor squiggles |
| Standalone `.mmd` files | ❌ | markdownlint only processes Markdown. Use the [VS Code extension](https://marketplace.visualstudio.com/items?itemName=mermaid-lint.mermaid-lint-vscode) for `.mmd` coverage. |

Requires `markdownlint >= 0.37.0` for async custom rule support. Validation is delegated to [`@mermaid-lint/core`](https://www.npmjs.com/package/@mermaid-lint/core).
