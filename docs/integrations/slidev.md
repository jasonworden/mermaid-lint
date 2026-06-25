# Slidev

[Slidev](https://sli.dev/) already supports Mermaid diagrams natively: fenced
code blocks marked as `mermaid` are rendered as diagrams in Slidev Markdown.
`mermaid-lint` fits in as the validation layer that catches broken diagrams
before they reach presentation time.

## Recommended setup

For most Slidev projects, the best MVP is:

1. Use the `mermaid-lint` CLI in local scripts, CI, or pre-commit.
2. Use the dedicated VS Code extension for live squiggles while editing slides.
3. Add markdownlint integration only if your project already uses markdownlint.

That gives you real Mermaid validation without needing any Slidev-specific
addon.

## What works today

Slidev decks are Markdown-driven, with `slides.md` as the default entry point.
`mermaid-lint` already validates Mermaid fenced blocks in `.md`,
`.markdown`, `.mdx`, and `.mmd` files, so Slidev content fits the existing
workflow well.

This means the following work out of the box:

- `slides.md`
- additional Markdown files pulled in via Slidev's `src:` support
- standalone `.mmd` files you keep alongside slide content

`mermaid-lint` also accepts normal Mermaid fence syntax with extra info after
`mermaid`, which matters because Slidev supports block options like
````md
```mermaid {theme: 'neutral', scale: 0.8}
graph TD
  A --> B
```
````

## CLI / CI

If your deck lives in one entry file, this can be enough:

```bash
npx mermaid-lint slides.md
```

If your deck is split across multiple Markdown files, lint the whole slide
surface:

```bash
npx mermaid-lint "slides.md" "slides/**/*.md"
```

For repeatable project setup, add a config file like:

```js
// mermaid-lint.config.js
export default {
  files: ['slides.md', 'slides/**/*.md', '**/*.mmd'],
  ignore: ['dist/**'],
};
```

Then `npx mermaid-lint` is enough.

For CI and pre-commit recipes, reuse the normal docs in
[`../ci-and-precommit.md`](../ci-and-precommit.md).

## Editor setup

The best editor experience in a Slidev repo is usually the dedicated
`mermaid-lint` VS Code extension. It gives live diagnostics inside Markdown
fences without extra markdownlint wiring, and it also covers standalone `.mmd`
files.

If your team already uses the markdownlint VS Code extension and
`markdownlint-cli2`, `@mermaid-lint/markdownlint` is a good secondary option.
But for a Slidev project specifically, the dedicated extension is the simpler
default recommendation.

## Optional markdownlint integration

If the Slidev project already runs markdownlint, layer Mermaid validation into
that existing pipeline instead of creating a second Markdown linter:

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

That is especially useful when the project already expects
`markdownlint-cli2 --fix`, because the `mermaid-syntax` rule can apply the same
mechanical Mermaid fixes as the CLI.

## What `mermaid-lint` validates in Slidev

`mermaid-lint` is validating the Mermaid source inside your slide Markdown. It
does a good job at:

- real Mermaid syntax errors
- line/column diagnostics
- optional semantic warnings such as duplicate IDs
- mechanical fixes such as `->` to `-->`

It is **not** validating the rest of the Slidev presentation runtime. For
example, it does not check:

- Slidev layouts, frontmatter, or Vue components
- renderer-specific visual differences after Slidev renders a valid diagram
- behavior introduced by a custom Mermaid renderer beyond normal Mermaid syntax

That last point matters because Slidev supports both `setup/mermaid.ts` for
Mermaid config and `setup/mermaid-renderer.ts` for swapping in a custom
renderer. `mermaid-lint` still provides useful source validation there, but it
should not be described as a full validator for renderer-specific output.

## Current recommendation

If you want the shortest path to a good Slidev setup today:

1. Add `mermaid-lint.config.js` covering your slide files.
2. Run `npx mermaid-lint` in CI or pre-commit.
3. Install the VS Code extension for authoring-time feedback.

That is already a solid integration story, even before any Slidev-specific
tooling exists.

## Future follow-up

Two improvements would make the Slidev story even better, but they are future
work rather than today's recommendation:

- a starter/template repo with Slidev, Playwright, markdownlint, and
  `mermaid-lint` already wired together
- a thin Slidev addon that surfaces `mermaid-lint` diagnostics in a more
  Slidev-native way during deck development
