import { describe, expect, it } from 'vitest';
import { parseBodyDirectives, parseFileDirectives } from '../src/suppress.js';

describe('parseBodyDirectives', () => {
  it('parses a next-line directive with one rule and a reason', () => {
    const [d] = parseBodyDirectives([
      '%% mermaid-lint-disable-next-line duplicate-ids: ids collide upstream',
    ]);
    expect(d.kind).toBe('next-line');
    expect(d.rules).toEqual(['duplicate-ids']);
    expect(d.reason).toBe('ids collide upstream');
    expect(d.line).toBe(1);
    expect(d.problems).toEqual([]);
  });

  it('parses space- and comma-separated rule lists', () => {
    const [space] = parseBodyDirectives([
      '%% mermaid-lint-disable-diagram duplicate-ids no-self-loop: legacy',
    ]);
    expect(space.rules).toEqual(['duplicate-ids', 'no-self-loop']);
    const [comma] = parseBodyDirectives([
      '%% mermaid-lint-disable-diagram duplicate-ids, no-self-loop: legacy',
    ]);
    expect(comma.rules).toEqual(['duplicate-ids', 'no-self-loop']);
  });

  it('parses the `all` wildcard', () => {
    const [d] = parseBodyDirectives([
      '%% mermaid-lint-disable-diagram all: vendored diagram',
    ]);
    expect(d.rules).toBe('all');
  });

  it('parses range start and end', () => {
    const ds = parseBodyDirectives([
      'flowchart LR',
      '%% mermaid-lint-disable duplicate-ids: generated section',
      '  A --> B',
      '%% mermaid-lint-enable duplicate-ids',
    ]);
    expect(ds.map((d) => d.kind)).toEqual(['range-start', 'range-end']);
    expect(ds[0].line).toBe(2);
    expect(ds[1].line).toBe(4);
  });

  it('does not require a reason on enable', () => {
    const [d] = parseBodyDirectives(['%% mermaid-lint-enable duplicate-ids']);
    expect(d.problems).toEqual([]);
  });

  it('flags a missing reason', () => {
    const [d] = parseBodyDirectives(['%% mermaid-lint-disable duplicate-ids']);
    expect(d.problems).toEqual([{ kind: 'missing-reason' }]);
  });

  it('flags a blank reason', () => {
    const [d] = parseBodyDirectives([
      '%% mermaid-lint-disable duplicate-ids:   ',
    ]);
    expect(d.problems).toEqual([{ kind: 'missing-reason' }]);
  });

  it('flags an empty rule list', () => {
    const [d] = parseBodyDirectives(['%% mermaid-lint-disable : why']);
    expect(d.problems).toContainEqual({ kind: 'empty-rules' });
  });

  it('flags an unknown rule id', () => {
    const [d] = parseBodyDirectives([
      '%% mermaid-lint-disable-diagram duplicat-ids: typo',
    ]);
    expect(d.problems).toContainEqual({
      kind: 'unknown-rule',
      rule: 'duplicat-ids',
    });
  });

  it('flags `mermaid` named at line scope', () => {
    const [d] = parseBodyDirectives([
      '%% mermaid-lint-disable-next-line mermaid: bleeding edge',
    ]);
    expect(d.problems).toContainEqual({ kind: 'syntax-rule-at-line-scope' });
  });

  it('accepts `mermaid` at diagram scope', () => {
    const [d] = parseBodyDirectives([
      '%% mermaid-lint-disable-diagram mermaid: parser predates v11',
    ]);
    expect(d.problems).toEqual([]);
  });

  it('ignores unrelated comments and mermaid init directives', () => {
    expect(
      parseBodyDirectives(['%% just a note', "%%{init: {'theme':'dark'}}%%"]),
    ).toEqual([]);
  });

  it('tolerates indentation', () => {
    const [d] = parseBodyDirectives([
      '    %% mermaid-lint-disable-next-line duplicate-ids: indented',
    ]);
    expect(d.kind).toBe('next-line');
  });
});

describe('parseFileDirectives', () => {
  it('parses an HTML-comment file directive', () => {
    const [d] = parseFileDirectives(
      '# Doc\n\n<!-- mermaid-lint-disable-file duplicate-ids: vendored docs -->\n',
    );
    expect(d.kind).toBe('file');
    expect(d.rules).toEqual(['duplicate-ids']);
    expect(d.reason).toBe('vendored docs');
  });

  it('ignores unrelated HTML comments', () => {
    expect(parseFileDirectives('<!-- prettier-ignore -->')).toEqual([]);
  });

  it('flags a missing reason at file scope', () => {
    const [d] = parseFileDirectives('<!-- mermaid-lint-disable-file all -->');
    expect(d.problems).toEqual([{ kind: 'missing-reason' }]);
  });
});
