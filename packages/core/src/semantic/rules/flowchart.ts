import { extractEdges } from '../../edges.js';
import { NODE_DECL_RE, extractLabel, isFlowchartOrGraph } from '../helpers.js';
import type { Rule, RuleFinding } from '../types.js';

export const duplicateIds: Rule = {
  id: 'duplicate-ids',
  appliesTo: isFlowchartOrGraph,
  evaluate: ({ lines, fileLine }) => {
    const seen = new Map<string, { label: string; line: number }>();
    const findings: RuleFinding[] = [];

    for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
      const line = lines[lineIdx];
      if (line.trimStart().startsWith('%%')) continue;

      NODE_DECL_RE.lastIndex = 0;
      for (;;) {
        const m = NODE_DECL_RE.exec(line);
        if (m === null) break;
        const id = m[1];
        const label = extractLabel(m);
        const bodyLine = lineIdx + 1;

        const prior = seen.get(id);
        if (prior === undefined) {
          seen.set(id, { label, line: bodyLine });
        } else if (prior.label !== label) {
          findings.push({
            message: `node "${id}" declared with label "${prior.label}" (line ${fileLine(prior.line)}) and "${label}" (line ${fileLine(bodyLine)})`,
            line: bodyLine,
          });
        }
      }
    }

    return findings;
  },
};

export const noDuplicateNodeDeclarations: Rule = {
  id: 'no-duplicate-node-declarations',
  appliesTo: isFlowchartOrGraph,
  evaluate: ({ lines, fileLine }) => {
    const seen = new Map<string, { label: string; line: number }>();
    const findings: RuleFinding[] = [];

    for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
      const line = lines[lineIdx];
      if (line.trimStart().startsWith('%%')) continue;

      NODE_DECL_RE.lastIndex = 0;
      for (;;) {
        const m = NODE_DECL_RE.exec(line);
        if (m === null) break;
        const id = m[1];
        const label = extractLabel(m);
        const bodyLine = lineIdx + 1;

        const prior = seen.get(id);
        if (prior === undefined) {
          seen.set(id, { label, line: bodyLine });
        } else if (prior.label === label) {
          findings.push({
            message: `node \`${id}\` is declared with the same label more than once (first on line ${fileLine(prior.line)}); duplicate declarations are usually copy-paste noise.`,
            line: bodyLine,
          });
        }
      }
    }

    return findings;
  },
};

export const noDuplicateEdges: Rule = {
  id: 'no-duplicate-edges',
  appliesTo: isFlowchartOrGraph,
  evaluate: ({ lines, fileLine }) => {
    const edges = extractEdges(lines);
    const seen = new Map<string, number>(); // key -> firstLine
    const findings: RuleFinding[] = [];

    for (const e of edges) {
      const key = `${e.source} ${e.target} ${e.label ?? ''}`;
      const firstLine = seen.get(key);
      if (firstLine === undefined) {
        seen.set(key, e.line);
      } else {
        findings.push({
          message: `duplicate edge: \`${e.source}\` → \`${e.target}\` is defined more than once (first on line ${fileLine(firstLine)}); duplicate edges render stacked and are usually a copy-paste mistake.`,
          line: e.line,
        });
      }
    }

    return findings;
  },
};

export const noSelfLoop: Rule = {
  id: 'no-self-loop',
  appliesTo: isFlowchartOrGraph,
  evaluate: ({ lines }) => {
    const edges = extractEdges(lines);
    const findings: RuleFinding[] = [];

    for (const e of edges) {
      if (e.source === e.target) {
        findings.push({
          message: `node \`${e.source}\` has an edge to itself (self-loop), which is almost always unintentional.`,
          line: e.line,
        });
      }
    }

    return findings;
  },
};

export const noEmptyLabels: Rule = {
  id: 'no-empty-labels',
  appliesTo: isFlowchartOrGraph,
  evaluate: ({ lines }) => {
    const findings: RuleFinding[] = [];

    for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
      const line = lines[lineIdx];
      if (line.trimStart().startsWith('%%')) continue;

      NODE_DECL_RE.lastIndex = 0;
      for (;;) {
        const m = NODE_DECL_RE.exec(line);
        if (m === null) break;
        const id = m[1];
        const label = extractLabel(m);
        if (label === '') {
          findings.push({
            message: `node \`${id}\` has an empty label and will render as a blank shape.`,
            line: lineIdx + 1,
          });
        }
      }
    }

    return findings;
  },
};

// Known blind spot: a node used only via subgraph membership (not connected by
// any explicit edge) will appear as an orphan here even though it is not truly
// isolated in the rendered output. This is why `no-orphan-nodes` defaults to
// `off` — users must explicitly opt in.
export const noOrphanNodes: Rule = {
  id: 'no-orphan-nodes',
  appliesTo: isFlowchartOrGraph,
  evaluate: ({ lines }) => {
    const edges = extractEdges(lines);
    const referenced = new Set<string>();
    for (const e of edges) {
      referenced.add(e.source);
      referenced.add(e.target);
    }

    // Track first declaration line per id
    const declared = new Map<string, number>(); // id -> first declaration line
    for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
      const line = lines[lineIdx];
      if (line.trimStart().startsWith('%%')) continue;

      NODE_DECL_RE.lastIndex = 0;
      for (;;) {
        const m = NODE_DECL_RE.exec(line);
        if (m === null) break;
        const id = m[1];
        if (!declared.has(id)) {
          declared.set(id, lineIdx + 1);
        }
      }
    }

    // Emit findings for declared nodes that are never referenced in an edge,
    // sorted by first declaration line.
    const orphans = [...declared.entries()]
      .filter(([id]) => !referenced.has(id))
      .sort(([, a], [, b]) => a - b);

    return orphans.map(([id, line]) => ({
      message: `node \`${id}\` is declared but never connected by an edge; it will not appear in most rendered layouts.`,
      line,
    }));
  },
};
