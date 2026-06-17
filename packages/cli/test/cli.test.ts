import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const BIN = resolve(import.meta.dirname, '../dist/cli.js');

function run(args: string[], cwd: string) {
  return spawnSync(process.execPath, [BIN, ...args], { cwd, encoding: 'utf8' });
}

describe('mermaid-lint CLI', () => {
  it('exits 0 for a file with a valid diagram', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'mermaid-lint-'));
    writeFileSync(
      join(tmp, 'valid.md'),
      '```mermaid\nflowchart LR\n  A --> B\n```\n',
    );
    const r = run([join(tmp, 'valid.md')], tmp);
    expect(r.status).toBe(0);
  });

  it('exits 1 for a file with an invalid diagram', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'mermaid-lint-'));
    writeFileSync(
      join(tmp, 'bad.md'),
      '```mermaid\nflowchart LR\n  A -->|broken\n```\n',
    );
    const r = run([join(tmp, 'bad.md')], tmp);
    expect(r.status).toBe(1);
    expect(r.stdout).toContain('parse error');
  });

  it('exits 2 when no files matched', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'mermaid-lint-'));
    const r = run(['/nonexistent/file.md'], tmp);
    expect(r.status).toBe(2);
  });

  it('prints --help without error', () => {
    const r = run(['--help'], '.');
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('Usage:');
  });

  it('--quiet suppresses per-file progress', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'mermaid-lint-'));
    writeFileSync(
      join(tmp, 'ok.md'),
      '```mermaid\nflowchart LR\n  A-->B\n```\n',
    );
    const noisy = run([join(tmp, 'ok.md')], tmp);
    const quiet = run(['--quiet', join(tmp, 'ok.md')], tmp);
    expect(quiet.stderr.length).toBeLessThan(noisy.stderr.length);
  });

  it('expands glob patterns', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'mermaid-lint-'));
    writeFileSync(
      join(tmp, 'a.md'),
      '```mermaid\nflowchart LR\n  A-->B\n```\n',
    );
    writeFileSync(
      join(tmp, 'b.md'),
      '```mermaid\nflowchart LR\n  C-->D\n```\n',
    );
    const r = run([join(tmp, '*.md')], tmp);
    expect(r.status).toBe(0);
    expect(r.stderr).toContain('checked 2 diagrams');
  });

  it('--format json outputs valid JSON to stdout', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'mermaid-lint-'));
    writeFileSync(
      join(tmp, 'ok.md'),
      '```mermaid\nflowchart LR\n  A-->B\n```\n',
    );
    const r = run(['--format', 'json', join(tmp, 'ok.md')], tmp);
    expect(r.status).toBe(0);
    const json = JSON.parse(r.stdout);
    expect(json.version).toBe('0.2.0');
    expect(json.files).toHaveLength(1);
    expect(json.files[0].diagrams[0].ok).toBe(true);
    expect(json.files[0].diagrams[0].type).toBe('flowchart');
    expect(json.summary.diagrams).toBe(1);
    expect(json.summary.ok).toBe(1);
    expect(json.summary.errors).toBe(0);
  });

  it('--format json includes error details for invalid diagram', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'mermaid-lint-'));
    writeFileSync(
      join(tmp, 'bad.md'),
      '```mermaid\nflowchart LR\n  A -->|broken\n```\n',
    );
    const r = run(['--format', 'json', join(tmp, 'bad.md')], tmp);
    expect(r.status).toBe(1);
    const json = JSON.parse(r.stdout);
    expect(json.summary.errors).toBe(1);
    expect(json.files[0].diagrams[0].ok).toBe(false);
    expect(json.files[0].diagrams[0].error.message).toBeTruthy();
  });

  it('--format json is silent on stderr', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'mermaid-lint-'));
    writeFileSync(
      join(tmp, 'ok.md'),
      '```mermaid\nflowchart LR\n  A-->B\n```\n',
    );
    const r = run(['--format', 'json', join(tmp, 'ok.md')], tmp);
    expect(r.stderr).toBe('');
  });

  it('exits 2 for unknown --format value', () => {
    const r = run(['--format', 'xml'], '.');
    expect(r.status).toBe(2);
  });

  it('validates .mmd files', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'mermaid-lint-'));
    writeFileSync(join(tmp, 'diagram.mmd'), 'flowchart LR\n  A-->B\n');
    const r = run([join(tmp, 'diagram.mmd')], tmp);
    expect(r.status).toBe(0);
  });

  it('emits a warning for duplicate node IDs in text mode', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'mermaid-lint-'));
    writeFileSync(
      join(tmp, 'dup.md'),
      '```mermaid\nflowchart LR\n  A[Start] --> B\n  A[Begin] --> C\n```\n',
    );
    const r = run([join(tmp, 'dup.md')], tmp);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('warning(');
    expect(r.stdout).toContain('duplicate-ids');
  });

  it('--no-semantic suppresses warnings', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'mermaid-lint-'));
    writeFileSync(
      join(tmp, 'dup.md'),
      '```mermaid\nflowchart LR\n  A[Start] --> B\n  A[Begin] --> C\n```\n',
    );
    const r = run(['--no-semantic', join(tmp, 'dup.md')], tmp);
    expect(r.status).toBe(0);
    expect(r.stdout).not.toContain('warning(');
  });

  it('--strict causes exit 1 when only warnings present', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'mermaid-lint-'));
    writeFileSync(
      join(tmp, 'dup.md'),
      '```mermaid\nflowchart LR\n  A[Start] --> B\n  A[Begin] --> C\n```\n',
    );
    const r = run(['--strict', join(tmp, 'dup.md')], tmp);
    expect(r.status).toBe(1);
  });

  it('--quiet suppresses warning lines but not errors', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'mermaid-lint-'));
    writeFileSync(
      join(tmp, 'dup.md'),
      '```mermaid\nflowchart LR\n  A[Start] --> B\n  A[Begin] --> C\n```\n',
    );
    const withWarnings = run([join(tmp, 'dup.md')], tmp);
    const withQuiet = run(['--quiet', join(tmp, 'dup.md')], tmp);
    expect(withWarnings.stdout).toContain('warning(');
    expect(withQuiet.stdout).not.toContain('warning(');
  });

  it('summary line includes warning count when warnings exist', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'mermaid-lint-'));
    writeFileSync(
      join(tmp, 'dup.md'),
      '```mermaid\nflowchart LR\n  A[Start] --> B\n  A[Begin] --> C\n```\n',
    );
    const r = run([join(tmp, 'dup.md')], tmp);
    expect(r.stderr).toContain('1 warning');
  });
});
