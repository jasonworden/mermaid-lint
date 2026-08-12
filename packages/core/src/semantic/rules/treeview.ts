import type { Block } from '../../extract.js';
import {
  ACC_DESCR_BARE_RE,
  type AccDescrState,
  CONSUME_LINE,
  precedingIndent,
  scanAccDescr,
} from '../helpers.js';
import type { Rule, RuleFinding } from '../types.js';

/** `title` with a separator after it, which swallows the rest of the line. */
const TREEVIEW_TITLE_LINE_RE = /^title[\t ]/;

/** `title` used as the bare keyword, which swallows only itself. */
const TREEVIEW_TITLE_KEYWORD_RE = /^title/;

/** The two accessibility statements that take a `:` and swallow their line. */
const TREEVIEW_ACC_COLON_RE = /^acc(?:Title|Descr)[\t ]*:/;

/**
 * Advance the metadata scan by one line of a treeView body, and say what is
 * left of that line to read as nodes.
 *
 * Same protocol as {@link scanAccDescr}: `null` means the line declares nodes
 * from column zero, {@link CONSUME_LINE} means it declares none, and any other
 * number is an offset into the line at which nodes resume.
 *
 * Which keywords count is narrower than it looks, and narrower than it was
 * before mermaid 11.16.0 added bare names. A metadata statement only exists
 * where its terminal matches; anywhere else the same word is now just the start
 * of a node's name, and skipping the line would lose a node mermaid renders.
 * So `accTitle: v` is metadata but `accTitle v` is a node called `accTitle v`,
 * and a lone `accDescr` that no `{` follows is a node called `accDescr`.
 *
 * `title` is the one that resumes mid-line rather than consuming or not: its
 * terminal ends with an *empty* alternative, and the lexer prefers it to a bare
 * name, so `title` always lexes as a title and only swallows the rest of the
 * line when a space or tab follows it. `title"p"` and `title-x` are an empty
 * title plus the node `p` or `-x`; `title p` is the caption `p` and no node.
 */
function scanTreeViewMeta(
  state: AccDescrState,
  lines: string[],
  i: number,
): number | null {
  const raw = lines[i];
  const trimmed = raw.trim();
  const lead = raw.length - raw.trimStart().length;

  const wasOpen = state.open;
  const verdict = scanAccDescr(state, lines, i, true);
  // `scanAccDescr` consumes a bare `accDescr` whether or not a `{` ever
  // follows, which is right for the types that share it and would drop a node
  // here: mermaid's `ACC_DESCR` needs the brace — across newlines, hence the
  // lookahead — so an `accDescr` that opened nothing is a node called
  // `accDescr`.
  const openedNothing =
    !wasOpen && !state.open && ACC_DESCR_BARE_RE.test(trimmed);
  if (verdict !== null && !openedNothing) return verdict;

  if (TREEVIEW_ACC_COLON_RE.test(trimmed)) return CONSUME_LINE;
  if (TREEVIEW_TITLE_LINE_RE.test(trimmed)) return CONSUME_LINE;
  if (TREEVIEW_TITLE_KEYWORD_RE.test(trimmed)) return lead + 'title'.length;
  return null;
}

/**
 * One treeView node name, in either of the two forms the grammar admits.
 *
 * Groups: exactly one of [1] (double-quoted), [2] (single-quoted), or [3]
 * (bare) holds the name. The first two are mermaid's `QUOTED_NAME`
 * (`/"[^"]*"|'[^']*'/`) — no escape, so a name runs to the next matching
 * quote. The third is `BARE_NAME`, added in mermaid 11.16.0 along with the
 * file-tree features: an unquoted name was a lexer error before that release,
 * which is why these rules once keyed on quoted text alone.
 *
 * `BARE_NAME` starts on any character that is not whitespace or a quote and
 * then runs to the end of the line, so a bare name is always the last name on
 * its line — `a "b"` is the single node `a "b"`, while `"a" b` is two. The
 * three lookaheads are the exceptions: an annotation (`:::class`, `icon(…)`,
 * or `## description`) ends the name, both at its start and wherever it
 * appears later behind a space. Those are metadata on the node, not part of
 * its name, so the scan stops before them and never captures them.
 *
 * The whitespace before a name is what mermaid measures as its indent, but it
 * is counted by {@link precedingIndent} rather than captured here: a leading
 * `([ \t]*)` re-scans the whole run at every start position it fails from,
 * which is quadratic on a line of nothing but spaces — 80 000 of them took
 * ~2.8s. Diagram bodies are user input and `checkSemantics` runs ahead of any
 * parse, so an unparseable body still reaches this. The bare alternative keeps
 * that property: its first character class rejects whitespace outright, so a
 * run of spaces fails all three alternatives on their first character.
 */
