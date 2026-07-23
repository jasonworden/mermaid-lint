# AGENTS.md

Orientation for AI agents and contributors. Keep changes consistent with what
CI runs, and follow the existing patterns in the package you're editing.

## What this is

`mermaid-lint` validates [Mermaid](https://mermaid.js.org/) diagrams embedded in
Markdown (and standalone `.mmd` files). It's a **pnpm workspace** monorepo: one
core engine plus thin adapters that plug it into different linters and editors.

Validation is **two-tier**: a fast Rust/WASM parser ([merman](https://github.com/Latias94/merman))
is the fast path; on any error it falls back to **mermaid.js itself** (the
authoritative parser) for precise line/col and verdict. Separately, semantic
checks flag diagrams that parse but render wrong (e.g. duplicate node IDs) —
these are *warnings*, opt-in via `strict`. See
[docs/parsing-vs-linting.md](docs/parsing-vs-linting.md) for the why.

## Packages

| Package | What it is |
|---|---|
| `@mermaid-lint/core` | The engine: extraction, validation, semantic checks, discovery, config, autofix. Everything else depends on it. |
| `@mermaid-lint/cli` | `mermaid-lint` command — scans files / stdin, `--fix`, text or JSON output. |
| `@mermaid-lint/markdownlint` | markdownlint async custom rules — one per check (`mermaid-syntax` + `mermaid-<rule-id>`); `recommended`/`all` bundles. `mermaid-syntax` also emits `fixInfo`, so `markdownlint-cli2 --fix` mechanically corrects blocks (arrows, missing colons) via core's `fixBlockBody`. |
| `@mermaid-lint/remark` | remark-lint plugin (`strict` + per-rule `rules` options). remark has no lint-fixer API, so autofix ships as a **separate transformer** `remarkMermaidFix` (mutates `Code` node values via core's `fixBlockBody`); takes effect on `remark --output`. |
| `@mermaid-lint/textlint` | textlint rule (`strict` + per-rule `rules` options); also a **fixer** (`{ linter, fixer }`), so `textlint --fix` mechanically corrects blocks via core's `fixBlockBody` (whole-node `replaceText`). |
| `@mermaid-lint/jest` / `@mermaid-lint/vitest` | Test-runner adapters: `defineMermaidTests` (with `strict`/`rules`) + `lintMermaidFiles`. |
| `mermaid-lint-vscode` | VS Code extension — inline squiggles, hover, quick-fix; honors config `strict`/`semantic`/`rules`/`fences`. |

**Integrations are thin.** They extract Mermaid blocks from the host's AST (or
via core's extractor) and delegate to core's shared adapter —
`blockToDiagnostics(block)` / `lintMarkdown(path, text, opts)` in
`packages/core/src/markdown-adapter.ts` — which returns normalized `Diagnostic`
objects. When changing validation behavior, change it in core; the adapters
should stay lockstep. Note that `remark`/`textlint` rely on the host's own
CommonMark parser, while `cli`/`markdownlint`/`jest`/`vitest`/`vscode` use
core's `extractMermaidBlocks`.

### Core source map (`packages/core/src/`)

- `extract.ts` / `fences.ts` — find Mermaid fenced blocks (CommonMark fences).
- `validate.ts` + `merman.ts` — the two-tier parser (WASM → mermaid.js).
- `semantic.ts` — opt-in semantic warnings.
- `markdown-adapter.ts` — `blockToDiagnostics` / `lintMarkdown` (the shared API).
- `config.ts` — `.mermaidlintrc` / config-file loading.
- `fix.ts` — `--fix` autofixer. `discover.ts` — file discovery. `type-detect.ts` — diagram-type sniffing.

## Build, test, lint

```sh
pnpm install                                   # install workspace deps
pnpm -r build                                  # build every package (tsc / esbuild)
pnpm test                                      # vitest run (core, cli, adapters)
pnpm --filter @mermaid-lint/jest test          # jest adapter suite
pnpm --filter mermaid-lint-vscode test:e2e     # VS Code extension-host e2e (needs a display)
pnpm lint                                       # biome check . (lint + format)
```

CI (`.github/workflows/ci.yml`) has three jobs: a run-once `quality` job (lint →
build → typedoc API-docs + Cloudflare safety check), a `test` job across a Node
matrix (20/22/24/26), and a single-Node VS Code e2e job — see
[docs/node-support.md](docs/node-support.md) for why it's split this way. Run
these locally before pushing. **Lint/format is [Biome](https://biomejs.dev), not
ESLint** — and run the repo's pinned binaries rather than `npx`; see
[docs/package-manager.md](docs/package-manager.md).

## Conventions

- **Match the surrounding code** — comment density, naming, and idioms vary a
  little per package; follow the file you're in.
- **Commits:** Conventional Commits (`feat:`, `fix:`, `chore:`, `docs:`…).
- **Versioning:** the `@mermaid-lint/*` packages move in **lockstep**; bump them
  together (minor for features, patch for fixes). `mermaid-lint-vscode` versions
  on its own track. CI publishes on a `v*` tag. When you bump the version, also
  update the `--format json` `version` assertions in
  `packages/cli/test/cli.test.ts` (they hard-code the current version).
- **Read the closest `AGENTS.md` first.** When editing inside a package or
  subdirectory, follow the nearest guide before this root one; `packages/vscode/AGENTS.md`
  is especially important for extension work.
- **Keep published packages on the declared runtime floor.** Code in published
  packages must stay compatible with `package.json` `engines.node` (`>=20`); CI's
  `test` matrix (Node 20/22/24/26) fails the lower legs if you use a newer API.
  Single-version jobs (`quality`, `e2e`) pin the latest LTS (Node 24); bump to
  the next LTS (26) when it lands, and add newer Node lines to the matrix as they
  ship. The consumer-facing support statement lives in
  [docs/node-support.md](docs/node-support.md) — keep it in sync.
- **Every published package needs a `README.md`.** npm shows "no README data"
  for any package without one, and a README only reaches npm on the *next*
  publish — so a README added after a version shipped won't appear until the
  version is bumped again. When you add a package (or change one's purpose/API),
  add or update its `README.md` in the same change; keep it in sync with the
  matching section of the root [README.md](README.md). `mermaid-lint-vscode` is
  `private` (Marketplace, not npm) but still ships a README.
- **Treat `fixBlockBody` as a mechanical contract.** Keep it line-count
  preserving and limited to syntax-only fixes so markdownlint, remark, and
  textlint can map fixes back to source correctly.
- **When validation behavior changes, update core first and test both surfaces.**
  For extraction, line mapping, or diagnostics, cover fenced Markdown and
  standalone `.mmd` flows whenever they could differ.
- **Docs consistency tests cover release/documentation drift.** When adding or
  removing a package, bumping package versions, changing the CLI JSON version,
  moving docs, or editing package-manager docs, update the matching package
  `README.md`, root README package table, [docs/json-output.md](docs/json-output.md),
  [docs/package-manager.md](docs/package-manager.md), and local Markdown link
  paths as needed. `pnpm test` fails if package READMEs, lockstep versions,
  workspace dependencies, documented current versions, or local doc link paths
  drift.
- **Semantic rule docs stay in sync.** When adding, removing, renaming, or
  changing a semantic rule, update the rule metadata in
  `packages/core/src/rules.ts`, the rule reference in
  [docs/semantic-rules.md](docs/semantic-rules.md), and the README "Diagram
  types" related-rules column. `pnpm test` includes a coverage check that fails
  when these drift.
- **Don't skip hooks** (`--no-verify`); if husky/lint-staged blocks, fix the cause.
- **API docs (Cloudflare Pages):** keep `"router": "structure"` in
  `packages/core/typedoc.json`. The default `kind` router emits a top-level
  `functions/` dir, which collides with Cloudflare Pages' reserved Functions
  directory and silently drops those pages from the deploy. CI enforces this via
  `scripts/check-docs-cloudflare-safe.mjs`; see [docs/cloudflare-docs-setup.md](docs/cloudflare-docs-setup.md).

## More docs

- [docs/parsing-vs-linting.md](docs/parsing-vs-linting.md) — parsing vs. linting, and why some hosts can't run the validator.
- [docs/package-manager.md](docs/package-manager.md) — pinned toolchain versions and the "use the repo's binary, not `npx`" rule.
- [docs/node-support.md](docs/node-support.md) — supported Node versions and how the CI matrix proves compatibility.
- [README.md](README.md) — user-facing usage, configuration, and per-integration setup.
