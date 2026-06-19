const path = require('node:path');
const os = require('node:os');
const { runTests } = require('@vscode/test-electron');

async function main() {
  try {
    // macOS Unix-domain sockets cap at 103 chars; deep worktree paths blow past
    // it, so point VS Code's user-data-dir at a short temp path.
    const userDataDir = path.join(os.tmpdir(), 'mlvsc-ud');
    await runTests({
      extensionDevelopmentPath: path.resolve(__dirname, '..'),
      extensionTestsPath: path.resolve(__dirname, 'suite', 'index.cjs'),
      launchArgs: ['--disable-extensions', `--user-data-dir=${userDataDir}`],
    });
  } catch (e) {
    console.error('E2E_FAILED:', e?.message ?? e);
    process.exit(1);
  }
}
main();
