// Thin adapter around zora (zero-dependency, in-process) for the VS Code
// extension-host e2e suite. zora replaces mocha, whose vulnerable dev-only
// transitives (diff, serialize-javascript) triggered Dependabot #13.
//
// The extension-host contract is narrow: tests must run in the SAME process as
// the live `vscode` API (so a subprocess runner like `node --test` or vitest
// can't reach it), and index.cjs must export a `run()` that resolves on success
// and rejects on failure. zora fits — createHarness() gives an in-process
// harness we drive manually, translating its result into that contract.
const { createHarness, createTAPReporter, hold } = require('zora');

// zora's default global harness auto-reports at process exit; hold() suppresses
// it so only our explicitly-driven harness produces output.
hold();

const harness = createHarness();

async function run() {
  // The harness exposes no aggregate pass/fail, so we read it off the message
  // stream: tee every message to the TAP reporter (human-readable CI output)
  // while watching for any failed assertion.
  let anyFailure = false;
  const tap = createTAPReporter();
  await harness.report({
    reporter: (stream) =>
      tap(
        (async function* () {
          for await (const message of stream) {
            if (message.type === 'ASSERTION' && message.data?.pass === false) {
              anyFailure = true;
            }
            yield message;
          }
        })(),
      ),
  });
  if (anyFailure) throw new Error('e2e tests failed');
}

module.exports = { test: harness.test, run };
