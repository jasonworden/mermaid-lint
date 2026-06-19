# Mermaid Lint for VS Code

Live [Mermaid](https://mermaid.js.org/) diagram validation, right in the editor.
Invalid diagrams get red squiggles as you type — in Markdown fenced
` ```mermaid ` blocks **and** in standalone `.mmd` files.

Powered by [`@mermaid-lint/core`](https://www.npmjs.com/package/@mermaid-lint/core),
the same engine behind the `mermaid-lint` CLI, so the editor matches CI.

## Features

- **Inline diagnostics** on invalid Mermaid in `.md` / `.markdown` fenced blocks
  and in `.mmd` files — hover for the error message.
- **Problems panel** entries that jump to the offending line.
- **Debounced on-type validation** — see errors as you edit, not just on save.
- **Quick-fix code actions** — apply mermaid-lint's mechanical autocorrections
  (`--fix`) without leaving the editor.
- **Config-aware** — respects your project's mermaid-lint config file
  (`.mermaidlintrc`, `mermaid-lint.config.js`, the `mermaidLint` key in
  `package.json`, …). `strict` and `semantic` settings carry over from the CLI.

## Settings

| Setting | Default | Description |
|---|---|---|
| `mermaidLint.enable` | `true` | Enable/disable validation. |
| `mermaidLint.delay` | `300` | Debounce delay (ms) before validating after a change. |

Whether semantic warnings are reported, and whether they are treated as errors
(`strict`), is read from your project's mermaid-lint config file rather than a
VS Code setting, so behavior matches `mermaid-lint` on the command line.

## Commands

- **Mermaid Lint: Re-lint open documents** (`mermaidLint.lintAllOpen`)

## Running from source

This extension lives in the [mermaid-lint](https://github.com/jasonworden/mermaid-lint)
monorepo. To try it:

```bash
pnpm install
pnpm -r build
```

Then open the repo in VS Code and press `F5` to launch an Extension Development
Host with the extension loaded.

## Status

Not yet published to the VS Code Marketplace. The extension loads
`@mermaid-lint/core` (which embeds jsdom and mermaid.js) from `node_modules` at
runtime rather than inlining it into the bundle, so packaging a self-contained
`.vsix` requires shipping that dependency tree — a follow-up task.

## Relationship to `@mermaid-lint/markdownlint`

If you already use the [markdownlint](https://github.com/DavidAnson/markdownlint)
VS Code extension, [`@mermaid-lint/markdownlint`](https://www.npmjs.com/package/@mermaid-lint/markdownlint)
gives you Mermaid squiggles in `.md` files through that toolchain. This dedicated
extension additionally covers `.mmd` files and offers quick-fixes, and needs no
markdownlint configuration.
