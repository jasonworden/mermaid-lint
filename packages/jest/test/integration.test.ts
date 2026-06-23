import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defineMermaidTests } from '../index.js';

// A valid diagram plus a self-loop. The self-loop is a warn-severity semantic
// finding, so it must NOT fail by default (only under `strict`) — this suite
// staying green proves semantics are wired through without over-firing. The
// failure behavior (errors always fail; warnings fail under strict) is covered
// by core's lint-files.test.ts.
const tmp = mkdtempSync(join(tmpdir(), 'mermaid-lint-jest-'));
const file = join(tmp, 'doc.md');
writeFileSync(
  file,
  '# Test\n\n```mermaid\nflowchart LR\n  A --> B\n```\n\n```mermaid\nflowchart LR\n  S --> S\n```\n',
);

defineMermaidTests({ paths: [file] });
