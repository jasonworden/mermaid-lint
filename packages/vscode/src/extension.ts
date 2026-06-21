import * as vscode from 'vscode';
import { loadCore } from './core.js';
import {
  type MermaidDiagnostic,
  computeMermaidDiagnostics,
} from './diagnostics.js';
import { computeFix } from './fix.js';

const SOURCE = 'mermaid-lint';
const FIX_ACTION_TITLE = 'Fix auto-fixable Mermaid issues';

function isEligible(doc: vscode.TextDocument): boolean {
  if (doc.uri.scheme !== 'file') return false;
  return doc.languageId === 'markdown' || doc.fileName.endsWith('.mmd');
}

function toRange(d: MermaidDiagnostic): vscode.Range {
  return new vscode.Range(d.startLine, d.startCol, d.endLine, d.endCol);
}

function toVscodeDiagnostic(d: MermaidDiagnostic): vscode.Diagnostic {
  const diag = new vscode.Diagnostic(
    toRange(d),
    d.message,
    d.severity === 'error'
      ? vscode.DiagnosticSeverity.Error
      : vscode.DiagnosticSeverity.Warning,
  );
  diag.source = SOURCE;
  return diag;
}

export function activate(context: vscode.ExtensionContext): void {
  const collection = vscode.languages.createDiagnosticCollection(SOURCE);
  context.subscriptions.push(collection);

  // Per-folder config cache; cleared when a config file changes.
  const configCache = new Map<
    string,
    Promise<{
      semantic?: boolean;
      strict?: boolean;
      fences?: ('backtick' | 'tilde')[];
    }>
  >();
  function getConfig(doc: vscode.TextDocument): Promise<{
    semantic?: boolean;
    strict?: boolean;
    fences?: ('backtick' | 'tilde')[];
  }> {
    const folder = vscode.workspace.getWorkspaceFolder(doc.uri);
    const key = folder?.uri.fsPath ?? '';
    let cached = configCache.get(key);
    if (!cached) {
      // Reach loadConfig through the dynamic-import bridge so the bundle never
      // statically require()s the ESM-only core (which would crash at load).
      cached = loadCore()
        .then(({ loadConfig }) => loadConfig(folder?.uri.fsPath))
        .catch(() => ({}));
      configCache.set(key, cached);
    }
    return cached;
  }

  const debounceTimers = new Map<string, NodeJS.Timeout>();
  function debounceMs(): number {
    return vscode.workspace
      .getConfiguration('mermaidLint')
      .get<number>('delay', 300);
  }
  function enabled(): boolean {
    return vscode.workspace
      .getConfiguration('mermaidLint')
      .get<boolean>('enable', true);
  }

  async function validate(doc: vscode.TextDocument): Promise<void> {
    if (!enabled() || !isEligible(doc)) {
      collection.delete(doc.uri);
      return;
    }
    const versionAtStart = doc.version;
    const cfg = await getConfig(doc);
    const diags = await computeMermaidDiagnostics(doc.fileName, doc.getText(), {
      semantic: cfg.semantic,
      strict: cfg.strict,
      fences: cfg.fences,
    });
    // Drop stale results: a newer edit superseded this run.
    if (doc.version !== versionAtStart) return;
    collection.set(doc.uri, diags.map(toVscodeDiagnostic));
  }

  function scheduleValidate(doc: vscode.TextDocument): void {
    // Skip ineligible docs up front so edits to unrelated files don't churn
    // debounce timers (validate() re-checks eligibility too).
    if (!isEligible(doc)) return;
    const key = doc.uri.toString();
    const existing = debounceTimers.get(key);
    if (existing) clearTimeout(existing);
    debounceTimers.set(
      key,
      setTimeout(() => {
        debounceTimers.delete(key);
        void validate(doc);
      }, debounceMs()),
    );
  }

  context.subscriptions.push(
    vscode.workspace.onDidOpenTextDocument((doc) => void validate(doc)),
    vscode.workspace.onDidChangeTextDocument((e) =>
      scheduleValidate(e.document),
    ),
    vscode.workspace.onDidSaveTextDocument((doc) => void validate(doc)),
    vscode.workspace.onDidCloseTextDocument((doc) => {
      const key = doc.uri.toString();
      const t = debounceTimers.get(key);
      if (t) clearTimeout(t);
      debounceTimers.delete(key);
      collection.delete(doc.uri);
    }),
  );

  // Re-lint when a mermaid-lint config file changes.
  const configWatcher = vscode.workspace.createFileSystemWatcher(
    '**/{.mermaidlintrc,.mermaidlintrc.*,mermaid-lint.config.*,package.json}',
  );
  const clearAndRelint = (): void => {
    configCache.clear();
    for (const doc of vscode.workspace.textDocuments) void validate(doc);
  };
  configWatcher.onDidChange(clearAndRelint);
  configWatcher.onDidCreate(clearAndRelint);
  configWatcher.onDidDelete(clearAndRelint);
  context.subscriptions.push(configWatcher);

  context.subscriptions.push(
    vscode.commands.registerCommand('mermaidLint.lintAllOpen', () => {
      for (const doc of vscode.workspace.textDocuments) void validate(doc);
    }),
  );

  // Quick-fix: apply core's fixText to the whole document.
  context.subscriptions.push(
    vscode.languages.registerCodeActionsProvider(
      [
        { scheme: 'file', language: 'markdown' },
        { scheme: 'file', pattern: '**/*.mmd' },
      ],
      {
        async provideCodeActions(doc) {
          const text = doc.getText();
          // Cheap guard: avoid loading core for Markdown files with no Mermaid.
          if (!doc.fileName.endsWith('.mmd') && !text.includes('```mermaid')) {
            return [];
          }
          const fixed = await computeFix(doc.fileName, text);
          if (fixed === null) return [];
          const action = new vscode.CodeAction(
            FIX_ACTION_TITLE,
            vscode.CodeActionKind.QuickFix,
          );
          const edit = new vscode.WorkspaceEdit();
          const fullRange = new vscode.Range(
            doc.positionAt(0),
            doc.positionAt(doc.getText().length),
          );
          edit.replace(doc.uri, fullRange, fixed);
          action.edit = edit;
          action.isPreferred = true;
          return [action];
        },
      },
      { providedCodeActionKinds: [vscode.CodeActionKind.QuickFix] },
    ),
  );

  // Lint everything already open at activation.
  for (const doc of vscode.workspace.textDocuments) void validate(doc);
}

export function deactivate(): void {}
