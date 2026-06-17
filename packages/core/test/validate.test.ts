import { describe, expect, it } from 'vitest';
import type { Block } from '../src/extract.js';
import { detectDiagramType } from '../src/type-detect.js';
import { validateBlock } from '../src/validate.js';

function makeBlock(body: string): Block {
  return {
    path: 'test.md',
    line: 1,
    col: 1,
    body,
    type: detectDiagramType(body),
  };
}

describe('validateBlock', () => {
  it('accepts a valid flowchart', async () => {
    const result = await validateBlock(makeBlock('flowchart LR\n  A --> B'));
    expect(result.ok).toBe(true);
    expect(result.warnings).toEqual([]);
  });

  it('accepts a valid sequenceDiagram', async () => {
    const result = await validateBlock(
      makeBlock('sequenceDiagram\n  Alice->>Bob: Hello'),
    );
    expect(result.ok).toBe(true);
    expect(result.warnings).toEqual([]);
  });

  it('rejects an empty block', async () => {
    const result = await validateBlock(makeBlock(''));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.message).toContain('empty');
    expect(result.warnings).toEqual([]);
  });

  it('rejects the unclosed fence sentinel', async () => {
    const result = await validateBlock(makeBlock('__UNCLOSED_FENCE__'));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.message).toContain('unclosed');
    expect(result.warnings).toEqual([]);
  });

  it('rejects invalid mermaid syntax', async () => {
    const result = await validateBlock(
      makeBlock('flowchart LR\n  A -->|broken label B'),
    );
    expect(result.ok).toBe(false);
    expect(result).toHaveProperty('error.message');
    expect(result.warnings).toEqual([]);
  });

  it('returns semantic warnings on a valid diagram with conflicting node labels', async () => {
    const result = await validateBlock(
      makeBlock('flowchart LR\n  A[Start] --> B\n  A[Begin] --> C'),
    );
    expect(result.ok).toBe(true);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0].rule).toBe('duplicate-ids');
  });
});
