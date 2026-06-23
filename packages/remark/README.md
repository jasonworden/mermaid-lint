# @mermaid-lint/remark

[remark-lint](https://github.com/remarkjs/remark-lint) plugin that validates Mermaid diagrams in Markdown using the official `mermaid.parse()` API — catches real syntax errors, not just missing diagram-type keywords.

**[Full docs and examples →](https://github.com/jasonworden/mermaid-lint)**

## Install

```bash
npm install --save-dev @mermaid-lint/remark remark-lint
```

## Usage

Programmatic:

```ts
import { remark } from 'remark';
import remarkLint from 'remark-lint';
import remarkLintMermaid from '@mermaid-lint/remark';

const result = await remark()
  .use(remarkLint)
  .use(remarkLintMermaid)
  .process(markdown);

// result.messages contains any Mermaid validation errors
```

Or in `.remarkrc.mjs`, to run from the command line (`npx remark --frail .`):

```js
export default {
  plugins: ['remark-lint', '@mermaid-lint/remark'],
};
```

## Options

Enable `strict` to treat semantic warnings (e.g. duplicate node IDs) as messages too — by default only syntax errors are reported:

```js
export default {
  plugins: ['remark-lint', ['@mermaid-lint/remark', { strict: true }]],
};
```

Tune individual rules with `rules` (the same severity map as the CLI's `rules`
config) — enable an off-by-default rule or silence one:

```js
export default {
  plugins: [
    'remark-lint',
    ['@mermaid-lint/remark', { rules: { 'no-orphan-nodes': 'error', 'no-self-loop': 'off' } }],
  ],
};
```

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `strict` | `boolean` | `false` | Also report semantic warnings, not just syntax errors. |
| `rules` | `Record<string, 'off' \| 'warn' \| 'error'>` | `{}` | Per-rule severity overrides, layered over the built-in defaults. |

## Autofix

remark has no lint-fixer API, so fixing is a **separate transformer**,
`remarkMermaidFix`, rather than part of the lint rule. It mechanically corrects
Mermaid blocks — normalizing flowchart/graph arrows (`->` → `-->`) and inserting
missing sequence-message colons (the same set `mermaid-lint --fix` applies) — and
never changes diagram meaning.

```js
import { remark } from 'remark';
import remarkLintMermaid, { remarkMermaidFix } from '@mermaid-lint/remark';

// Report and fix in one pipeline:
const result = await remark()
  .use(remarkLintMermaid)
  .use(remarkMermaidFix)
  .process(markdown);
// String(result) now has the corrected Mermaid blocks.
```

Because a transformer only takes effect when remark serializes the tree, fixes
apply when you run remark with **`--output`** (`npx remark file.md --output`), and
the transformer is inert in pure-lint runs. Note that `remark --output` already
reserializes the **whole** document through `remark-stringify` (normalizing
bullets, emphasis, fence style, etc.) on every run — this is inherent to remark
and not introduced by the fixer, which only changes the Mermaid fence bodies.

> remark uses its own CommonMark parser to find ` ```mermaid ` blocks, then delegates validation to [`@mermaid-lint/core`](https://www.npmjs.com/package/@mermaid-lint/core). Requires `remark-lint >= 9` and `unified >= 11`.
