import type { Block } from '../../extract.js';
import type { Rule, RuleFinding } from '../types.js';

/** A quoted `id: "…"` attribute on a commit/merge line. Captures [1]=id. */
const GITGRAPH_ID_RE = /\bid:\s*"([^"]*)"/;

/** A quoted `tag: "…"` attribute on a commit/merge line. Captures [1]=tag. */
const GITGRAPH_TAG_RE = /\btag:\s*"([^"]*)"/;

function isGitGraph(block: Block): boolean {
  return block.type === 'gitGraph';
}

/**
 * Lines that declare a graph node carrying an optional `id:`/`tag:`. A
 * `cherry-pick id: "…"` line *references* an existing commit id rather than
 * declaring one, so it is deliberately excluded — counting it would
 * double-count a valid id and produce a false duplicate.
 */
function isGitGraphNodeLine(trimmed: string): boolean {
  return /^(?:commit|merge)\b/.test(trimmed);
}

/**
 * Collect every `id:`/`tag:` value from commit/merge lines, keyed to the first
 * body line each appeared on, and flag any that recur. Shared by the
 * duplicate-id and duplicate-tag rules.
 */
function findGitGraphDuplicates(
  lines: string[],
  re: RegExp,
  describe: (value: string, first: number) => string,
): RuleFinding[] {
  const seen = new Map<string, number>();
  const findings: RuleFinding[] = [];
  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (trimmed.startsWith('%%') || !isGitGraphNodeLine(trimmed)) continue;
    const m = re.exec(trimmed);
    if (m === null) continue;
    const value = m[1];
    const first = seen.get(value);
    if (first === undefined) {
      seen.set(value, i + 1);
    } else {
      findings.push({ message: describe(value, first), line: i + 1 });
    }
  }
  return findings;
}

export const gitgraphDuplicateCommitId: Rule = {
  id: 'gitgraph-duplicate-commit-id',
  appliesTo: isGitGraph,
  evaluate: ({ lines, fileLine }) =>
    findGitGraphDuplicates(
      lines,
      GITGRAPH_ID_RE,
      (value, first) =>
        `commit id \`${value}\` is used more than once (first on line ${fileLine(first)}); commit ids must be unique, and \`merge\`/\`cherry-pick\` references to it are ambiguous.`,
    ),
};

export const gitgraphDuplicateTag: Rule = {
  id: 'gitgraph-duplicate-tag',
  appliesTo: isGitGraph,
  evaluate: ({ lines, fileLine }) =>
    findGitGraphDuplicates(
      lines,
      GITGRAPH_TAG_RE,
      (value, first) =>
        `tag \`${value}\` is used more than once (first on line ${fileLine(first)}); two commits render with the same tag, usually a copy-paste mistake.`,
    ),
};

export const gitgraphNoCommits: Rule = {
  id: 'gitgraph-no-commits',
  appliesTo: isGitGraph,
  evaluate: ({ lines, headerLine }) => {
    const hasCommit = lines.some((l) => /^commit\b/.test(l.trim()));
    if (hasCommit) return [];
    return [
      {
        message:
          'gitGraph has no commits; it parses but renders as an empty diagram.',
        line: headerLine,
      },
    ];
  },
};
