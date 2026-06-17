#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
/**
 * Benchmark mermaid-lint semantic checking vs mermaid-check.
 * Usage: node scripts/bench-semantic.mjs
 */
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const SIZES = [10, 50, 200];

function makeDiagram(i) {
  const hasConflict = i % 3 === 0;
  const secondLabel = hasConflict ? `Label${i}B` : `Label${i}A`;
  return [
    '```mermaid',
    'flowchart LR',
    `  A${i}[Label${i}A] --> B${i}[Step${i}]`,
    `  B${i}[Step${i}] --> C${i}[End${i}]`,
    hasConflict
      ? `  A${i}[${secondLabel}] --> C${i}`
      : `  C${i} --> D${i}[Done${i}]`,
    '```',
  ].join('\n');
}

function makeFile(count) {
  return Array.from({ length: count }, (_, i) => makeDiagram(i)).join('\n\n');
}

function timeRun(cmd, args, cwd) {
  const start = performance.now();
  const r = spawnSync(cmd, args, { cwd, encoding: 'utf8' });
  const elapsed = performance.now() - start;
  return { elapsed, status: r.status };
}

function which(bin) {
  const r = spawnSync('which', [bin], { encoding: 'utf8' });
  return r.status === 0 ? r.stdout.trim() : null;
}

const mermaidLintBin = new URL('../packages/cli/dist/cli.js', import.meta.url)
  .pathname;

if (!existsSync(mermaidLintBin)) {
  console.error(
    `Error: dist/cli.js not found. Run "pnpm build" first.\n  Expected: ${mermaidLintBin}`,
  );
  process.exit(1);
}

const mermaidCheckBin = which('mermaid-check');

console.log('\nmermaid-lint semantic benchmark\n');
console.log(
  `${'Diagrams'.padEnd(10)} ${'mermaid-lint ms'.padEnd(18)} ${'ms/diagram'.padEnd(12)} ${'mermaid-check ms'.padEnd(18)} ${'ms/diagram'.padEnd(12)}`,
);
console.log('-'.repeat(74));

for (const size of SIZES) {
  const tmp = mkdtempSync(join(tmpdir(), 'mermaid-bench-'));
  try {
    writeFileSync(join(tmp, 'bench.md'), makeFile(size));

    const lint = timeRun(
      process.execPath,
      [mermaidLintBin, '--format', 'json', join(tmp, 'bench.md')],
      tmp,
    );
    const lintPer = (lint.elapsed / size).toFixed(1);

    let checkMs = 'n/a';
    let checkPer = 'n/a';
    if (mermaidCheckBin) {
      const check = timeRun(mermaidCheckBin, [join(tmp, 'bench.md')], tmp);
      checkMs = check.elapsed.toFixed(0);
      checkPer = (check.elapsed / size).toFixed(1);
    } else {
      checkMs = 'not installed';
      checkPer = '—';
    }

    console.log(
      `${String(size).padEnd(10)} ${lint.elapsed.toFixed(0).padEnd(18)} ${lintPer.padEnd(12)} ${String(checkMs).padEnd(18)} ${String(checkPer).padEnd(12)}`,
    );
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

console.log();
