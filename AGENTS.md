# AGENTS.md

Guidance for AI agents and contributors working in this repo. Keep changes
consistent with what CI runs so local results match CI.

## Toolchain

This is a **pnpm workspace** monorepo. Use the repo's pinned tooling — never a
globally installed or `npx`-fetched version (see [Running tools](#running-tools)).

| Tool | Version | Source of truth |
|---|---|---|
| **pnpm** | `10.34.3` | `packageManager` field in `package.json` (CI's `pnpm/action-setup` reads it) |
| **Node** | `>=20` (CI runs `24`) | `engines.node`; `.github/workflows/ci.yml` |
| **TypeScript** | `5.9.x` (`^5.0.0`) | root `devDependencies` |
| **Vitest** | `4.1.x` (`^4.1.9`) | root `devDependencies` |
| **Vite** | `6.4.x` (`^6.4.3`) | root `devDependencies` |
| **Biome** (lint + format) | `1.9.4` (`^1.9.4`) | root `devDependencies` |
| **husky** | `9.1.x` | root `devDependencies` (pre-commit runs `lint-staged`) |
| **lint-staged** | `17.0.x` | runs `biome check --write` on staged JS/TS |

Consumer-side peer requirements worth knowing:

- `@mermaid-lint/markdownlint` requires `markdownlint >= 0.37` and, when run via
  markdownlint-cli2, **`markdownlint-cli2 >= 0.18`** — older cli2 versions bundle
  a markdownlint that predates async custom rules and silently skip the rule.

## Common commands

```sh
pnpm install                                   # install workspace deps
pnpm -r build                                  # build every package (tsc / esbuild)
pnpm test                                      # vitest run (core, cli, adapters)
pnpm --filter @mermaid-lint/jest test          # jest adapter suite
pnpm --filter mermaid-lint-vscode test:e2e     # VS Code extension host e2e (needs a display)
pnpm lint                                       # biome check . (lint + format check)
```

CI (`.github/workflows/ci.yml`) runs, in order: `pnpm lint` → `pnpm -r build`
→ `pnpm test` → jest adapter → (separate job) the VS Code e2e. Run these
locally before pushing.

## Running tools

**Prefer the repo's pinned binary over an ambient one.** A check that runs the
wrong tool version can pass locally and fail in CI (or vice versa).

- ✅ Run package scripts: `pnpm lint`, `pnpm test`, `pnpm -r build`.
- ✅ Run a local binary directly: `./node_modules/.bin/<tool>` (e.g.
  `./node_modules/.bin/biome check .`).
- ✅ Run a tool through pnpm: `pnpm exec <tool>`.
- ❌ Avoid `npx <tool>` and `pnpm dlx <tool>` for gating checks — both can
  resolve to a different version than the repo pins.

### Lint / format is Biome (not ESLint)

`pnpm lint` runs `biome check .`. When verifying a lint/format result that
gates a commit or PR, run the **repo's** Biome binary so the output matches CI:

```sh
./node_modules/.bin/biome check .          # check (matches `pnpm lint` / CI)
./node_modules/.bin/biome check --write .  # apply fixes
```

Do **not** rely on `npx biome` — it may resolve a different Biome version and
report a misleading "no issues" result.
