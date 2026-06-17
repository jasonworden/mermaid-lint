#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const SIZES = [10, 50, 200, 1000, 10000, 100000];

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

const mermaidLintBin = new URL('../packages/cli/dist/cli.js', import.meta.url)
  .pathname;

if (!existsSync(mermaidLintBin)) {
  console.error(
    `Error: dist/cli.js not found. Run "pnpm build" first.\n  Expected: ${mermaidLintBin}`,
  );
  process.exit(1);
}

console.log('\nmermaid-lint semantic benchmark\n');
console.log(
  `${'Diagrams'.padEnd(10)} ${'ms'.padEnd(12)} ${'ms/diagram'.padEnd(12)}`,
);
console.log('-'.repeat(36));

for (const size of SIZES) {
  const tmp = mkdtempSync(join(tmpdir(), 'mermaid-bench-'));
  try {
    writeFileSync(join(tmp, 'bench.md'), makeFile(size));

    const lint = timeRun(
      process.execPath,
      [mermaidLintBin, '--format', 'json', join(tmp, 'bench.md')],
      tmp,
    );
    const lintPer = (lint.elapsed / size).toFixed(2);

    console.log(
      `${String(size).padEnd(10)} ${lint.elapsed.toFixed(0).padEnd(12)} ${lintPer.padEnd(12)}`,
    );
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

console.log();
