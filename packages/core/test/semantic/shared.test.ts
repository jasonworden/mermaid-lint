import { describe, expect, it } from 'vitest';
import { extractMermaidBlocks } from '../../src/extract.js';
import { block } from './helpers.js';
import { only } from './helpers.js';

describe('header-line anchoring', () => {
  it('anchors prefer-flowchart to the header, not body line 1', () => {
    const b = block('%% a note\ngraph LR\n  A --> B', 'graph');
    expect(only(b, 'prefer-flowchart')[0]?.line).toBe(2);
  });

  it('anchors require-direction to the header after a comment', () => {
    const b = block('%% a note\nflowchart\n  A --> B', 'flowchart');
    expect(only(b, 'require-direction')[0]?.line).toBe(2);
  });

  it('anchors absence rules to the header line', () => {
    const b = block('%% a note\npie', 'pie');
    expect(only(b, 'pie-no-data')[0]?.line).toBe(2);
  });

  it('skips leading blank lines when locating the header', () => {
    const b = block('\n\ngraph LR\n  A --> B', 'graph');
    expect(only(b, 'prefer-flowchart')[0]?.line).toBe(3);
  });

  it('still reports line 1 when the header is on line 1', () => {
    const b = block('graph LR\n  A --> B', 'graph');
    expect(only(b, 'prefer-flowchart')[0]?.line).toBe(1);
  });

  it('anchors the header past YAML frontmatter', () => {
    // Goes through the real extractor (not `block()`, which hardcodes
    // `type` and bypasses `detectDiagramType` entirely) so this fails
    // loudly if frontmatter-skipping type detection regresses.
    const md = [
      '```mermaid',
      '---',
      'title: T',
      '---',
      'graph LR',
      '  A --> B',
      '```',
    ].join('\n');
    const [b] = extractMermaidBlocks('test.md', md);
    expect(b.type).toBe('graph');
    expect(only(b, 'prefer-flowchart')[0]?.line).toBe(4);
  });

  it('reports duplicate-ids in a frontmatter diagram end to end', () => {
    // Regression for https://github.com/jasonworden/mermaid-lint/issues/122 —
    // the type came back as '---', so every rule's `appliesTo` rejected the
    // block and this finding was silently dropped. Goes through the real
    // extractor rather than `block()` because the bug was in type detection.
    const md = [
      '```mermaid',
      '---',
      'title: T',
      '---',
      'flowchart LR',
      '  A[Start] --> B',
      '  A[Begin] --> C',
      '```',
    ].join('\n');
    const [b] = extractMermaidBlocks('test.md', md);
    expect(b.type).toBe('flowchart');
    expect(only(b, 'duplicate-ids')).toHaveLength(1);
  });

  it('reports duplicate-ids identically with and without frontmatter', () => {
    // Both blocks come from the real extractor (not `block()`, which
    // hardcodes `type` and bypasses `detectDiagramType`), so this fails
    // loudly if type detection regresses for either variant.
    const body = 'flowchart LR\n  A[Start] --> B\n  A[Begin] --> C';
    const plainMd = ['```mermaid', body, '```'].join('\n');
    const withFmMd = ['```mermaid', '---', 'title: T', '---', body, '```'].join(
      '\n',
    );
    const [plainBlock] = extractMermaidBlocks('test.md', plainMd);
    const [withFmBlock] = extractMermaidBlocks('test.md', withFmMd);
    expect(plainBlock.type).toBe('flowchart');
    expect(withFmBlock.type).toBe('flowchart');

    const plain = only(plainBlock, 'duplicate-ids');
    const withFm = only(withFmBlock, 'duplicate-ids');
    expect(withFm).toHaveLength(plain.length);
    // `duplicate-ids` line numbers are body-relative (not header-anchored),
    // so the frontmatter block shifts them; normalize both sides to a
    // placeholder and compare only the non-positional content.
    const stripLines = (s: string) => s.replace(/line \d+/g, 'line N');
    expect(stripLines(withFm[0].message)).toBe(stripLines(plain[0].message));
  });

  it('reports duplicate-ids in a frontmatter diagram for a standalone .mmd file', () => {
    // Same regression as the `.md` case above, but through the `.mmd` branch
    // of `extractMermaidBlocks` (no fence — the whole file is the diagram),
    // which `toAbsLine` in markdown-adapter.ts offsets differently than a
    // fenced block. Pinned separately since the two paths could diverge.
    const md = [
      '---',
      'title: T',
      '---',
      'flowchart LR',
      '  A[Start] --> B',
      '  A[Begin] --> C',
    ].join('\n');
    const [b] = extractMermaidBlocks('test.mmd', md);
    expect(b.type).toBe('flowchart');
    const findings = only(b, 'duplicate-ids');
    expect(findings).toHaveLength(1);
    expect(findings[0]?.line).toBe(6);
  });
});

describe('accDescr block scanning', () => {
  // `scanAccDescr`'s bare-keyword branch has to look ahead for the `{` that may
  // open on a later line. Spelled `lines.slice(i + 1).find(…)` — as wardley and
  // eventmodeling both had it — that copies the whole remaining body once per
  // bare `accDescr`: ~10ms at 8 000 lines, ~537ms at 32 000, ~8s at 128 000, a
  // clean 4x per doubling. Walking an index stops at the first non-blank line,
  // which in this body is the next `accDescr`. Diagram bodies are user input
  // and `checkSemantics` runs ahead of any parse, so a body that never becomes
  // a valid diagram still reaches this.
  const BARE = Array.from({ length: 60_000 }, () => '  accDescr');

  it(
    'looks ahead from a bare accDescr in linear time, in wardley',
    { timeout: 60_000 },
    () => {
      const b = block(['wardley-beta', ...BARE].join('\n'), 'wardley-beta');
      const start = performance.now();
      // No `{` ever opens, so nothing declares a component.
      expect(only(b, 'wardley-no-components').map((f) => f.line)).toEqual([1]);
      expect(performance.now() - start).toBeLessThan(500);
    },
  );

  it(
    'looks ahead from a bare accDescr in linear time, in eventmodeling',
    { timeout: 60_000 },
    () => {
      const b = block(['eventmodeling', ...BARE].join('\n'), 'eventmodeling');
      const start = performance.now();
      expect(only(b, 'eventmodeling-undefined-frame')).toEqual([]);
      expect(performance.now() - start).toBeLessThan(500);
    },
  );

  it(
    'looks ahead from a bare accDescr in linear time, in treemap',
    { timeout: 60_000 },
    () => {
      const b = block(['treemap-beta', ...BARE].join('\n'), 'treemap-beta');
      const start = performance.now();
      expect(only(b, 'treemap-no-leaves').map((f) => f.line)).toEqual([1]);
      expect(performance.now() - start).toBeLessThan(500);
    },
  );
});
