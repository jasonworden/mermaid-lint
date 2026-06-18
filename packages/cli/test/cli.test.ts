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
    expect(json.version).toBe('0.3.0');
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
    expect(r.stdout).toContain('warning:');
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
    expect(r.stdout).not.toContain('warning:');
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
    expect(withWarnings.stdout).toContain('warning:');
    expect(withQuiet.stdout).not.toContain('warning:');
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

  it('--format json includes warnings for duplicate node IDs', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'mermaid-lint-'));
    writeFileSync(
      join(tmp, 'dup.md'),
      '```mermaid\nflowchart LR\n  A[Start] --> B\n  A[Begin] --> C\n```\n',
    );
    const r = run(['--format', 'json', join(tmp, 'dup.md')], tmp);
    expect(r.status).toBe(0);
    const json = JSON.parse(r.stdout);
    expect(json.version).toBe('0.3.0');
    expect(json.files[0].diagrams[0].warnings).toHaveLength(1);
    expect(json.files[0].diagrams[0].warnings[0].rule).toBe('duplicate-ids');
    expect(json.summary.warnings).toBe(1);
  });

  it('--format json with --no-semantic omits warnings', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'mermaid-lint-'));
    writeFileSync(
      join(tmp, 'dup.md'),
      '```mermaid\nflowchart LR\n  A[Start] --> B\n  A[Begin] --> C\n```\n',
    );
    const r = run(
      ['--format', 'json', '--no-semantic', join(tmp, 'dup.md')],
      tmp,
    );
    expect(r.status).toBe(0);
    const json = JSON.parse(r.stdout);
    expect(json.files[0].diagrams[0].warnings).toEqual([]);
    expect(json.summary.warnings).toBe(0);
  });

  it('reports correct line number for .mmd file warnings', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'mermaid-lint-'));
    // Body line 1 = file line 1 (no fence opener in .mmd files)
    // A[Start] is line 2, A[Begin] is line 3 → warning should report line 3
    writeFileSync(
      join(tmp, 'dup.mmd'),
      'flowchart LR\n  A[Start] --> B\n  A[Begin] --> C\n',
    );
    const r = run([join(tmp, 'dup.mmd')], tmp);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('warning:');
    // Line 3 is where the conflicting A[Begin] declaration appears
    expect(r.stdout).toContain(':3:');
  });

  it('--format json with --strict exits 1 when only warnings present', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'mermaid-lint-'));
    writeFileSync(
      join(tmp, 'dup.md'),
      '```mermaid\nflowchart LR\n  A[Start] --> B\n  A[Begin] --> C\n```\n',
    );
    const r = run(['--format', 'json', '--strict', join(tmp, 'dup.md')], tmp);
    expect(r.status).toBe(1);
  });

  it('reads strict from .mermaidlintrc.json config file', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'mermaid-lint-'));
    writeFileSync(
      join(tmp, '.mermaidlintrc.json'),
      JSON.stringify({ strict: true }),
    );
    writeFileSync(
      join(tmp, 'dup.md'),
      '```mermaid\nflowchart LR\n  A[Start] --> B\n  A[Begin] --> C\n```\n',
    );
    // strict from config → exit 1 even though only warnings
    const r = run([join(tmp, 'dup.md')], tmp);
    expect(r.status).toBe(1);
  });

  it('CLI --no-semantic flag overrides config semantic:true', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'mermaid-lint-'));
    writeFileSync(
      join(tmp, '.mermaidlintrc.json'),
      JSON.stringify({ strict: true }),
    );
    writeFileSync(
      join(tmp, 'dup.md'),
      '```mermaid\nflowchart LR\n  A[Start] --> B\n  A[Begin] --> C\n```\n',
    );
    // --no-semantic suppresses warnings so strict has nothing to fail on
    const r = run(['--no-semantic', join(tmp, 'dup.md')], tmp);
    expect(r.status).toBe(0);
  });

  it('reads format from mermaid-lint.config.js', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'mermaid-lint-'));
    writeFileSync(
      join(tmp, 'mermaid-lint.config.js'),
      'export default { format: "json" };\n',
    );
    writeFileSync(
      join(tmp, 'ok.md'),
      '```mermaid\nflowchart LR\n  A-->B\n```\n',
    );
    const r = run([join(tmp, 'ok.md')], tmp);
    expect(r.status).toBe(0);
    // format: json from config → stdout is valid JSON
    expect(() => JSON.parse(r.stdout)).not.toThrow();
  });

  it('CLI --format text overrides config format:json', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'mermaid-lint-'));
    writeFileSync(
      join(tmp, '.mermaidlintrc.json'),
      JSON.stringify({ format: 'json' }),
    );
    writeFileSync(
      join(tmp, 'ok.md'),
      '```mermaid\nflowchart LR\n  A-->B\n```\n',
    );
    const r = run(['--format', 'text', join(tmp, 'ok.md')], tmp);
    expect(r.status).toBe(0);
    // text mode: nothing on stdout for a valid diagram
    expect(r.stdout).toBe('');
  });

  it('uses config files globs when no positional args', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'mermaid-lint-'));
    writeFileSync(
      join(tmp, '.mermaidlintrc.json'),
      JSON.stringify({ files: [`${tmp}/*.md`] }),
    );
    writeFileSync(
      join(tmp, 'chart.md'),
      '```mermaid\nflowchart LR\n  A-->B\n```\n',
    );
    // no positional args — config files glob should pick up chart.md
    const r = run([], tmp);
    expect(r.status).toBe(0);
    expect(r.stderr).toContain('checked 1 diagram');
  });

  it('config ignore excludes files from validation', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'mermaid-lint-'));
    writeFileSync(
      join(tmp, '.mermaidlintrc.json'),
      JSON.stringify({ ignore: ['**/bad.md'] }),
    );
    writeFileSync(
      join(tmp, 'bad.md'),
      '```mermaid\nflowchart LR\n  A -->|broken\n```\n',
    );
    writeFileSync(
      join(tmp, 'ok.md'),
      '```mermaid\nflowchart LR\n  A-->B\n```\n',
    );
    // bad.md is ignored, only ok.md validated → exit 0
    const r = run([join(tmp, 'bad.md'), join(tmp, 'ok.md')], tmp);
    expect(r.status).toBe(0);
  });

  it('config ignore filters explicit path args', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'mermaid-lint-'));
    writeFileSync(
      join(tmp, '.mermaidlintrc.json'),
      JSON.stringify({ ignore: ['**/bad.md'] }),
    );
    writeFileSync(
      join(tmp, 'bad.md'),
      '```mermaid\nflowchart LR\n  A -->|broken\n```\n',
    );
    // bad.md passed explicitly but ignored by config → no files to validate → exit 2
    const r = run([join(tmp, 'bad.md')], tmp);
    expect(r.status).toBe(2);
  });
});
