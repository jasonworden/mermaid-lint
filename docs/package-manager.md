# Package manager & toolchain

This repo is a **pnpm workspace**. The pnpm version is the single source of
truth in `package.json` → `packageManager`, and CI's `pnpm/action-setup` reads
it (no version is hardcoded in the workflow), so local and CI stay in lockstep.

## Pinned versions

| Tool | Version | Where it's pinned |
|---|---|---|
| **pnpm** | `10.34.3` | `packageManager` in `package.json` |
| **Node** | `>=20` (CI runs `24`) | `engines.node`; `.github/workflows/ci.yml` |
| **TypeScript** | `5.9.x` (`^5.0.0`) | root `devDependencies` |
| **Vitest** | `4.1.x` (`^4.1.9`) | root `devDependencies` |
| **Vite** | `6.4.x` (`^6.4.3`) | root `devDependencies` |
| **Biome** (lint + format) | `1.9.4` (`^1.9.4`) | root `devDependencies` |
| **husky** | `9.1.x` | root `devDependencies` (pre-commit → `lint-staged`) |
| **lint-staged** | `17.0.x` | runs `biome check --write` on staged JS/TS |

Consumer-side peer requirement worth knowing: `@mermaid-lint/markdownlint`
requires `markdownlint >= 0.37`, and when run via markdownlint-cli2,
**`markdownlint-cli2 >= 0.17`** — older cli2 versions bundle a markdownlint that
predates async custom rules and silently skip the rule.

## Run the repo's pinned binary, not an ambient one

A check that runs the wrong tool version can pass locally and fail in CI (or
vice versa). Prefer, in order:

- ✅ a package script — `pnpm lint`, `pnpm test`, `pnpm -r build`
- ✅ the local binary directly — `./node_modules/.bin/<tool>`
- ✅ `pnpm exec <tool>`
- ❌ avoid `npx <tool>` and `pnpm dlx <tool>` for gating checks — both can
  resolve to a different version than the repo pins

### Lint/format is Biome (not ESLint)

`pnpm lint` runs `biome check .`. When verifying a lint/format result that gates
a commit or PR, run the **repo's** Biome binary so output matches CI:

```sh
./node_modules/.bin/biome check .          # check (matches `pnpm lint` / CI)
./node_modules/.bin/biome check --write .  # apply fixes
```

Do **not** rely on `npx biome` — it may resolve a different Biome version and
report a misleading "no issues" result.