const TREEVIEW_NAME_RE =
  /"([^"]*)"|'([^']*)'|((?!:::|icon\(|##)[^ \t\r\n"'](?:(?![ \t]+:::[ \t]*[A-Za-z_]|[ \t]+icon\(|[ \t]+##)[^\r\n])*)/g;

/**
 * The annotations that may trail a node name: a CSS class, an icon, and a
 * description, in mermaid's `CLASS_ANNOTATION` / `ICON_ANNOTATION` /
 * `DESC_ANNOTATION`. Sticky, because this is only ever asked whether an
 * annotation begins exactly where the last name ended.
 *
 * {@link TREEVIEW_NAME_RE} stops *before* these but cannot consume them: its
 * lookaheads only prevent a name from starting on one, and the scan would
 * otherwise step a character into `##desc` and read `#desc` as the next node.
 * A description runs to the end of the line, so at most one of each can follow
 * and the loop that applies this terminates on the line's end regardless.
 */
const TREEVIEW_ANNOTATION_RE =
  /[ \t]+(?:icon\([\w-]*(?::[\w-]+)?\)|##[^\r\n]*|:::[ \t]*[A-Za-z_][\w-]*)/y;

/**
 * Any character mermaid reads as box drawing, and the subsets it treats
 * specially. A `BRANCH` opens a node line, the `DASH`es after it are the
 * connector, and a line of nothing but `DECORATION` is a spacer carrying the
 * vertical rules of the branches above it.
 */
const TREEVIEW_BOX_CHAR_RE = /[─━│┃└┗├┣]/;
const TREEVIEW_BOX_BRANCH_RE = /[└┗├┣]/;
const TREEVIEW_BOX_DASH_RE = /[─━]/;
const TREEVIEW_BOX_DECORATION_RE = /^[\s│┃]+$/;

/**
 * A metadata line as mermaid's *box-drawing preprocessor* recognizes it. This
 * is deliberately not {@link TREEVIEW_META_RE}: that one models the grammar's
 * terminals, which is what decides whether a line declares a node, while this
 * one models the preprocessor's own coarser test, which only decides whether a
 * line is exempt from the box-drawing rewrite. They disagree on `title"p"` —
 * grammar: an empty title plus a node; preprocessor: an ordinary line — and
 * following each where it applies is what keeps the scan matching mermaid.
 */
const TREEVIEW_BOX_METADATA_RE =
  /^\s*(?:title[\t ]|accTitle[\t ]*:|accDescr[\t ]*[:{])/;

/** The indent mermaid's preprocessor emits per box-drawing level. */
const TREEVIEW_BOX_INDENT_UNIT = '    ';

/** A body line paired with the 1-indexed body line it came from. */
interface TreeViewLine {
  text: string;
  line: number;
}

/**
 * Rewrite a box-drawing body into the indented body mermaid's parser actually
 * receives, mirroring `preprocessBoxDrawing` (mermaid 11.16.1).
 *
 * The file-tree syntax added in 11.16.0 lets a body draw its hierarchy with
 * `├── ` / `└── ` prefixes instead of indentation. Mermaid does not teach that
 * to the grammar; it rewrites each prefixed line into an equivalently indented
 * one and parses *that*, so the scan gets the same tree for free by doing the
 * same rewrite. Depth comes from the column of the branch character divided by
 * the segment width the body established with its first indented branch, which
 * is why a body may use any consistent connector width.
 *
 * One divergence, deliberate: where mermaid throws — an indented line with no
 * branch prefix, or a prefix with no name after it — this passes the line
 * through instead. Such a body is a syntax error and renders nothing, but
 * `checkSemantics` runs ahead of any parse and these rules are advisory, so the
 * useful behaviour is to keep scanning and let the syntax error be the thing
 * the author is told about, rather than to lose every node on the line and
 * report a tree that "has no nodes" on top of it.
 */
function expandTreeViewBoxDrawing(body: TreeViewLine[]): TreeViewLine[] {
  const isExempt = ({ text }: TreeViewLine): boolean => {
    const trimmed = text.trim();
    return (
      trimmed === '' ||
      trimmed.startsWith('%%') ||
      TREEVIEW_BOX_METADATA_RE.test(text)
    );
  };

  // Tabs stand in for four columns, so a body that indents with them measures
  // the same as one that indents with spaces.
  const content = body
    .filter((l) => !isExempt(l) && !TREEVIEW_BOX_DECORATION_RE.test(l.text))
    .map((l) => l.text.replace(/\t/g, TREEVIEW_BOX_INDENT_UNIT));
  if (!content.some((text) => TREEVIEW_BOX_CHAR_RE.test(text))) return body;

  // The first branch that is not at column zero sets the width of one level;
  // a body whose branches all sit at the left margin is flat, so the default
  // never divides anything but zero.
  let segmentWidth = 4;
  for (const text of content) {
    const branch = TREEVIEW_BOX_BRANCH_RE.exec(text);
    if (branch !== null && branch.index > 0) {
      segmentWidth = branch.index;
      break;
    }
  }

  const expanded: TreeViewLine[] = [];
  for (const line of body) {
    if (isExempt(line)) {
      expanded.push(line);
      continue;
    }
    const normalized = line.text.replace(/\t/g, TREEVIEW_BOX_INDENT_UNIT);
    // A spacer line carries only the vertical rules of the branches above it.
    if (TREEVIEW_BOX_DECORATION_RE.test(normalized)) continue;

    const branch = TREEVIEW_BOX_BRANCH_RE.exec(normalized);
    if (branch === null) {
      // A rule drawn with no branch on it — `───` — is decoration too.
      if (/^[\s─━│┃└┗├┣]+$/.test(normalized)) continue;
      expanded.push(line);
      continue;
    }

    let pos = branch.index + 1;
    while (
      pos < normalized.length &&
      TREEVIEW_BOX_DASH_RE.test(normalized[pos])
    )
      pos++;
    while (pos < normalized.length && normalized[pos] === ' ') pos++;
    const name = normalized.slice(pos).trimEnd();
    if (name === '') continue;

    const depth = Math.round(branch.index / segmentWidth) + 1;
    expanded.push({
      text: TREEVIEW_BOX_INDENT_UNIT.repeat(depth) + name,
      line: line.line,
    });
  }
  return expanded;
}

/**
 * The name mermaid stores for a node, given the text between its delimiters.
 *
 * Two normalizations, both from `populate`. A trailing `/` marks the node a
 * directory and is not part of its name, so `src/` and `src` are one label —
 * which `treeview-duplicate-sibling` has to see, since mermaid draws them as
 * the same branch twice. Trailing whitespace is dropped from a bare name only:
 * `BARE_NAME` stops *before* an annotation and so carries the space that
 * separated them, but a quoted name is exact and `"root "` keeps its space.
 */
function treeViewNodeName(raw: string, quoted: boolean): string {
  const name = quoted ? raw : raw.trimEnd();
  return name.endsWith('/') ? name.slice(0, -1) : name;
}

interface TreeViewNode {
  /** Label text, quotes stripped. */
  text: string;
  /** 1-indexed body line. */
  line: number;
  /** Index of the parent in the node list, or `null` for a top-level node. */
  parent: number | null;
}

function isTreeView(block: Block): boolean {
  return block.type === 'treeView-beta';
}

/**
 * Scan a treeView-beta body into a flat node list with parent links.
 *
 * Hierarchy is a plain stack over an indent measured in characters: mermaid's
 * `addNode` pops while `level <= top.level`, so a strictly-deeper indent is a
 * child and anything else re-parents up the stack. The *size* of the step never
 * survives — indenting a child by twelve spaces builds the same tree as
 * indenting it by one — which is why there is no `treeview-indent-jump` rule.
 * A tab counts as one character, not four, so `\t` is *shallower* than four
 * spaces; only the box-drawing rewrite widens tabs, because only mermaid's
 * preprocessor does.
 *
 * Indent is per *node*, not per line. Mermaid's `INDENTATION` terminal matches
 * the whitespace immediately before a name wherever it sits, so a second name
 * on the same line takes the single space between them as its indent and lands
 * as a shallow sibling rather than beside its line-mate. Rare, but it is what
 * mermaid does, so the scan walks names rather than lines. It only arises after
 * a *quoted* name, since a bare one runs to the end of its line.
 *
 * For the same reason the scan is offset-based rather than line-based: two
 * constructs end mid-line and leave the remainder lexing normally, so each one
 * yields a `scanFrom` to resume at instead of skipping the whole line. An
 * `accDescr { … }` block's closing `}` is one (`accDescr { d } "p"` declares
 * `p`), and `title` with no space after it is the other. The header keyword was
 * a third until mermaid 11.16.0, which stopped admitting a name after it:
 * `treeView-beta "root"` is now a parse error, so the scan starts below.
 */
function parseTreeViewNodes(
  lines: string[],
  headerLine: number,
): TreeViewNode[] {
  const body = expandTreeViewBoxDrawing(
    lines.slice(headerLine).map((text, i) => ({
      text,
      line: headerLine + i + 1,
    })),
  );
  // `scanAccDescr` looks ahead for the brace of a bare `accDescr`, so it needs
  // the body as the flat array of text its index walks.
  const texts = body.map((l) => l.text);

  const nodes: TreeViewNode[] = [];
  const stack: { indent: number; index: number }[] = [];
  const accDescr: AccDescrState = { open: false };

  for (const [i, { text, line }] of body.entries()) {
    const trimmed = text.trim();
    if (trimmed === '' || trimmed.startsWith('%%')) continue;

    // Where the rest of this line starts lexing as nodes. Zero for an ordinary
    // node line; past a closing `}` or a bare `title` for the mid-line cases.
    const verdict = scanTreeViewMeta(accDescr, texts, i);
    if (verdict === CONSUME_LINE) continue;

    TREEVIEW_NAME_RE.lastIndex = verdict ?? 0;
    let match = TREEVIEW_NAME_RE.exec(text);
    while (match !== null) {
      const indent = precedingIndent(text, match.index);
      while (stack.length > 0 && stack[stack.length - 1].indent >= indent) {
        stack.pop();
      }
      const bare = match[3];
      nodes.push({
        text: treeViewNodeName(
          bare ?? match[1] ?? match[2],
          bare === undefined,
        ),
        line,
        parent: stack.length > 0 ? stack[stack.length - 1].index : null,
      });
      stack.push({ indent, index: nodes.length - 1 });

      // Step over whatever annotations trail this name, so the next name the
      // scan finds is a node rather than the tail of one of them.
      TREEVIEW_ANNOTATION_RE.lastIndex = TREEVIEW_NAME_RE.lastIndex;
      while (TREEVIEW_ANNOTATION_RE.exec(text) !== null) {
        TREEVIEW_NAME_RE.lastIndex = TREEVIEW_ANNOTATION_RE.lastIndex;
      }

      match = TREEVIEW_NAME_RE.exec(text);
    }
  }

  return nodes;
}

export const treeviewNoNodes: Rule = {
  id: 'treeview-no-nodes',
  appliesTo: isTreeView,
  evaluate: ({ lines, headerLine }) => {
    if (parseTreeViewNodes(lines, headerLine).length > 0) return [];
    return [
      {
        message:
          'treeView-beta has no nodes; it parses but renders as an empty tree.',
        line: headerLine,
      },
    ];
  },
};

export const treeviewDuplicateSibling: Rule = {
  id: 'treeview-duplicate-sibling',
  appliesTo: isTreeView,
  evaluate: ({ lines, headerLine, fileLine }) => {
    const findings: RuleFinding[] = [];
    const nodes = parseTreeViewNodes(lines, headerLine);
    // key: `${parent index}\0${text}` -> index of the first node seen
    const seen = new Map<string, number>();
    for (const [index, node] of nodes.entries()) {
      const key = `${node.parent ?? 'root'}\0${node.text}`;
      const first = seen.get(key);
      if (first === undefined) {
        seen.set(key, index);
      } else {
        findings.push({
          message: `treeView node \`${node.text}\` duplicates a sibling (first on line ${fileLine(nodes[first].line)}); both branches render under the same parent, so the tree draws a distinction it does not have.`,
          line: node.line,
        });
      }
    }
    return findings;
  },
};
