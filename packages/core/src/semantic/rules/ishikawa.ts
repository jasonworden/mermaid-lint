import type { Block } from '../../extract.js';
import { indentWidth } from '../helpers.js';
import type { Rule, RuleContext, RuleFinding } from '../types.js';

/**
 * Depth at which `ishikawa-deep-nesting` starts flagging. The problem is depth
 * 1 and its categories are depth 2, so a node at depth 6 is the fourth level
 * below its category. Equal to {@link MINDMAP_MAX_DEPTH} and not shared
 * with it: the two agree by coincidence of taste, and retuning one should not
 * move the other.
 */
const ISHIKAWA_MAX_DEPTH = 5;

/** Depth of a category — the problem's own children, which draw the bones. */
const ISHIKAWA_CATEGORY_DEPTH = 2;

interface IshikawaNode {
  /** The line's trimmed text, which is all Mermaid keeps (see below). */
  text: string;
  /** 1-indexed body line. */
  line: number;
  /** The problem is depth 1; each level below it adds one. */
  depth: number;
  /** Body line of the parent node, or `null` for the problem. */
  parentLine: number | null;
}

function isIshikawa(block: Block): boolean {
  return block.type === 'ishikawa-beta';
}

/**
 * Parse an ishikawa body into a flat node list with parent links, replicating
 * `IshikawaDB.addNode` rather than reusing {@link parseMindmapNodes}. The two
 * hierarchies look alike but resolve differently, in two ways that change what
 * the rules see:
 *
 * - **The problem is never popped.** `addNode`'s pop loop guards on
 *   `stack.length > 1`, so every node after the first is a descendant of the
 *   first no matter how it is indented — two problems at the same indent make
 *   the second a *category* of the first, and outdenting past the problem does
 *   the same. A stack-of-indents parser would report a second root instead.
 * - **`baseLevel` is set by the second node**, not the first, so the problem's
 *   own indent is never read. An unindented problem line therefore works.
 *
 * Indent is measured in characters (a tab counts as one, as in
 * {@link indentWidth}), and an indent jump of several levels at once is
 * normalized to a single level rather than creating phantom ones.
 *
 * A node's text is its trimmed line — the grammar is `SPACELIST TEXT` with
 * `TEXT` as `[^\n]+`, so there are no shape wrappers, no leading ids, and no
 * directives (`title X` parses as a *node*). Inner whitespace is therefore
 * significant, quotes are part of the label, and on a *body* line a trailing
 * `%% note` is part of the text: `TEXT` has already swallowed it by then, so
 * only an own-line `%%` is a comment there.
 *
 * Two things sit between this and mermaid's label, both shared with the other
 * indentation-based families and neither reachable by ordinary input: mermaid
 * reads a *preprocessed* body, so an inline `%%{...}%%` is deleted from the
 * middle of a line (see `preprocess.ts`) where this keeps it; and it runs each
 * label through `common.sanitizeText`, which is a no-op under the default
 * config. Both make a rule miss a duplicate rather than invent one.
 *
 * The header line is read too. `ishikawa-beta Problem` lexes as
 * `ISHIKAWA SPACELIST TEXT` and makes `Problem` the root, so skipping the
 * header wholesale would lose it and make a diagram with causes look like one
 * without. Its indent is unread, per `baseLevel` above, so only its text
 * matters — and there the `%%` rule *does* apply, because the lexer is sitting
 * at whitespace rather than mid-`TEXT` (see the check below).
 */
