// `@mermaid-lint/core` is ESM-only and transitively pulls in jsdom and merman,
// neither of which can be esbuild-bundled: jsdom's synchronous-XHR support
// shells out to a separate `xhr-sync-worker.js` child-process script that
// cannot see bundled modules, and merman resolves its wasm via
// `createRequire(import.meta.url)`. The VS Code host loads the extension entry
// as CommonJS, so core is marked `external` in esbuild and loaded here through
// a single cached dynamic `import()` — the standard CJS→ESM bridge. core (and
// jsdom/mermaid/merman) then resolve from node_modules at runtime, exactly as
// the CLI and the test suite do.
let cached: Promise<typeof import('@mermaid-lint/core')> | null = null;

export function loadCore(): Promise<typeof import('@mermaid-lint/core')> {
  if (!cached) cached = import('@mermaid-lint/core');
  return cached;
}
