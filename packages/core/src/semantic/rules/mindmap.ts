import type { Block } from '../../extract.js';
import { indentWidth } from '../helpers.js';
import type { Rule, RuleFinding } from '../types.js';

/**
 * Depth at which `mindmap-deep-nesting` starts flagging. The root node is
 * depth 1, so a node at depth 6 is the fifth level below the root.
 */
const MINDMAP_MAX_DEPTH = 5;

/** A trailing `:::className` decorator on a mindmap node. */
const MINDMAP_CLASS_RE = /\s*:::[\w-]+\s*$/;

/** Opening→closing delimiter pairs for the six mindmap node shapes. */
const MINDMAP_SHAPES: ReadonlyArray<readonly [string, string]> = [
  ['((', '))'], // circle
  ['))', '(('], // bang
  ['{{', '}}'], // hexagon
  [')', '('], // cloud
  ['[', ']'], // square
  ['(', ')'], // rounded
];

interface MindmapNode {
  /** Display text (shape wrapper, leading id, and `:::class` stripped). */
  text: string;
  /** 1-indexed body line. */
  line: number;
  /** Root is depth 1; each indentation level adds one. */
  depth: number;
  /** Body line of the parent node, or `null` for the root. */
  parentLine: number | null;
}

function isMindmap(block: Block): boolean {
  return block.type === 'mindmap';
}

/**
 * Extract a mindmap node's display text. A node may carry an optional leading
 * id and one of six shape wrappers (`id((circle))`, `id[square]`, …) plus a
 * trailing `:::class`; the visible text is what sits inside the wrapper, or the
 * whole token when the node is plain text.
 */
function mindmapNodeText(trimmed: string): string {
  const s = trimmed.replace(MINDMAP_CLASS_RE, '').trim();
  const idMatch = /^[\w-]+/.exec(s);
  const afterId = idMatch === null ? s : s.slice(idMatch[0].length);
  for (const [open, close] of MINDMAP_SHAPES) {
    if (
      afterId.length >= open.length + close.length &&
      afterId.startsWith(open) &&
      afterId.endsWith(close)
    ) {
      return afterId.slice(open.length, afterId.length - close.length).trim();
    }
  }
  return s;
}

/**
 * Parse a mindmap body into a flat node list with parent links. Hierarchy is
 * indentation-based: a deeper-indented line is a child of the nearest shallower
 * line. The leading `mindmap` keyword, blank lines, `%%` comments, and `::icon`
 * decorator lines are skipped.
 */
function parseMindmapNodes(lines: string[]): MindmapNode[] {
  const nodes: MindmapNode[] = [];
  const stack: { indent: number; line: number }[] = [];
  let seenKeyword = false;

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (trimmed.length === 0 || trimmed.startsWith('%%')) continue;
    if (!seenKeyword) {
      // The first content line is the `mindmap` keyword itself.
      seenKeyword = true;
      continue;
    }
    if (trimmed.startsWith('::')) continue; // `::icon(...)` decorator

    const indent = indentWidth(lines[i]);
    while (stack.length > 0 && stack[stack.length - 1].indent >= indent) {
      stack.pop();
    }
    const parentLine = stack.length > 0 ? stack[stack.length - 1].line : null;
    nodes.push({
      text: mindmapNodeText(trimmed),
      line: i + 1,
      depth: stack.length + 1,
      parentLine,
    });
    stack.push({ indent, line: i + 1 });
  }
  return nodes;
}

export const mindmapDuplicateSibling: Rule = {
  id: 'mindmap-duplicate-sibling',
  appliesTo: isMindmap,
  evaluate: ({ lines, fileLine }) => {
    const findings: RuleFinding[] = [];
    // key: `${parentLine}\0${text}` -> first line seen
    const seen = new Map<string, number>();
    for (const node of parseMindmapNodes(lines)) {
      const key = `${node.parentLine ?? 'root'}\0${node.text}`;
      const first = seen.get(key);
      if (first === undefined) {
        seen.set(key, node.line);
      } else {
        findings.push({
          message: `mindmap node \`${node.text}\` duplicates a sibling (first on line ${fileLine(first)}); two identical branches render under the same parent.`,
          line: node.line,
        });
      }
    }
    return findings;
  },
};

export const mindmapNoNodes: Rule = {
  id: 'mindmap-no-nodes',
  appliesTo: isMindmap,
  evaluate: ({ lines, headerLine }) => {
    if (parseMindmapNodes(lines).length > 0) return [];
    return [
      {
        message:
          'mindmap has no nodes; it parses but renders as an empty diagram.',
        line: headerLine,
      },
    ];
  },
};

export const mindmapDeepNesting: Rule = {
  id: 'mindmap-deep-nesting',
  appliesTo: isMindmap,
  evaluate: ({ lines }) => {
    const findings: RuleFinding[] = [];
    for (const node of parseMindmapNodes(lines)) {
      if (node.depth > MINDMAP_MAX_DEPTH) {
        findings.push({
          message: `mindmap node \`${node.text}\` is nested ${node.depth} levels deep (beyond ${MINDMAP_MAX_DEPTH}); deeply nested branches are hard to read.`,
          line: node.line,
        });
      }
    }
    return findings;
  },
};