function parseIshikawaNodes({
  lines,
  headerLine,
  headerText,
}: RuleContext): IshikawaNode[] {
  const nodes: IshikawaNode[] = [];
  // Mirrors `IshikawaDB.stack`: the problem enters at level 0 and stays put,
  // which is what the `stack.length > 1` pop guard below protects.
  const stack: { level: number; line: number }[] = [];
  let baseLevel: number | undefined;

  const push = (text: string, line: number, rawLevel: number): void => {
    let level = 0;
    if (stack.length > 0) {
      baseLevel ??= rawLevel;
      level = Math.max(1, rawLevel - baseLevel + 1);
      while (stack.length > 1 && stack[stack.length - 1].level >= level) {
        stack.pop();
      }
    }
    nodes.push({
      text,
      line,
      depth: stack.length + 1,
      parentLine: stack[stack.length - 1]?.line ?? null,
    });
    stack.push({ level, line });
  };

  // Text trailing the keyword on the header line, if any, is the problem. Its
  // indent is passed as 0 and never read — `baseLevel` is seeded by the node
  // after it.
  //
  // A `%%` tail is a comment, not a node: the lexer's comment rule (`\s*%%.*`)
  // is tried before its `TEXT` rule, and on this line it is sitting at the
  // whitespace after the keyword rather than mid-`TEXT`, so the comment rule
  // wins and declares nothing. Without this check the comment becomes the
  // problem, which both invents a finding against it and pushes every real
  // node down a level.
  const afterKeyword = headerText.replace(/^\S+/, '').trim();
  if (afterKeyword.length > 0 && !afterKeyword.startsWith('%%')) {
    push(afterKeyword, headerLine, 0);
  }

  for (let i = headerLine; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (trimmed.length === 0 || trimmed.startsWith('%%')) continue;
    push(trimmed, i + 1, indentWidth(lines[i]));
  }
  return nodes;
}

/** Lines of the nodes that some other node hangs off — i.e. the non-leaves. */
function ishikawaParentLines(nodes: IshikawaNode[]): Set<number> {
  return new Set(
    nodes
      .map((node) => node.parentLine)
      .filter((line): line is number => line !== null),
  );
}

export const ishikawaNoCauses: Rule = {
  id: 'ishikawa-no-causes',
  appliesTo: isIshikawa,
  evaluate: (ctx) => {
    const nodes = parseIshikawaNodes(ctx);
    // No nodes at all is a different diagram — one with no problem to name.
    // `ishikawa-beta\n` parses and renders empty, but #147 leaves that case to
    // a follow-up rule rather than folding it in here.
    const problem = nodes[0];
    if (problem === undefined || ishikawaParentLines(nodes).has(problem.line)) {
      return [];
    }
    return [
      {
        message: `ishikawa problem \`${problem.text}\` has no causes; it renders as the problem head above a zero-length spine.`,
        line: problem.line,
      },
    ];
  },
};

export const ishikawaEmptyCategory: Rule = {
  id: 'ishikawa-empty-category',
  appliesTo: isIshikawa,
  evaluate: (ctx) => {
    const nodes = parseIshikawaNodes(ctx);
    const parents = ishikawaParentLines(nodes);
    return nodes
      .filter(
        (node) =>
          node.depth === ISHIKAWA_CATEGORY_DEPTH && !parents.has(node.line),
      )
      .map((node) => ({
        message: `ishikawa category \`${node.text}\` has no causes; its bone draws at a fifth of full length with nothing attached.`,
        line: node.line,
      }));
  },
};

export const ishikawaDeepNesting: Rule = {
  id: 'ishikawa-deep-nesting',
  appliesTo: isIshikawa,
  evaluate: (ctx) =>
    parseIshikawaNodes(ctx)
      .filter((node) => node.depth > ISHIKAWA_MAX_DEPTH)
      .map((node) => ({
        message: `ishikawa node \`${node.text}\` is nested ${node.depth} levels deep (beyond ${ISHIKAWA_MAX_DEPTH}); deeply nested causes render, but stop communicating.`,
        line: node.line,
      })),
};

export const ishikawaDuplicateSibling: Rule = {
  id: 'ishikawa-duplicate-sibling',
  appliesTo: isIshikawa,
  evaluate: (ctx) => {
    // Destructured rather than called as `ctx.fileLine` so the citation stays
    // in the shape semantic.test.ts's source scan polices.
    const { fileLine } = ctx;
    const findings: RuleFinding[] = [];
    // key: `${parentLine}\0${text}` -> first line seen
    const seen = new Map<string, number>();
    for (const node of parseIshikawaNodes(ctx)) {
      if (node.parentLine === null) continue;
      const key = `${node.parentLine}\0${node.text}`;
      const first = seen.get(key);
      if (first === undefined) {
        seen.set(key, node.line);
      } else {
        findings.push({
          message: `ishikawa node \`${node.text}\` duplicates a sibling (first on line ${fileLine(first)}); the same cause renders twice under one parent.`,
          line: node.line,
        });
      }
    }
    return findings;
  },
};
