import { describe, expect, it } from 'vitest';
import { extractMermaidBlocks } from '../src/extract.js';

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
    const md =
      '```mermaid\nflowchart LR\n  A-->B\n```\n\n```mermaid\nsequenceDiagram\n  A->>B: hi\n```\n';
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

  it('populates type field on each block', () => {
    const md = '```mermaid\nflowchart LR\n  A-->B\n```\n';
    const blocks = extractMermaidBlocks('test.md', md);
    expect(blocks[0].type).toBe('flowchart');
  });

  it('sets type to unknown for unclosed fence', () => {
    const md = '```mermaid\nflowchart LR\n  A-->B\n';
    const blocks = extractMermaidBlocks('test.md', md);
    expect(blocks[0].type).toBe('unknown');
  });

  it('extracts indented fence (inside list item)', () => {
    const md = '- item\n  ```mermaid\n  flowchart LR\n    A-->B\n  ```\n';
    const blocks = extractMermaidBlocks('test.md', md);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].line).toBe(2);
    expect(blocks[0].col).toBe(3);
    expect(blocks[0].body).toBe('  flowchart LR\n    A-->B');
    expect(blocks[0].type).toBe('flowchart');
  });

  it('does not close indented fence on differently-indented backticks', () => {
    // Opening fence has 2-space indent; the only ``` in the file has 0-space indent — never closes
    const md = '  ```mermaid\n  flowchart LR\n    A-->B\n```\n';
    const blocks = extractMermaidBlocks('test.md', md);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].body).toBe('__UNCLOSED_FENCE__');
  });

  it('treats .mmd file as a single block at line 1', () => {
    const blocks = extractMermaidBlocks(
      'diagram.mmd',
      'flowchart LR\n  A-->B\n',
    );
    expect(blocks).toHaveLength(1);
    expect(blocks[0].line).toBe(1);
    expect(blocks[0].col).toBe(1);
    expect(blocks[0].body).toBe('flowchart LR\n  A-->B');
    expect(blocks[0].type).toBe('flowchart');
  });

  it('treats empty .mmd file as a block with empty body', () => {
    const blocks = extractMermaidBlocks('empty.mmd', '');
    expect(blocks).toHaveLength(1);
    expect(blocks[0].body).toBe('');
  });

  it('extracts a tilde fence', () => {
    const md = '~~~mermaid\nflowchart LR\n  A-->B\n~~~\n';
    const blocks = extractMermaidBlocks('test.md', md);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].body).toBe('flowchart LR\n  A-->B');
    expect(blocks[0].type).toBe('flowchart');
  });

  it('extracts a fence with more than three backticks', () => {
    const md = '````mermaid\nflowchart LR\n  A-->B\n````\n';
    const blocks = extractMermaidBlocks('test.md', md);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].body).toBe('flowchart LR\n  A-->B');
  });

  it('lets a four-backtick fence wrap a body containing triple backticks', () => {
    const md = '````mermaid\nflowchart LR\n  A-->B\n```\n````\n';
    const blocks = extractMermaidBlocks('test.md', md);
    expect(blocks).toHaveLength(1);
    // The inner ``` is part of the body, not a closing fence (too short).
    expect(blocks[0].body).toBe('flowchart LR\n  A-->B\n```');
  });

  it('closes a fence with a longer run of the same char', () => {
    const md = '```mermaid\nflowchart LR\n  A-->B\n`````\n';
    const blocks = extractMermaidBlocks('test.md', md);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].body).toBe('flowchart LR\n  A-->B');
  });

  it('does not close a backtick fence with tildes', () => {
    const md = '```mermaid\nflowchart LR\n  A-->B\n~~~\n';
    const blocks = extractMermaidBlocks('test.md', md);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].body).toBe('__UNCLOSED_FENCE__');
  });

  it('ignores tilde fences when fences is restricted to backtick', () => {
    const md = '~~~mermaid\nflowchart LR\n  A-->B\n~~~\n';
    const blocks = extractMermaidBlocks('test.md', md, {
      fences: ['backtick'],
    });
    expect(blocks).toHaveLength(0);
  });

  it('ignores backtick fences when fences is restricted to tilde', () => {
    const md = '```mermaid\nflowchart LR\n  A-->B\n```\n';
    const blocks = extractMermaidBlocks('test.md', md, { fences: ['tilde'] });
    expect(blocks).toHaveLength(0);
  });

  it('extracts nothing from markdown when fences is empty', () => {
    const md = '```mermaid\nflowchart LR\n```\n~~~mermaid\ngraph TD\n~~~\n';
    const blocks = extractMermaidBlocks('test.md', md, { fences: [] });
    expect(blocks).toHaveLength(0);
  });
});
