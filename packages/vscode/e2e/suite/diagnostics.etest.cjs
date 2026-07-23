const path = require('node:path');
const vscode = require('vscode');
const { test } = require('./harness.cjs');

// Shared with the human-facing demo: packages/vscode/demo/.
const DEMO_DIR = path.join(__dirname, '..', '..', 'demo');

function waitForDiagnostics(uri, predicate, timeoutMs) {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + timeoutMs;
    const tick = () => {
      const d = vscode.languages.getDiagnostics(uri);
      if (predicate(d)) return resolve(d);
      if (Date.now() > deadline)
        return reject(new Error(`timeout; got ${JSON.stringify(d)}`));
      setTimeout(tick, 200);
    };
    tick();
  });
}

test('mermaid-lint-vscode (real VS Code host)', async (t) => {
  await t.test(
    'flags an invalid .mmd file with an Error diagnostic',
    async (t) => {
      const uri = vscode.Uri.file(path.join(DEMO_DIR, 'bad.mmd'));
      const doc = await vscode.workspace.openTextDocument(uri);
      await vscode.window.showTextDocument(doc);
      const diags = await waitForDiagnostics(uri, (d) => d.length >= 1, 25000);
      t.eq(diags[0].severity, vscode.DiagnosticSeverity.Error, 'severity');
      t.eq(diags[0].source, 'mermaid-lint', 'source');
      t.eq(diags[0].range.start.line, 1, 'line (0-indexed body line 2)');
    },
  );

  await t.test('reports no diagnostics for a valid .md file', async (t) => {
    const uri = vscode.Uri.file(path.join(DEMO_DIR, 'good.md'));
    const doc = await vscode.workspace.openTextDocument(uri);
    await vscode.window.showTextDocument(doc);
    // give the extension time to (not) produce diagnostics
    await new Promise((r) => setTimeout(r, 4000));
    t.eq(vscode.languages.getDiagnostics(uri).length, 0, 'no diagnostics');
  });
});
