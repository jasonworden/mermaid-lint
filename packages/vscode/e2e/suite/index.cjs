// zora's per-test timeout defaults to 5s and is captured when the module is
// first required, so it must be set before requiring zora. These e2e tests are
// slow — real extension activation plus a deliberate "wait for no diagnostics"
// pause — and exceed 5s on CI runners (mocha previously used timeout: 30000).
process.env.ZORA_TIMEOUT = process.env.ZORA_TIMEOUT || '30000';

const path = require('node:path');
const { glob } = require('glob');
const { hold, report, createTAPReporter } = require('zora');

// zora replaces mocha here — its vulnerable dev-only transitives (diff,
// serialize-javascript) triggered Dependabot #13, and zora is zero-dependency.
// The e2e tests must run in-process with the live `vscode` API (so a subprocess
// runner like `node --test` or vitest can't reach them). zora's default harness
// auto-reports at process exit; hold() defers that so run() can drive it and
// surface the result through the resolve/reject contract @vscode/test-electron
// expects. zora sets process.exitCode on any failure, which is our signal.
hold();

async function run() {
  const root = __dirname;
  const files = await glob('**/*.etest.cjs', { cwd: root });
  for (const f of files) require(path.resolve(root, f));
  await report({ reporter: createTAPReporter() });
  if (process.exitCode) throw new Error('e2e tests failed');
}
module.exports = { run };
