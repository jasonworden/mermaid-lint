# @mermaid-lint/textlint

A [textlint](https://textlint.org) rule that validates ` ```mermaid ` blocks as part of a textlint run. Uses the official `mermaid.parse()` API — catches real syntax errors, not just missing diagram-type keywords.

textlint awaits a Promise returned from a rule, so — unlike ESLint, whose rules are synchronous — it runs the **full** async validator (merman + mermaid.js), the same engine the CLI uses.

**[Full docs and examples →](https://github.com/jasonworden/mermaid-lint)**

## Install

```bash
npm install --save-dev textlint @textlint/textlint-plugin-markdown @mermaid-lint/textlint
```

## Usage

```js
// .textlintrc.js
module.exports = {
  plugins: ['@textlint/markdown'],
  rules: {
    '@mermaid-lint/textlint': true,
  },
};
```

Run it: `npx textlint "**/*.md"`.

## Options

Pass `{ strict: true }` to also report semantic warnings (e.g. duplicate node IDs) in addition to syntax errors:

```js
rules: {
  '@mermaid-lint/textlint': { strict: true },
},
```

Tune individual rules with `rules` (the same severity map as the CLI's `rules`
config) — enable an off-by-default rule or silence one:

```js
rules: {
  '@mermaid-lint/textlint': { rules: { 'no-orphan-nodes': 'error', 'no-self-loop': 'off' } },
},
```

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `strict` | `boolean` | `false` | Also report semantic warnings, not just syntax errors. |
| `rules` | `Record<string, 'off' \| 'warn' \| 'error'>` | `{}` | Per-rule severity overrides, layered over the built-in defaults. |

## Autofix (`--fix`)

The rule is a textlint **fixer**, so `textlint --fix` corrects mechanical mistakes
inside your Mermaid blocks alongside your other textlint fixes:

```bash
npx textlint --fix "**/*.md"
```

It applies the same meaning-preserving corrections as the CLI's `--fix`:

- normalize flowchart/graph arrows (`->` → `-->`)
- insert a missing sequence-message colon (`A->>B msg` → `A->>B: msg`)

Semantic findings (self-loops, duplicate ids, …) are reported but never
auto-changed. List-indented fences are a no-op (textlint de-indents the block
body, so it can't be matched back to source) — use
[`mermaid-lint --fix`](https://www.npmjs.com/package/@mermaid-lint/cli) for those.

> **Why textlint and not ESLint?** ESLint rules must be synchronous, so they cannot run Mermaid's async parser. See the [parsing-vs-linting explainer](https://github.com/jasonworden/mermaid-lint/blob/main/docs/parsing-vs-linting.md) and tracking issues [#39](https://github.com/jasonworden/mermaid-lint/issues/39) (ESLint) and [#38](https://github.com/jasonworden/mermaid-lint/issues/38) (Biome).

Requires `textlint >= 13`. Validation is delegated to [`@mermaid-lint/core`](https://www.npmjs.com/package/@mermaid-lint/core).
