# @mermaid-lint/vitest

[Vitest](https://vitest.dev) adapter for [mermaid-lint](https://github.com/jasonworden/mermaid-lint). Turns every Mermaid diagram in your docs into a test — your suite fails if a diagram has a syntax error (or, with `strict`, a semantic warning like a self-loop or duplicate id). Uses the official `mermaid.parse()` API.

**[Full docs and examples →](https://github.com/jasonworden/mermaid-lint)**

## Install

```bash
npm install --save-dev @mermaid-lint/vitest vitest
```

## Usage

```ts
// mermaid.test.ts
import { defineMermaidTests } from '@mermaid-lint/vitest';

defineMermaidTests(); // auto-discovers git-tracked *.md / *.mdx / *.markdown / *.mmd
```

`defineMermaidTests()` registers one test per discovered diagram (plus a guard that at least one diagram exists), so each diagram shows up individually in the Vitest report.

## Options

It accepts the same discovery options as the CLI:

```ts
defineMermaidTests({ root: '/my/docs' }); // explicit root
defineMermaidTests({ all: true }); // scan the filesystem, not just git-tracked files
defineMermaidTests({ paths: ['docs/intro.md', 'README.md'] }); // explicit file paths
defineMermaidTests({ extensions: ['crv'] }); // discover extra extensions
```

| Option | Type | Description |
| --- | --- | --- |
| `root` | `string` | Directory to discover files from. |
| `all` | `boolean` | Scan the filesystem instead of only git-tracked files. |
| `paths` | `string[]` | Explicit file paths to validate (literal paths, not globs). |
| `ignore` | `string[]` | Globs to exclude. |
| `noGitignore` | `boolean` | Include gitignored files when scanning. |
| `extensions` | `string[]` | Extra file extensions to discover (beyond `.md`/`.mdx`/`.markdown`/`.mmd`). |
| `strict` | `boolean` | Also fail on `warning`-severity semantic findings (default: errors only). |
| `rules` | `object` | Per-rule severity overrides, e.g. `{ 'no-orphan-nodes': 'error' }`. |

## Semantic checks

By default a diagram fails on syntax errors and `error`-severity semantic rules
(e.g. duplicate node ids). Pass `strict: true` to also fail on `warning`-severity
findings (self-loops, missing direction, …), or tune individual rules with
`rules`:

```ts
defineMermaidTests({ strict: true });
defineMermaidTests({ rules: { 'no-orphan-nodes': 'error' } });
```

## Programmatic use

Need the results without registering tests? `lintMermaidFiles` returns the
diagnostics per block so you can write your own assertions:

```ts
import { lintMermaidFiles } from '@mermaid-lint/vitest';

const results = await lintMermaidFiles({ all: true }); // or { paths: ['README.md'] }
for (const { block, diagnostics } of results) {
  // diagnostics: syntax + semantic findings for this block
}
```

Requires `vitest >= 1`. Discovery and validation are delegated to [`@mermaid-lint/core`](https://www.npmjs.com/package/@mermaid-lint/core).
