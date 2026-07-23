// Minimal in-process test harness for the VS Code extension host.
//
// Replaces mocha, which was removed to drop its vulnerable dev-only transitives
// (diff, serialize-javascript, js-yaml) — upstream mocha still pins the old
// versions, so an override was the only alternative. The extension-host contract
// is narrow enough that a full framework buys us little: tests must run in the
// SAME process as the live `vscode` API (so a subprocess runner like `node
// --test` can't reach it), and `index.cjs` must expose a `run()` that resolves
// on success and rejects on any failure. This covers exactly that.
//
// Authoring API mirrors mocha's tdd UI (`suite`/`test`) so test files read the
// same, but they import it explicitly instead of relying on injected globals.

const DEFAULT_TIMEOUT_MS = 30000;

const suites = [];
const rootTests = [];
let current = null;

function suite(name, fn) {
  const s = { name, tests: [] };
  suites.push(s);
  const prev = current;
  current = s;
  try {
    fn();
  } finally {
    current = prev;
  }
}

function test(name, fn) {
  (current ? current.tests : rootTests).push({ name, fn });
}

function withTimeout(fn, ms) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`timeout after ${ms}ms`)),
      ms,
    );
    if (typeof timer.unref === 'function') timer.unref();
    Promise.resolve()
      .then(fn)
      .then(resolve, reject)
      .finally(() => clearTimeout(timer));
  });
}

async function run() {
  const groups = [...suites];
  if (rootTests.length) groups.push({ name: '', tests: rootTests });

  let passed = 0;
  const failures = [];
  for (const s of groups) {
    if (s.name) console.log(`\n  ${s.name}`);
    for (const t of s.tests) {
      try {
        await withTimeout(t.fn, DEFAULT_TIMEOUT_MS);
        passed++;
        console.log(`    ✓ ${t.name}`);
      } catch (err) {
        failures.push({ name: `${s.name} ${t.name}`.trim(), err });
        console.log(`    ✗ ${t.name}`);
      }
    }
  }

  console.log(`\n  ${passed} passing, ${failures.length} failing`);
  for (const f of failures) {
    console.log(`\n  ${f.name}:`);
    console.log(String(f.err?.stack ?? f.err));
  }
  if (failures.length) throw new Error(`${failures.length} failing`);
}

module.exports = { suite, test, run };
