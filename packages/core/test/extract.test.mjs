import { describe, it, expect } from 'vitest';
import { extractMermaidBlocks } from '../src/extract.mjs';

describe('extractMermaidBlocks', () => {
  it('extracts a single block', () => {
    const md = '# Doc\n\n```mermaid\nflowchart LR\n  A --> B\n```\n';
    const blocks = extractMermaidBlocks('test.md', md);
    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toMatchObject({
      path: 'test.md',
      line: 3,
      col: 1,
      body: 'flowchart LR\n  A --> B',
    });
  });

  it('returns empty array when no mermaid blocks', () => {
    const blocks = extractMermaidBlocks('test.md', '# No mermaid here\n');
    expect(blocks).toHaveLength(0);
  });

  it('marks unclosed fence with sentinel body', () => {
    const md = '```mermaid\nflowchart LR\n  A --> B\n';
    const blocks = extractMermaidBlocks('test.md', md);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].body).toBe('__UNCLOSED_FENCE__');
  });

  it('extracts multiple blocks in order', () => {
    const md = '```mermaid\nflowchart LR\n  A-->B\n```\n\n```mermaid\nsequenceDiagram\n  A->>B: hi\n```\n';
    const blocks = extractMermaidBlocks('test.md', md);
    expect(blocks).toHaveLength(2);
    expect(blocks[0].body).toContain('flowchart');
    expect(blocks[1].body).toContain('sequenceDiagram');
  });

  it('normalises CRLF line endings in body', () => {
    const md = '```mermaid\r\nflowchart LR\r\n  A-->B\r\n```\r\n';
    const blocks = extractMermaidBlocks('test.md', md);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].body).toBe('flowchart LR\n  A-->B');
  });

  it('accepts info-string after opening fence', () => {
    const md = '```mermaid {hl_lines="1"}\nflowchart LR\n  A-->B\n```\n';
    const blocks = extractMermaidBlocks('test.md', md);
    expect(blocks).toHaveLength(1);
  });
});
