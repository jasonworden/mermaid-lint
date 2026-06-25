# Astro

[Astro](https://astro.build/) has strong built-in support for Markdown content,
but Mermaid rendering is usually added with a custom Markdown processor, a
remark/rehype plugin, or a component-based runtime. `mermaid-lint` fits in as
the validation layer: it checks the Mermaid source in your authored Markdown
and MDX before Astro builds the site.

## Recommended setup

For most Astro content sites, the best MVP is:

1. Render Mermaid however the site already does today.
2. Run Mermaid validation inside the Markdown lint pipeline with
   `markdownlint-cli2` and `@mermaid-lint/markdownlint`.
3. Keep `astro check` and `astro build` as separate site-level validation.
4. Use the dedicated VS Code extension for live diagnostics while editing.

That keeps responsibilities clean:

- Astro handles content rendering and site correctness.
- `mermaid-lint` handles Mermaid source validation.

## What works today

`mermaid-lint` already validates Mermaid fenced blocks in `.md`, `.markdown`,
`.mdx`, and `.mmd` files, which maps well onto common Astro content layouts:

- `src/content/**/*.md`
- `src/content/**/*.mdx`
- `src/pages/**/*.md`
- top-level docs such as `README.md` and `docs/**/*.md`
- standalone `.mmd` files kept next to content

This is especially useful in Astro repos where diagrams live in blog posts,
docs pages, or content collections instead of in application code.

If Astro is still syntax-highlighting Mermaid blocks as plain code, exclude the
language from the default code highlighter:

```ts
// astro.config.ts
import { defineConfig } from 'astro/config';

export default defineConfig({
  markdown: {
    syntaxHighlight: {
      type: 'shiki',
      excludeLangs: ['mermaid', 'math'],
    },
  },
});
```

That matches Astro's current docs guidance for diagram-oriented code blocks.

## Markdown lint pipeline

For Astro specifically, the best current integration is usually **not** a
separate `mermaid-lint` CLI step. Instead, fold Mermaid validation into the
same Markdown hygiene pass that already owns authored content:

```bash
pnpm add -D markdownlint-cli2 @mermaid-lint/markdownlint
```

```js
// .markdownlint-cli2.mjs
import mermaid from '@mermaid-lint/markdownlint';

export default {
  globs: ['README.md', 'docs/**/*.md', 'src/content/**/*.md', 'src/content/**/*.mdx'],
  ignores: ['node_modules/**', 'dist/**', '.astro/**'],
  customRules: mermaid,
  config: {
    default: true,
  },
};
```

Then wire it into package scripts:

```json
{
  "scripts": {
    "lint:markdown": "markdownlint-cli2",
    "check": "astro check",
    "verify": "pnpm lint:markdown && pnpm check && pnpm build"
  }
}
```

This is a good fit for Astro because the diagrams usually live inside the same
Markdown and MDX files you already want to lint for prose quality and content
consistency.

## Editor setup

The best editor experience in an Astro repo is usually the dedicated
`mermaid-lint` VS Code extension. It gives live Mermaid diagnostics inside
Markdown and MDX fences, and it also covers standalone `.mmd` files.

If the repo already standardizes on the markdownlint VS Code extension,
`@mermaid-lint/markdownlint` remains a strong CI and on-save path. But the
dedicated extension is still the simpler default recommendation for authoring.

## What `mermaid-lint` validates in Astro

`mermaid-lint` is validating the Mermaid source blocks inside your content. It
does a good job at:

- real Mermaid syntax errors
- line/column diagnostics
- optional semantic warnings such as duplicate IDs
- mechanical fixes such as `->` to `-->`

It is **not** validating the rest of the Astro rendering pipeline. For example,
it does not check:

- frontmatter or content collection schemas
- custom remark/rehype transforms outside the Mermaid fence body
- client-side Mermaid initialization or hydration behavior
- site CSS or theme-specific visual differences after render

That separation is healthy. Let Astro own rendering and build correctness; let
`mermaid-lint` own Mermaid authoring correctness.

## Current recommendation

If you want the shortest path to a good Astro setup today:

1. Keep your existing Astro-side Mermaid rendering approach.
2. Add `markdownlint-cli2` and `@mermaid-lint/markdownlint`.
3. Run `pnpm lint:markdown` as part of a single `pnpm verify` gate.
4. Install the VS Code extension for authors.

A concrete example of this pattern is
[jasonworden/jasonworden.github.io#45](https://github.com/jasonworden/jasonworden.github.io/pull/45),
which moved Mermaid validation into the Markdown lint flow instead of keeping a
separate diagram-only check.

## Future follow-up

Two improvements would make the Astro story even better, but they are future
work rather than today's recommendation:

- a starter Astro template repo with Prettier, ESLint, Playwright,
  `markdownlint-cli2`, and `mermaid-lint` already wired together
- a more turnkey Astro recipe or integration package that pairs a rendering
  strategy with the recommended lint/verify scripts out of the box
