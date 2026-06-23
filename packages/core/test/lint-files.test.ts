import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  collectMermaidBlocks,
  lintMermaidFiles,
  selectFailures,
} from '../src/lint-files.js';
import type { Diagnostic } from '../src/markdown-adapter.js';

function writeMd(content: string): string {
  const tmp = mkdtempSync(join(tmpdir(), 'mermaid-lint-'));
  const file = join(tmp, 'doc.md');
  writeFileSync(file, content);
  return file;
}

const block = (body: string) => `\`\`\`mermaid\n${body}\n\`\`\`\n`;
const VALID = block('flowchart LR\n  A --> B');
const PARSE_ERROR = block('flowchart LR\n  A -->|broken label B');
const SELF_LOOP = block('flowchart LR\n  A --> A');
const DUP_IDS = block('flowchart LR\n  A[One] --> B\n  A[Two] --> C');
const ORPHAN = block('flowchart LR\n  A --> B\n  C[Hi]');

/** Diagnostics for the single block in `content`. */
async function diagnose(
  content: string,
  rules?: Parameters<typeof lintMermaidFiles>[0]['rules'],
): Promise<Diagnostic[]> {
  const results = await lintMermaidFiles({ paths: [writeMd(content)], rules });
  expect(results).toHaveLength(1);
  return results[0].diagnostics;
}

describe('collectMermaidBlocks', () => {
  it('extracts every block across the discovered files', () => {
    const file = writeMd(`${VALID}\nsome text\n${SELF_LOOP}`);
    expect(collectMermaidBlocks({ paths: [file] })).toHaveLength(2);
  });

  it('returns nothing when there are no mermaid blocks', () => {
    const file = writeMd('# Heading\n\n```js\nconsole.log(1)\n```\n');
    expect(collectMermaidBlocks({ paths: [file] })).toHaveLength(0);
  });
});

describe('lintMermaidFiles', () => {
  it('returns no diagnostics for a valid block', async () => {
    expect(await diagnose(VALID)).toHaveLength(0);
  });

  it('reports a syntax error as an error diagnostic', async () => {
    const ds = await diagnose(PARSE_ERROR);
    expect(ds.some((d) => d.severity === 'error')).toBe(true);
  });

  it('reports duplicate ids (error-default) by default', async () => {
    const ds = await diagnose(DUP_IDS);
    expect(
      ds.some((d) => d.ruleId === 'duplicate-ids' && d.severity === 'error'),
    ).toBe(true);
  });

  it('reports a self-loop as a warning diagnostic', async () => {
    const ds = await diagnose(SELF_LOOP);
    expect(
      ds.some((d) => d.ruleId === 'no-self-loop' && d.severity === 'warning'),
    ).toBe(true);
  });

  it('does not fire an off-by-default rule (orphan nodes) without an override', async () => {
    const ds = await diagnose(ORPHAN);
    expect(ds.some((d) => d.ruleId === 'no-orphan-nodes')).toBe(false);
  });

  it('fires an off-by-default rule when enabled via rules', async () => {
    const ds = await diagnose(ORPHAN, { 'no-orphan-nodes': 'error' });
    expect(ds.some((d) => d.ruleId === 'no-orphan-nodes')).toBe(true);
  });

  it('produces one result per block, in document order', async () => {
    const file = writeMd(`${VALID}\n\n${PARSE_ERROR}`);
    const results = await lintMermaidFiles({ paths: [file] });
    expect(results).toHaveLength(2);
    expect(results[0].diagnostics).toHaveLength(0);
    expect(results[1].diagnostics.length).toBeGreaterThan(0);
  });
});

describe('selectFailures', () => {
  const errorDiag: Diagnostic = {
    line: 1,
    column: 1,
    message: 'boom',
    ruleId: 'mermaid',
    severity: 'error',
  };
  const warnDiag: Diagnostic = {
    line: 1,
    column: 1,
    message: 'meh',
    ruleId: 'no-self-loop',
    severity: 'warning',
  };

  it('always counts error-severity diagnostics', () => {
    expect(selectFailures([errorDiag], false)).toHaveLength(1);
    expect(selectFailures([errorDiag], true)).toHaveLength(1);
  });

  it('counts warning-severity diagnostics only under strict', () => {
    expect(selectFailures([warnDiag], false)).toHaveLength(0);
    expect(selectFailures([warnDiag], true)).toHaveLength(1);
  });

  it('defaults strict to false', () => {
    expect(selectFailures([warnDiag])).toHaveLength(0);
  });
});
