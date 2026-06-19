const assert = require('node:assert');
const path = require('node:path');
const vscode = require('vscode');

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

suite('mermaid-lint-vscode (real VS Code host)', () => {
  test('flags an invalid .mmd file with an Error diagnostic', async () => {
    const uri = vscode.Uri.file(path.join(__dirname, 'fixtures', 'bad.mmd'));
    const doc = await vscode.workspace.openTextDocument(uri);
    await vscode.window.showTextDocument(doc);
    const diags = await waitForDiagnostics(uri, (d) => d.length >= 1, 25000);
    assert.strictEqual(
      diags[0].severity,
      vscode.DiagnosticSeverity.Error,
      'severity',
    );
    assert.strictEqual(diags[0].source, 'mermaid-lint', 'source');
    assert.strictEqual(
      diags[0].range.start.line,
      1,
      'line (0-indexed body line 2)',
    );
  });

  test('reports no diagnostics for a valid .md file', async () => {
    const uri = vscode.Uri.file(path.join(__dirname, 'fixtures', 'good.md'));
    const doc = await vscode.workspace.openTextDocument(uri);
    await vscode.window.showTextDocument(doc);
    // give the extension time to (not) produce diagnostics
    await new Promise((r) => setTimeout(r, 4000));
    assert.strictEqual(vscode.languages.getDiagnostics(uri).length, 0);
  });
});
