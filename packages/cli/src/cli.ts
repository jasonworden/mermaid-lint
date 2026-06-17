#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import {
  discoverFiles,
  extractMermaidBlocks,
  validateBlock,
} from '@mermaid-lint/core';
import chalk from 'chalk';
import fg from 'fast-glob';

interface Args {
  quiet: boolean;
  all: boolean;
  paths: string[];
  help: boolean;
  format: 'text' | 'json';
  noSemantic: boolean;
  strict: boolean;
  error: string | null;
}

interface DiagramResult {
  line: number;
  col: number;
  type: string;
  ok: boolean;
  error?: { message: string; line?: number; col?: number };
  warnings: Array<{ rule: string; message: string; line?: number }>;
}

interface FileResult {
  path: string;
  diagrams: DiagramResult[];
}

interface JsonOutput {
  version: string;
  files: FileResult[];
  summary: {
    files: number;
    diagrams: number;
    ok: number;
    errors: number;
    warnings: number;
    types: Record<string, number>;
  };
}

function parseArgs(argv: string[]): Args {
  const args: Args = {
    quiet: false,
    all: false,
    paths: [],
    help: false,
    format: 'text',
    noSemantic: false,
    strict: false,
    error: null,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--quiet') args.quiet = true;
    else if (a === '--all') args.all = true;
    else if (a === '--help' || a === '-h') args.help = true;
    else if (a === '--format') {
      const val = argv[++i];
      if (val !== 'text' && val !== 'json') {
        args.error = `--format must be text or json${val ? `, got: ${val}` : ''}`;
        break;
      }
      args.format = val;
    } else if (a.startsWith('--format=')) {
      const val = a.slice('--format='.length);
      if (val !== 'text' && val !== 'json') {
        args.error = `--format must be text or json, got: ${val}`;
        break;
      }
      args.format = val;
    } else if (a === '--no-semantic') args.noSemantic = true;
    else if (a === '--strict') args.strict = true;
    else if (a.startsWith('--')) {
      args.error = `unknown flag: ${a}`;
      break;
    } else args.paths.push(a);
  }
  return args;
}

