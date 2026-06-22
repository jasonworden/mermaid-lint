# @mermaid-lint/jest

[Jest](https://jestjs.io) adapter for [mermaid-lint](https://github.com/jasonworden/mermaid-lint). Turns every Mermaid diagram in your docs into a test — your suite fails if a diagram has a syntax error. Uses the official `mermaid.parse()` API.

**[Full docs and examples →](https://github.com/jasonworden/mermaid-lint)**

## Install

```bash
npm install --save-dev @mermaid-lint/jest jest
```

## Usage

```ts
// mermaid.test.mjs
import { defineMermaidTests } from '@mermaid-lint/jest';

defineMermaidTests(); // auto-discovers git-tracked *.md / *.mdx / *.markdown / *.mmd
```

`defineMermaidTests()` registers one test per discovered diagram (plus a guard that at least one diagram exists), so each diagram shows up individually in the Jest report.

Jest needs native ESM enabled, since this package is ESM-only:

```bash
NODE_OPTIONS=--experimental-vm-modules npx jest
```

## Options

It accepts the same discovery options as the CLI:

```ts
defineMermaidTests({ root: '/my/docs' }); // explicit root
defineMermaidTests({ all: true }); // scan the filesystem, not just git-tracked files
defineMermaidTests({ paths: ['docs/**/*.md'] }); // explicit globs
defineMermaidTests({ extensions: ['crv'] }); // discover extra extensions
```

| Option | Type | Description |
| --- | --- | --- |
| `root` | `string` | Directory to discover files from. |
| `all` | `boolean` | Scan the filesystem instead of only git-tracked files. |
| `paths` | `string[]` | Explicit file globs to validate. |
| `ignore` | `string[]` | Globs to exclude. |
| `noGitignore` | `boolean` | Include gitignored files when scanning. |
| `extensions` | `string[]` | Extra file extensions to discover (beyond `.md`/`.mdx`/`.markdown`/`.mmd`). |

Requires `jest >= 27`. Discovery and validation are delegated to [`@mermaid-lint/core`](https://www.npmjs.com/package/@mermaid-lint/core).
