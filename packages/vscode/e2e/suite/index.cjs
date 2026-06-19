const path = require('node:path');
const Mocha = require('mocha');
const { glob } = require('glob');
async function run() {
  const mocha = new Mocha({ ui: 'tdd', color: true, timeout: 30000 });
  const root = __dirname;
  const files = await glob('**/*.etest.cjs', { cwd: root });
  for (const f of files) mocha.addFile(path.resolve(root, f));
  return new Promise((resolve, reject) => {
    mocha.run((failures) =>
      failures ? reject(new Error(`${failures} failing`)) : resolve(),
    );
  });
}
module.exports = { run };
