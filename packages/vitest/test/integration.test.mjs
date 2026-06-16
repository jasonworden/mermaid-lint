import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defineMermaidTests } from '../index.mjs';

const tmp = mkdtempSync(join(tmpdir(), 'mermaid-lint-vitest-'));
const file = join(tmp, 'valid.md');
writeFileSync(file, '# Test\n\n```mermaid\nflowchart LR\n  A --> B\n```\n');

// Module-level call — registers describe/it.each that Vitest picks up.
defineMermaidTests({ paths: [file] });
