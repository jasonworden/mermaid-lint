#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import {
  discoverFiles,
  extractMermaidBlocks,
  validateBlock,
} from '@mermaid-lint/core';

interface Args {
  quiet: boolean;
  all: boolean;
  paths: string[];
  help: boolean;
  error: string | null;
}

function parseArgs(argv: string[]): Args {
  const args: Args = {
    quiet: false,
    all: false,
    paths: [],
    help: false,
    error: null,
  };
  for (const a of argv) {
    if (a === '--quiet') args.quiet = true;
    else if (a === '--all') args.all = true;
    else if (a === '--help' || a === '-h') args.help = true;
    else if (a.startsWith('--')) {
      args.error = `unknown flag: ${a}`;
      break;
    } else args.paths.push(a);
  }
  return args;
}

function printHelp(): void {
  process.stdout.write(`Usage: mermaid-lint [--all] [--quiet] [paths...]

  paths      Files to validate. Overrides default discovery.
  (no args)  Default: git-tracked *.md files.
  --all      Scan every *.md on disk; skips node_modules/.
  --quiet    Suppress per-file progress; only failures + summary.

Exit codes:
  0  all blocks valid
  1  one or more blocks failed validation
  2  usage error, IO error, or no markdown files found
`);
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

  const files = discoverFiles({
    all: args.all,
    paths: args.paths.length ? args.paths : undefined,
  });

  if (files.length === 0) {
    process.stderr.write(
      args.paths.length > 0
        ? 'no markdown files matched the given paths\n'
        : args.all
          ? 'no markdown files found on disk\n'
          : 'no tracked markdown files found (is this a git checkout? try --all)\n',
    );
    return 2;
  }

  let blockCount = 0;
  let failures = 0;

  for (const file of files) {
    if (!args.quiet) process.stderr.write(`scanning ${file}\n`);
    let text: string;
    try {
      text = readFileSync(file, 'utf8');
    } catch (err: unknown) {
      failures++;
      const msg = err instanceof Error ? err.message : String(err);
      process.stdout.write(
        `${file}:0:0: parse error: cannot read file: ${msg}\n`,
      );
      continue;
    }
    const blocks = extractMermaidBlocks(file, text);
    for (const block of blocks) {
      blockCount++;
      const r = await validateBlock(block.body);
      if (!r.ok) {
        failures++;
        const loc = r.error.line != null ? `:${r.error.line}` : '';
        const msg = r.error.message.replace(/\s*\n\s*/g, ' | ');
        process.stdout.write(
          `${block.path}:${block.line}:${block.col}${loc}: parse error: ${msg}\n`,
        );
      }
    }
  }

  process.stderr.write(
    `checked ${blockCount} diagram${blockCount !== 1 ? 's' : ''} in ${files.length} file${files.length !== 1 ? 's' : ''} — ${failures === 0 ? 'all valid' : `${failures} failure${failures !== 1 ? 's' : ''}`}\n`,
  );
  return failures > 0 ? 1 : 0;
}

const code = await main(process.argv.slice(2));
process.exit(code);
