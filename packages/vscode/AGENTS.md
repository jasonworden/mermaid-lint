# Agent guide — `mermaid-lint-vscode`

Governance + gotchas for anyone (human or agent) working on this package. Read
before changing the build, the core integration, or the tests.

## Architecture invariants — do not break these

1. **Never statically `import` from `@mermaid-lint/core` in code that ends up in
   the bundle.** Reach core ONLY through `loadCore()` in `src/core.ts` (a cached
   dynamic `import()`).
   - Why: core is ESM-only and the VS Code host loads the extension entry as
     CommonJS. A static import of an external ESM module makes esbuild emit a
     top-level `require("@mermaid-lint/core")`, which throws `ERR_REQUIRE_ESM`
     at load — the extension never activates.
   - This already bit us once via a stray `import { loadConfig }`. Guard after
     building: `grep -c 'require("@mermaid-lint/core")' dist/extension.cjs` must
     be `0`; `grep -c 'import("@mermaid-lint/core")'` must be `1`.

2. **Keep `@mermaid-lint/core` in esbuild's `external` list; never bundle it.**
   - Why: core transitively pulls in **jsdom** (whose synchronous-XHR support
     shells out to a separate `xhr-sync-worker.js` child-process script that
     can't see bundled modules) and **merman** (wasm resolved via
     `createRequire(import.meta.url)`). Bundling either breaks validation at
     runtime even though the build "succeeds". The bundle must contain only the
     thin extension glue (~8kb); core + jsdom/mermaid/merman load from
     `node_modules` at runtime, exactly as the CLI and unit tests do.

3. **`package.json` must stay `"private": true`.** The monorepo publish job runs
   `pnpm -r publish`; private packages are skipped. This extension ships to the
   VS Code Marketplace (a separate, not-yet-wired step), never to npm.

4. **Pure logic stays free of the `vscode` module.** `src/diagnostics.ts` and
   `src/fix.ts` must not `import 'vscode'` — the root vitest suite runs them in
   plain Node. VS Code API usage lives only in `src/extension.ts`.

## Position mapping (correctness-critical)

`error.line` / `warning.line` from core are 1-indexed **within the diagram
body**. Map to a 0-indexed document line as:
`bodyStart = path.endsWith('.mmd') ? block.line : block.line + 1`, then
`docLine = bodyStart + bodyLine - 1` (or `block.line` when the body line is
undefined — unclosed/empty fence). The `.mmd` branch is what avoids an
off-by-one; there is a test guarding it.

## Tests

- **Unit (pure logic):** part of the root suite — `pnpm test` (from repo root).
  Discovered via `packages/*/test/**/*.test.ts`; `@mermaid-lint/core` is aliased
  to source. These do NOT exercise the bundle.
- **End-to-end (real VS Code host):** `pnpm --filter mermaid-lint-vscode test:e2e`.
  Uses `@vscode/test-electron` to launch a real VS Code, load the built
  extension, open the `demo/` files, and assert real diagnostics. This is the only check
  that exercises activation + the CJS bundle + the dynamic core import together.
  - **macOS gotcha:** VS Code's IPC socket lives under `--user-data-dir`; a deep
    worktree path overflows the 103-char Unix-socket limit. `e2e/runTest.cjs`
    pins `--user-data-dir` to a short `os.tmpdir()` path to avoid this.
  - **Linux/CI gotcha:** Electron needs a display. CI runs the suite under
    `xvfb-run` (see the `e2e` job in `.github/workflows/ci.yml`).
  - `@vscode/test-electron` downloads a full VS Code build into `.vscode-test/`
    (~800MB) — gitignored, and ignored by biome.

## Packaging (.vsix)

`pnpm --filter mermaid-lint-vscode package` → `scripts/package-vsix.sh`. It
stages a clean dir and `npm install`s `@mermaid-lint/core` from **npm** (not the
workspace) because the `.vsix` must ship a flat, symlink-free `node_modules`
(pnpm's symlinks can't be packaged by vsce, and core/jsdom/merman can't be
bundled). **Prerequisite:** the matching `@mermaid-lint/core` version must be on
npm first (merge a version bump to `main` → the release workflow publishes npm,
creates `v<version>`, and opens a GitHub Release). Test the mechanics against an
already-published version with `--core-version <ver>`. Never run `vsce` in the
package dir directly — it would package pnpm's symlinked `node_modules`.

## After any change, verify

```bash
pnpm -r build      # tsc --noEmit + esbuild; bundle must be warning-free
pnpm lint          # biome
pnpm test          # unit suite
pnpm --filter mermaid-lint-vscode test:e2e   # real VS Code host
```
