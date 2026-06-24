import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ALL_RULE_IDS, RULE_METADATA, type RuleId } from '../src/rules.js';

const repoRoot = resolve(import.meta.dirname, '../../..');

type MarkdownRow = Record<string, string>;

function readRepoFile(path: string): string {
  return readFileSync(resolve(repoRoot, path), 'utf8');
}

function extractSection(markdown: string, heading: string): string {
  const start = markdown.indexOf(heading);
  expect(start, `Expected to find heading "${heading}"`).toBeGreaterThanOrEqual(
    0,
  );

  const afterHeading = markdown.slice(start + heading.length);
  const nextHeading = afterHeading.search(/\n#{1,2} /);
  return nextHeading === -1 ? afterHeading : afterHeading.slice(0, nextHeading);
}

function parseFirstTable(markdown: string, label: string): MarkdownRow[] {
  const lines = markdown
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.startsWith('|'));

  expect(
    lines.length,
    `Expected ${label} to contain a Markdown table`,
  ).toBeGreaterThanOrEqual(2);

  const headers = splitTableRow(lines[0]);
  const separator = splitTableRow(lines[1]);
  expect(
    separator.every((cell) => /^:?-{3,}:?$/.test(cell)),
    `Expected ${label} table to have a separator row`,
  ).toBe(true);

  return lines.slice(2).map((line) => {
    const cells = splitTableRow(line);
    expect(
      cells.length,
      `Expected ${label} row to have ${headers.length} cells: ${line}`,
    ).toBe(headers.length);
    return Object.fromEntries(
      headers.map((header, index) => [header, cells[index]]),
    );
  });
}

function splitTableRow(line: string): string[] {
  return line
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((cell) => cell.trim());
}

function codeSpanValue(cell: string): string {
  const match = cell.match(/^`([^`]+)`$/);
  expect(match, `Expected a single code span, got "${cell}"`).not.toBeNull();
  return match?.[1] ?? '';
}

function relatedRules(cell: string): RuleId[] {
  if (cell === '-') return [];
  const matches = [...cell.matchAll(/`([^`]+)`/g)];
  expect(
    matches.length,
    `Expected related-rules cell to contain rule ids in code spans or '-' for none, got "${cell}"`,
  ).toBeGreaterThan(0);
  return matches.map((match) => {
    const rule = match[1];
    expect(
      ALL_RULE_IDS,
      `README lists unknown rule "${rule}" in related-rules cell "${cell}"`,
    ).toContain(rule);
    return rule as RuleId;
  });
}

function keywordValues(cell: string): string[] {
  return [...cell.matchAll(/`([^`]+)`/g)].map((match) => match[1]);
}

describe('semantic rule documentation coverage', () => {
  it('keeps docs/semantic-rules.md in sync with rule metadata', () => {
    const docs = readRepoFile('docs/semantic-rules.md');
    const rows = parseFirstTable(
      extractSection(docs, '## Rule Reference'),
      'docs/semantic-rules.md Rule Reference',
    );

    const docsRuleIds = rows.map((row) => codeSpanValue(row.Rule));
    expect(docsRuleIds).toEqual(ALL_RULE_IDS);

    for (const row of rows) {
      const ruleId = codeSpanValue(row.Rule) as RuleId;
      const metadata = RULE_METADATA[ruleId];
      expect(row.Default, `${ruleId} docs default severity`).toBe(
        `\`${metadata.defaultSeverity}\``,
      );
      expect(row.Scope, `${ruleId} docs scope`).toBe(metadata.docsScope);
    }
  });

  it('keeps README diagram related-rules cells in sync with rule metadata', () => {
    const readme = readRepoFile('README.md');
    const rows = parseFirstTable(
      extractSection(readme, '## Diagram types'),
      'README.md Diagram types',
    );
    const readmeKeywords = new Set(
      rows.flatMap((row) => keywordValues(row.Keyword)),
    );

    for (const ruleId of ALL_RULE_IDS) {
      for (const keyword of RULE_METADATA[ruleId].readmeDiagramKeywords) {
        expect(
          readmeKeywords.has(keyword),
          `${ruleId} metadata references README keyword "${keyword}"`,
        ).toBe(true);
      }
    }

    for (const row of rows) {
      const keywords = keywordValues(row.Keyword);
      const actual = relatedRules(row['Related rules']);
      const expected = ALL_RULE_IDS.filter((ruleId) =>
        RULE_METADATA[ruleId].readmeDiagramKeywords.some((keyword) =>
          keywords.includes(keyword),
        ),
      );

      expect(
        actual,
        `${row.Type} (${keywords.join(' / ')}) related rules`,
      ).toEqual(expected);
    }
  });
});
