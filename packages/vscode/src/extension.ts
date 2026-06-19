import type * as vscode from 'vscode';
import { computeMermaidDiagnostics } from './diagnostics.js';
import { computeFix } from './fix.js';

export function activate(_context: vscode.ExtensionContext): void {
  // Wiring implemented in Task 2.
  void computeMermaidDiagnostics;
  void computeFix;
}

export function deactivate(): void {}
