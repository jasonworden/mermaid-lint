import type { Block } from '../../extract.js';
import type { Rule, RuleFinding } from '../types.js';

const ARCHITECTURE_DECL_RE =
  /^\s*(service|group|junction)\s+([A-Za-z0-9_][\w-]*)\b/;
const ARCHITECTURE_EDGE_RE =
  /^\s*([A-Za-z0-9_][\w-]*)(\{group\})?\s*:\s*([TBLR])\s*(<)?--(>)?\s*([TBLR])\s*:\s*([A-Za-z0-9_][\w-]*)(\{group\})?\s*$/;

interface ArchitectureDeclaration {
  line: number;
}

interface ArchitectureEdge {
  leftId: string;
  leftGroup: boolean;
  leftPort: string;
  operator: string;
  rightPort: string;
  rightId: string;
  rightGroup: boolean;
  line: number;
}

function isArchitecture(block: Block): boolean {
  return block.type === 'architecture-beta';
}

function collectArchitectureDeclarations(
  lines: string[],
): ArchitectureDeclaration[] {
  const declarations: ArchitectureDeclaration[] = [];
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    if (raw.trimStart().startsWith('%%')) continue;
    if (ARCHITECTURE_DECL_RE.test(raw)) {
      declarations.push({ line: i + 1 });
    }
  }
  return declarations;
}

function collectArchitectureEdges(lines: string[]): ArchitectureEdge[] {
  const edges: ArchitectureEdge[] = [];
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    if (raw.trimStart().startsWith('%%')) continue;
    const edge = ARCHITECTURE_EDGE_RE.exec(raw);
    if (edge === null) continue;
    edges.push({
      leftId: edge[1],
      leftGroup: edge[2] === '{group}',
      leftPort: edge[3],
      operator: `${edge[4] ?? ''}--${edge[5] ?? ''}`,
      rightPort: edge[6],
      rightId: edge[7],
      rightGroup: edge[8] === '{group}',
      line: i + 1,
    });
  }
  return edges;
}

function formatArchitectureEdge(edge: ArchitectureEdge): string {
  const left = `${edge.leftId}${edge.leftGroup ? '{group}' : ''}:${edge.leftPort}`;
  const right = `${edge.rightPort}:${edge.rightId}${edge.rightGroup ? '{group}' : ''}`;
  return `${left} ${edge.operator} ${right}`;
}

export const architectureNoElements: Rule = {
  id: 'architecture-no-elements',
  appliesTo: isArchitecture,
  evaluate: ({ lines, headerLine }) => {
    if (collectArchitectureDeclarations(lines).length > 0) return [];
    return [
      {
        message:
          'architecture-beta has no elements (no declared elements), groups, or junctions; it parses but renders empty.',
        line: headerLine,
      },
    ];
  },
};

export const architectureNoEdges: Rule = {
  id: 'architecture-no-edges',
  appliesTo: isArchitecture,
  evaluate: ({ lines, headerLine }) => {
    if (collectArchitectureDeclarations(lines).length === 0) return [];
    if (collectArchitectureEdges(lines).length > 0) return [];
    return [
      {
        message:
          'architecture-beta declares elements but has no edges; it renders as disconnected symbols and is usually incomplete.',
        line: headerLine,
      },
    ];
  },
};

export const architectureDuplicateEdge: Rule = {
  id: 'architecture-duplicate-edge',
  appliesTo: isArchitecture,
  evaluate: ({ lines, fileLine }) => {
    const seen = new Map<string, number>();
    const findings: RuleFinding[] = [];

    for (const edge of collectArchitectureEdges(lines)) {
      const key = [
        edge.leftId,
        edge.leftGroup ? 'group' : '',
        edge.leftPort,
        edge.operator,
        edge.rightPort,
        edge.rightId,
        edge.rightGroup ? 'group' : '',
      ].join('\u0000');
      const first = seen.get(key);
      if (first === undefined) {
        seen.set(key, edge.line);
        continue;
      }
      findings.push({
        message: `architecture edge \`${formatArchitectureEdge(edge)}\` is declared more than once (first on line ${fileLine(first)}); repeated exact edges are usually a copy-paste mistake.`,
        line: edge.line,
      });
    }

    return findings;
  },
};
