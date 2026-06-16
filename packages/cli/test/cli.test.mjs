import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

// import.meta.dirname = packages/cli/test — go up one level to packages/cli/bin/
const BIN = resolve(import.meta.dirname, '../bin/mermaid-lint.mjs');

function run(args, cwd) {
  return spawnSync('node', [BIN, ...args], { cwd, encoding: 'utf8' });
}

describe('mermaid-lint CLI', () => {
  it('exits 0 for a file with a valid diagram', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'mermaid-lint-'));
    writeFileSync(join(tmp, 'valid.md'), '```mermaid\nflowchart LR\n  A --> B\n```\n');
    const r = run([join(tmp, 'valid.md')], tmp);
    expect(r.status).toBe(0);
  });

  it('exits 1 for a file with an invalid diagram', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'mermaid-lint-'));
    writeFileSync(join(tmp, 'bad.md'), '```mermaid\nflowchart LR\n  A -->|broken\n```\n');
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
    writeFileSync(join(tmp, 'ok.md'), '```mermaid\nflowchart LR\n  A-->B\n```\n');
    const noisy = run([join(tmp, 'ok.md')], tmp);
    const quiet = run(['--quiet', join(tmp, 'ok.md')], tmp);
    expect(quiet.stderr.length).toBeLessThan(noisy.stderr.length);
  });
});