function expandGlobs(paths: string[]): string[] {
  return paths.flatMap((p) => {
    if (!/[*?{[]/.test(p)) return [p];
    try {
      return fg.sync(p, { dot: false, onlyFiles: true });
    } catch {
      return [p];
    }
  });
}

function printHelp(): void {
  process.stdout.write(`Usage: mermaid-lint [--all] [--quiet] [--strict] [--no-semantic] [--format text|json] [paths...]

  paths              Files or glob patterns to validate. Overrides default discovery.
  (no args)          Default: git-tracked *.md / *.mdx / *.markdown / *.mmd files.
  --all              Scan every supported file on disk; skips node_modules/.
  --quiet            Suppress per-file progress and warnings; only failures + summary.
  --strict           Exit 1 if any warnings are present (in addition to errors).
  --no-semantic      Disable semantic checks (e.g. duplicate node IDs).
  --format text      Human-readable output (default).
  --format json      Machine-readable JSON to stdout; stderr is silent.

Exit codes:
  0  all blocks valid (and no warnings, unless --no-semantic)
  1  one or more blocks failed validation (or warnings with --strict)
  2  usage error, IO error, or no files found
`);
}

async function runTextMode(
  files: string[],
  quiet: boolean,
  noSemantic: boolean,
  strict: boolean,
): Promise<number> {
  let blockCount = 0;
  let failures = 0;
  let warningCount = 0;
  const typeCounts: Record<string, number> = {};

  for (const file of files) {
    if (!quiet) process.stderr.write(chalk.dim(`scanning ${file}\n`));
    let text: string;
    try {
      text = readFileSync(file, 'utf8');
    } catch (err: unknown) {
      failures++;
      const msg = err instanceof Error ? err.message : String(err);
      process.stdout.write(
        `${chalk.bold(file)}:0:0: ${chalk.red('parse error:')} cannot read file: ${msg}\n`,
      );
      continue;
    }
    const blocks = extractMermaidBlocks(file, text);
    for (const block of blocks) {
      blockCount++;
      typeCounts[block.type] = (typeCounts[block.type] ?? 0) + 1;
      const r = await validateBlock(block);
      if (!r.ok) {
        failures++;
        const loc = r.error.line != null ? `:${r.error.line}` : '';
        const msg = r.error.message.replace(/\s*\n\s*/g, ' | ');
        process.stdout.write(
          `${chalk.bold(block.path)}:${block.line}:${block.col}${loc}: ${chalk.red('parse error:')} ${msg}\n`,
        );
      }
      if (!noSemantic) {
        for (const w of r.warnings) {
          warningCount++;
          if (!quiet) {
            // For .mmd files the body starts at line 1 (no fence opener).
            // For markdown fences block.line is the opener, body starts at block.line + 1.
            const bodyOffset = block.path.endsWith('.mmd')
              ? block.line - 1
              : block.line;
            const absLine = bodyOffset + (w.line ?? 1);
            process.stdout.write(
              `${chalk.bold(block.path)}:${absLine}:${block.col}: ${chalk.yellow('warning:')} ${w.rule}: ${w.message}\n`,
            );
          }
        }
      }
    }
  }

  const resultStr =
    failures === 0
      ? chalk.green('all valid')
      : chalk.red(`${failures} failure${failures !== 1 ? 's' : ''}`);
  const warnStr =
    !quiet && warningCount > 0
      ? `, ${chalk.yellow(`${warningCount} warning${warningCount !== 1 ? 's' : ''}`)}`
      : '';
  process.stderr.write(
    `checked ${blockCount} diagram${blockCount !== 1 ? 's' : ''} in ${files.length} file${files.length !== 1 ? 's' : ''} — ${resultStr}${warnStr}\n`,
  );
  printTypeDistribution(typeCounts);
  return failures > 0 || (strict && warningCount > 0) ? 1 : 0;
}

async function runJsonMode(
  files: string[],
  noSemantic: boolean,
  strict: boolean,
): Promise<number> {
  let failures = 0;
  let totalWarnings = 0;
  const fileResults: FileResult[] = [];

  for (const file of files) {
    let text: string;
    try {
      text = readFileSync(file, 'utf8');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      fileResults.push({
        path: file,
        diagrams: [
          {
            line: 0,
            col: 0,
            type: 'unknown',
            ok: false,
            error: { message: `cannot read file: ${msg}` },
            warnings: [],
          },
        ],
      });
      failures++;
      continue;
    }
    const diagrams: DiagramResult[] = [];
    const blocks = extractMermaidBlocks(file, text);
    for (const block of blocks) {
      const r = await validateBlock(block);
      const blockWarnings = noSemantic ? [] : r.warnings;
      totalWarnings += blockWarnings.length;
      const dr: DiagramResult = {
        line: block.line,
        col: block.col,
        type: block.type,
        ok: r.ok,
        warnings: blockWarnings,
      };
      if (!r.ok) {
        failures++;
        dr.error = { message: r.error.message };
        if (r.error.line != null) dr.error.line = r.error.line;
        if (r.error.col != null) dr.error.col = r.error.col;
      }
      diagrams.push(dr);
    }
    fileResults.push({ path: file, diagrams });
  }

  const allDiagrams = fileResults.flatMap((f) => f.diagrams);
  const typeCounts: Record<string, number> = {};
  for (const d of allDiagrams) {
    typeCounts[d.type] = (typeCounts[d.type] ?? 0) + 1;
  }

  const output: JsonOutput = {
    version: '0.3.0',
    files: fileResults,
    summary: {
      files: files.length,
      diagrams: allDiagrams.length,
      ok: allDiagrams.filter((d) => d.ok).length,
      errors: failures,
      warnings: totalWarnings,
      types: typeCounts,
    },
  };
  process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
  return failures > 0 || (strict && totalWarnings > 0) ? 1 : 0;
}

function printTypeDistribution(types: Record<string, number>): void {
  const entries = Object.entries(types).sort((a, b) => b[1] - a[1]);
  if (entries.length < 2) return;
  const maxKeyLen = Math.max(...entries.map(([k]) => k.length));
  for (const [key, count] of entries) {
    process.stderr.write(`  ${key.padEnd(maxKeyLen)}  ${count}\n`);
  }
}

async function main(argv: string[]): Promise<number> {
  const args = parseArgs(argv);
  if (args.help) {
    printHelp();
    return 0;
  }
  if (args.error) {
    process.stderr.write(`${args.error}\n`);
    printHelp();
    return 2;
  }

  const expandedPaths = expandGlobs(args.paths);
  const files = discoverFiles({
    all: args.all,
    paths: expandedPaths.length ? expandedPaths : undefined,
  });

  if (files.length === 0) {
    process.stderr.write(
      args.paths.length > 0
        ? 'no files matched the given paths\n'
        : args.all
          ? 'no supported files found on disk\n'
          : 'no tracked files found (is this a git checkout? try --all)\n',
    );
    return 2;
  }

  return args.format === 'json'
    ? runJsonMode(files, args.noSemantic, args.strict)
    : runTextMode(files, args.quiet, args.noSemantic, args.strict);
}

const code = await main(process.argv.slice(2));
process.exit(code);
