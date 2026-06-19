import { build } from 'esbuild';

await build({
  entryPoints: ['src/extension.ts'],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node20',
  outfile: 'dist/extension.cjs',
  // vscode is provided by the host; the rest are jsdom's optional native deps
  // that it require()s inside try/catch at runtime.
  external: ['vscode', 'canvas', 'bufferutil', 'utf-8-validate'],
  logLevel: 'info',
});
