const path = require('node:path');
const { glob } = require('glob');
const harness = require('./harness.cjs');

// Loaded by @vscode/test-electron inside the running extension host. Requiring
// each *.etest.cjs registers its tests with the harness (see harness.cjs), then
// run() executes them in-process and rejects if any fail.
async function run() {
  const root = __dirname;
  const files = await glob('**/*.etest.cjs', { cwd: root });
  for (const f of files) require(path.resolve(root, f));
  return harness.run();
}
module.exports = { run };
