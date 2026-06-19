import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const BIN = resolve(import.meta.dirname, '../dist/cli.js');

function run(args: string[], cwd: string) {
  return spawnSync(process.execPath, [BIN, ...args], { cwd, encoding: 'utf8' });
}

function runWithStdin(args: string[], cwd: string, stdinContent: string) {
  return spawnSync(process.execPath, [BIN, ...args], {
    cwd,
    encoding: 'utf8',
    input: stdinContent,
  });
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
    expect(json.version).toBe('0.7.0');
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
    expect(json.version).toBe('0.7.0');
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

  it('CLI --no-semantic suppresses warnings so config strict:true does not trigger exit 1', () => {
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

  it('exits 2 with clear message when config files glob matches nothing', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'mermaid-lint-'));
    writeFileSync(
      join(tmp, '.mermaidlintrc.json'),
      JSON.stringify({ files: ['nonexistent/**/*.md'] }),
    );
    const r = run([], tmp);
    expect(r.status).toBe(2);
    expect(r.stderr).toContain('config file');
  });

  it('exits 2 with error when config format is invalid', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'mermaid-lint-'));
    writeFileSync(
      join(tmp, '.mermaidlintrc.json'),
      JSON.stringify({ format: 'xml' }),
    );
    writeFileSync(
      join(tmp, 'ok.md'),
      '```mermaid\nflowchart LR\n  A-->B\n```\n',
    );
    const r = run([join(tmp, 'ok.md')], tmp);
    expect(r.status).toBe(2);
    expect(r.stderr).toContain('config error');
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

  it('--no-gitignore finds files in a non-git directory', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'mermaid-lint-'));
    writeFileSync(
      join(tmp, 'valid.md'),
      '```mermaid\nflowchart LR\n  A-->B\n```\n',
    );
    // Without --no-gitignore and no git repo: no tracked files → exit 2
    const withoutFlag = run([], tmp);
    expect(withoutFlag.status).toBe(2);
    expect(withoutFlag.stderr).toContain('no tracked files found');
    // With --no-gitignore: filesystem scan finds valid.md → exit 0
    const withFlag = run(['--no-gitignore'], tmp);
    expect(withFlag.status).toBe(0);
    expect(withFlag.stderr).toContain('checked 1 diagram');
  });

  it('--no-gitignore with --all still works (no conflict)', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'mermaid-lint-'));
    writeFileSync(
      join(tmp, 'valid.md'),
      '```mermaid\nflowchart LR\n  A-->B\n```\n',
    );
    const r = run(['--all', '--no-gitignore'], tmp);
    expect(r.status).toBe(0);
  });

  it('reads a valid diagram from stdin with -', () => {
    const r = runWithStdin(
      ['-'],
      '.',
      '```mermaid\nflowchart LR\n  A-->B\n```\n',
    );
    expect(r.status).toBe(0);
    expect(r.stderr).toContain('checked 1 diagram');
  });

  it('reads an invalid diagram from stdin with -', () => {
    const r = runWithStdin(
      ['-'],
      '.',
      '```mermaid\nflowchart LR\n  A -->|broken\n```\n',
    );
    expect(r.status).toBe(1);
    expect(r.stdout).toContain('parse error');
    expect(r.stdout).toContain('<stdin>');
  });

  it('stdin with --format json outputs <stdin> as file path', () => {
    const r = runWithStdin(
      ['-', '--format', 'json'],
      '.',
      '```mermaid\nflowchart LR\n  A-->B\n```\n',
    );
    expect(r.status).toBe(0);
    const json = JSON.parse(r.stdout);
    expect(json.files[0].path).toBe('<stdin>');
    expect(json.files[0].diagrams[0].ok).toBe(true);
  });

  it('stdin can be combined with file paths', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'mermaid-lint-'));
    writeFileSync(
      join(tmp, 'extra.md'),
      '```mermaid\nflowchart LR\n  C-->D\n```\n',
    );
    const r = runWithStdin(
      ['-', join(tmp, 'extra.md')],
      tmp,
      '```mermaid\nflowchart LR\n  A-->B\n```\n',
    );
    expect(r.status).toBe(0);
    expect(r.stderr).toContain('checked 2 diagrams');
  });

  it('--include picks up a glob pattern', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'mermaid-lint-'));
    writeFileSync(
      join(tmp, 'a.md'),
      '```mermaid\nflowchart LR\n  A-->B\n```\n',
    );
    writeFileSync(
      join(tmp, 'b.md'),
      '```mermaid\nflowchart LR\n  C-->D\n```\n',
    );
    const r = run(['--include', join(tmp, '*.md')], tmp);
    expect(r.status).toBe(0);
    expect(r.stderr).toContain('checked 2 diagrams');
  });

  it('--include can be repeated', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'mermaid-lint-'));
    writeFileSync(
      join(tmp, 'a.md'),
      '```mermaid\nflowchart LR\n  A-->B\n```\n',
    );
    writeFileSync(join(tmp, 'b.mmd'), 'flowchart LR\n  C-->D\n');
    const r = run(
      ['--include', join(tmp, '*.md'), '--include', join(tmp, '*.mmd')],
      tmp,
    );
    expect(r.status).toBe(0);
    expect(r.stderr).toContain('checked 2 diagrams');
  });

  it('--exclude filters files from validation', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'mermaid-lint-'));
    writeFileSync(
      join(tmp, 'good.md'),
      '```mermaid\nflowchart LR\n  A-->B\n```\n',
    );
    writeFileSync(
      join(tmp, 'bad.md'),
      '```mermaid\nflowchart LR\n  A -->|broken\n```\n',
    );
    // Pass both files explicitly; exclude bad.md → should exit 0
    const r = run(
      [join(tmp, 'good.md'), join(tmp, 'bad.md'), '--exclude', '**/bad.md'],
      tmp,
    );
    expect(r.status).toBe(0);
    expect(r.stderr).toContain('checked 1 diagram');
  });

  it('--exclude stacks with config ignore', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'mermaid-lint-'));
    writeFileSync(
      join(tmp, '.mermaidlintrc.json'),
      JSON.stringify({ ignore: ['**/config-ignored.md'] }),
    );
    writeFileSync(
      join(tmp, 'config-ignored.md'),
      '```mermaid\nflowchart LR\n  A -->|broken\n```\n',
    );
    writeFileSync(
      join(tmp, 'flag-excluded.md'),
      '```mermaid\nflowchart LR\n  A -->|broken\n```\n',
    );
    writeFileSync(
      join(tmp, 'ok.md'),
      '```mermaid\nflowchart LR\n  A-->B\n```\n',
    );
    // Pass all three; config ignores config-ignored.md, --exclude ignores flag-excluded.md
    const r = run(
      [
        join(tmp, 'config-ignored.md'),
        join(tmp, 'flag-excluded.md'),
        join(tmp, 'ok.md'),
        '--exclude',
        '**/flag-excluded.md',
      ],
      tmp,
    );
    expect(r.status).toBe(0);
    expect(r.stderr).toContain('checked 1 diagram');
  });

  it('--include merges with positional paths', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'mermaid-lint-'));
    writeFileSync(
      join(tmp, 'a.md'),
      '```mermaid\nflowchart LR\n  A-->B\n```\n',
    );
    writeFileSync(
      join(tmp, 'b.md'),
      '```mermaid\nflowchart LR\n  C-->D\n```\n',
    );
    // One file positionally, one via --include
    const r = run([join(tmp, 'a.md'), '--include', join(tmp, 'b.md')], tmp);
    expect(r.status).toBe(0);
    expect(r.stderr).toContain('checked 2 diagrams');
  });

  it('exits 2 when --include requires an argument', () => {
    const r = run(['--include'], '.');
    expect(r.status).toBe(2);
  });

  it('exits 2 when --exclude requires an argument', () => {
    const r = run(['--exclude'], '.');
    expect(r.status).toBe(2);
  });

  describe('--fix', () => {
    it('fixes an arrow normalization error in place', () => {
      const dir = mkdtempSync(join(tmpdir(), 'mermaid-lint-'));
      const file = join(dir, 'test.md');
      writeFileSync(file, '```mermaid\nflowchart LR\n  A -> B\n```\n');
      const r = run(['--fix', file], dir);
      expect(r.status).toBe(0);
      expect(readFileSync(file, 'utf8')).toBe(
        '```mermaid\nflowchart LR\n  A --> B\n```\n',
      );
    });

    it('exits 0 when file was already valid (nothing to fix)', () => {
      const dir = mkdtempSync(join(tmpdir(), 'mermaid-lint-'));
      const file = join(dir, 'test.md');
      writeFileSync(file, '```mermaid\nflowchart LR\n  A --> B\n```\n');
      const r = run(['--fix', file], dir);
      expect(r.status).toBe(0);
    });

    it('exits 1 when file still has errors after fix', () => {
      const dir = mkdtempSync(join(tmpdir(), 'mermaid-lint-'));
      const file = join(dir, 'test.md');
      writeFileSync(
        file,
        '```mermaid\nflowchart LR\n  A -->|broken label B\n```\n',
      );
      const r = run(['--fix', file], dir);
      expect(r.status).toBe(1);
    });

    it('fixes unclosed fence in place', () => {
      const dir = mkdtempSync(join(tmpdir(), 'mermaid-lint-'));
      const file = join(dir, 'test.md');
      writeFileSync(file, 'text\n```mermaid\nflowchart LR\n  A --> B\n');
      const r = run(['--fix', file], dir);
      expect(r.status).toBe(0);
      expect(readFileSync(file, 'utf8')).toContain('```');
    });

    it('reports fixed: <path> on stderr', () => {
      const dir = mkdtempSync(join(tmpdir(), 'mermaid-lint-'));
      const file = join(dir, 'test.md');
      writeFileSync(file, '```mermaid\nflowchart LR\n  A -> B\n```\n');
      const r = run(['--fix', file], dir);
      expect(r.stderr).toContain('fixed:');
    });

    it('writes fixed content to stdout for stdin (-) with --fix', () => {
      const dir = mkdtempSync(join(tmpdir(), 'mermaid-lint-'));
      const r = runWithStdin(
        ['--fix', '-'],
        dir,
        '```mermaid\nflowchart LR\n  A -> B\n```\n',
      );
      expect(r.status).toBe(0);
      expect(r.stdout).toContain('A --> B');
    });
  });
});
