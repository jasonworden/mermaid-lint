import { build } from 'esbuild';

await build({
  entryPoints: ['src/extension.ts'],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node20',
  outfile: 'dist/extension.cjs',
  // `vscode` is provided by the host. `@mermaid-lint/core` is kept external —
  // NOT bundled — on purpose: it transitively pulls in jsdom, whose synchronous
  // XHR support shells out to a separate `xhr-sync-worker.js` child-process
  // script that cannot see esbuild-bundled modules. Bundling jsdom therefore
  // breaks mermaid.js validation at runtime. Leaving core external lets it load
  // from node_modules exactly as the CLI and test suite do, where jsdom, mermaid
  // and merman all resolve normally. The bundle then contains only the thin
  // extension glue. (A self-contained publishable .vsix would ship core's
  // node_modules alongside dist/ — see README; publishing is out of scope here.)
  external: ['vscode', '@mermaid-lint/core'],
  logLevel: 'info',
});
