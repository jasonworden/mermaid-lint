# Node.js version support

If you install or import any `@mermaid-lint/*` package (or run the
`mermaid-lint` CLI), this page tells you which Node.js versions are supported and
what that guarantee is backed by.

## Supported versions

Every published package declares a runtime floor of **Node.js ≥20** via
`engines.node` (`">=20"`). Within that range:

| Node line | Status |
|---|---|
| 18 and older | **Not supported** — below the floor; install will warn or fail |
| 20 | Supported — minimum version |
| 22 | Supported |
| 24 | Supported — **recommended** (current LTS) |
| 26 | Supported — newest line |

"Supported" means the packages are **actively tested** on that Node version (see
[How this is verified](#how-this-is-verified) below), so you can rely on them
working there. If you're choosing a Node version for a new project, use the
current LTS (Node 24).

## What `engines.node` does on install

The `engines.node` field is a declaration your package manager reads at install
time:

- **npm** prints a warning if your Node is below the floor, but installs anyway
  (unless you set `engine-strict=true` in your `.npmrc`).
- **pnpm** and **Yarn** fail the install by default on a version mismatch.

So on Node 18 you'll see a warning (npm) or a hard error (pnpm/Yarn). On Node 20
or newer, install proceeds normally.

## How this is verified

A declaration alone wouldn't prove the code actually runs on the whole range —
so CI runs the **full test suite on every supported Node version**. The
[`test` job in `.github/workflows/ci.yml`](../.github/workflows/ci.yml) is a
matrix across Node **20, 22, 24, and 26**; a change that relies on an API newer
than the Node 20 floor fails the lower legs instead of shipping. That's the
backing behind the "supported" column above.

## When the supported range changes

The minimum Node version is part of the packages' public contract, so **raising
the floor is a breaking change** and ships as a corresponding version bump —
watch [release-history.md](release-history.md) for those. Newer Node lines are
added to the test matrix as they're released; the recommended pin tracks the
current LTS.

Maintainers: the CI split (why single-version jobs pin the LTS, how to move the
range) is documented in [AGENTS.md](../AGENTS.md).
