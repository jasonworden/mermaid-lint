import type { Block } from '../../extract.js';
import { parseCsvCells } from '../helpers.js';
import type { Rule, RuleFinding } from '../types.js';

interface SankeyLink {
  source: string;
  target: string;
  value: number;
  line: number;
}

function isSankey(block: Block): boolean {
  return block.type === 'sankey-beta';
}

function parseSankeyLinks(lines: string[]): SankeyLink[] {
  const links: SankeyLink[] = [];
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const trimmed = raw.trim();
    if (trimmed === '' || trimmed.startsWith('%%')) continue;
    const parts = parseCsvCells(raw);
    if (parts === null || parts.length !== 3) continue;

    const source = parts[0].trim();
    const target = parts[1].trim();
    const value = Number(parts[2].trim());
    if (source === '' || target === '' || !Number.isFinite(value)) continue;

    links.push({ source, target, value, line: i + 1 });
  }
  return links;
}

export const sankeyNonPositiveValue: Rule = {
  id: 'sankey-non-positive-value',
  appliesTo: isSankey,
  evaluate: ({ lines }) =>
    parseSankeyLinks(lines)
      .filter((link) => link.value <= 0)
      .map((link) => ({
        message: `sankey link \`${link.source}\` → \`${link.target}\` has a non-positive value (${link.value}); sankey flows should be greater than 0.`,
        line: link.line,
      })),
};

export const sankeyDuplicateLink: Rule = {
  id: 'sankey-duplicate-link',
  appliesTo: isSankey,
  evaluate: ({ lines, fileLine }) => {
    const seen = new Map<string, number>();
    const findings: RuleFinding[] = [];

    for (const link of parseSankeyLinks(lines)) {
      const key = `${link.source}\u0000${link.target}`;
      const first = seen.get(key);
      if (first === undefined) {
        seen.set(key, link.line);
        continue;
      }
      findings.push({
        message: `sankey link \`${link.source} -> ${link.target}\` is declared more than once (first on line ${fileLine(first)}); repeated source/target rows are usually copy-paste duplicates.`,
        line: link.line,
      });
    }

    return findings;
  },
};

export const sankeySelfLoop: Rule = {
  id: 'sankey-self-loop',
  appliesTo: isSankey,
  evaluate: ({ lines }) =>
    parseSankeyLinks(lines)
      .filter((link) => link.source === link.target)
      .map((link) => ({
        message: `sankey link \`${link.source}\` → \`${link.target}\` is a self-loop, which is usually unintentional.`,
        line: link.line,
      })),
};
