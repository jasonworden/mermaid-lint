import type { Block } from '../../extract.js';
import { indentWidth } from '../helpers.js';
import type { Rule, RuleFinding } from '../types.js';

/**
 * A kanban node's id: the run of text before the first shape opener, `@` shape
 * -data marker, or brace. This is mermaid's own `NODE_ID` charset
 * (`[^\(\[\n\)\{\}@]+`) spelled as its complement, so `t1[Card]`, `t1(Card)`,
 * `t1))Card((` and `t1@{ … }` all yield `t1` — and `]` really is legal inside
 * an id, since mermaid's charset does not exclude it.
 */
const KANBAN_NODE_ID_RE = /^[^([){}@]+/;

/**
 * Characters a kanban node's shape wrapper may open with (mermaid's
 * `NODE_DSTART`) and close with (`NODE_DEND`). The two sets are deliberately
 * not mirror images: `[` only ever opens and `]` only ever closes, while the
 * cloud and bang shapes invert the parentheses (`)Card(`, `))Card((`). They are
 * scanned as runs rather than matched as pairs, because mermaid's own
 * `NODE_DESCR` is a complement charset that accepts mismatched delimiters.
 */
const KANBAN_WRAP_OPEN = '([){}';
const KANBAN_WRAP_CLOSE = '()]{}';

interface KanbanNode {
  /** Node id, as mermaid derives it. */
  id: string;
  /** 1-indexed body line. */
  line: number;
}

interface KanbanColumn extends KanbanNode {
  cards: KanbanNode[];
}

/** Which kind of node a declaration is — the two share one id namespace. */
type KanbanNodeKind = 'column' | 'card';

interface KanbanDeclaration extends KanbanNode {
  kind: KanbanNodeKind;
}

function isKanban(block: Block): boolean {
  return block.type === 'kanban';
}

/**
 * Derive the id mermaid will give a kanban node, or `null` when the line
 * declares no node. A node carries an explicit id (`t1[Card]`) or is written
 * bare, in which case mermaid uses the text itself — the whole line for a plain
 * node, the label for a wrapped one (`[Card]` is the node `Card`).
 *
 * The id is deliberately not trimmed or comment-stripped: mermaid's `NODE_ID`
 * swallows both, so `t1 [Card]` really is the node `t1 ` and a bare
 * `Card %% note` really is the node `Card %% note`. Normalizing either here
 * would report a collision mermaid does not have.
 */
function kanbanNodeId(trimmed: string): string | null {
  const id = KANBAN_NODE_ID_RE.exec(trimmed)?.[0];
  return id ?? kanbanWrappedLabel(trimmed);
}

/**
 * The label of a node written without an id — `[Card]`, `((Card))`,
 * `))Card((`, optionally trailed by `@{ … }` shape data — which mermaid then
 * uses as that node's id. `null` when the line opens no wrapper or never closes
 * one, meaning it declares no node.
 *
 * Deliberately a pointer scan rather than the obvious
 * `/^[([){}]+(.*?)[()\]{}]+…$/`. That regex puts three quantifiers over
 * overlapping character sets in a row, which backtracks *cubically* whenever
 * the match fails — and failing is the common case here, since this is reached
 * for every line starting with one of those characters. A line of 4 000 `(`
 * took 25s in the regex; the scan below is O(n) because each pointer only ever
 * moves one way. Diagram bodies come from user documents and `checkSemantics`
 * runs ahead of any parse, so a body that never parses still reaches this.
 */
function kanbanWrappedLabel(trimmed: string): string | null {
  let start = 0;
  while (start < trimmed.length && KANBAN_WRAP_OPEN.includes(trimmed[start])) {
    start++;
  }
  if (start === 0) return null;

  let end = trimmed.length;
  // An `@{ … }` tail sits outside the wrapper, so it only counts as one when
  // the wrapper closes just before it — `@{` inside a label is ordinary text
  // to mermaid, whose `NODE_DESCR` admits both characters.
  const tail = trimmed.lastIndexOf('@{');
  if (tail > start) {
    let beforeTail = tail;
    while (beforeTail > start && /\s/.test(trimmed[beforeTail - 1])) {
      beforeTail--;
    }
    if (KANBAN_WRAP_CLOSE.includes(trimmed[beforeTail - 1])) end = beforeTail;
  }

  const closeEnd = end;
  while (end > start && KANBAN_WRAP_CLOSE.includes(trimmed[end - 1])) end--;
  if (end === closeEnd || end === start) return null;
  return trimmed.slice(start, end);
}

/**
 * Walk a kanban body for its columns and their cards. Hierarchy is
 * indentation-based but only one level deep: the first node's indentation fixes
 * the column level, every node at that indentation opens a new column, and
 * every more-indented node is a card of the column above it — regardless of how
 * much deeper it sits, since mermaid's `getSection` only compares against the
 * column level rather than tracking a stack. A node *less* indented than the
 * column level makes mermaid throw ("Items without section detected"), so the
 * syntax pass reports it and no such body reaches here; it is read as a column
 * so the parse still terminates.
 *
 * Skipped: everything up to and including the `kanban` header (which
 * `headerLine` locates, so a frontmatter block cannot be mistaken for a node),
 * blank lines, `%%` comment lines, `::icon(…)` decorators, and the interior of
 * a multi-line `@{ … }` shape-data block.
 */
function parseKanban(lines: string[], headerLine: number): KanbanColumn[] {
  const columns: KanbanColumn[] = [];
  let columnIndent: number | null = null;
  let inShapeData = false;

  for (let i = headerLine; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (inShapeData) {
      if (trimmed.includes('}')) inShapeData = false;
      continue;
    }
    if (trimmed.length === 0 || trimmed.startsWith('%%')) continue;
    if (trimmed.startsWith('::')) continue; // `::icon(...)` decorator
    // An `@{` with no `}` after it opens a shape-data block that runs on until
    // one closes it; those interior lines declare nothing.
    const shapeData = trimmed.indexOf('@{');
    if (shapeData !== -1 && !trimmed.includes('}', shapeData)) {
      inShapeData = true;
    }

    const id = kanbanNodeId(trimmed);
    if (id === null) continue;

    const indent = indentWidth(lines[i]);
    // The first node's own indentation becomes the column level, so that node
    // always takes the `else` branch and there is always a column to push onto.
    columnIndent ??= indent;
    if (indent > columnIndent) {
      columns[columns.length - 1].cards.push({ id, line: i + 1 });
    } else {
      columns.push({ id, line: i + 1, cards: [] });
    }
  }
  return columns;
}

/**
 * Flatten {@link parseKanban} into the one ordered stream of id declarations
 * mermaid itself works from: each column, then its cards. Columns and cards
 * register through the same `addNode` and surface the same way as DOM ids, so
 * collisions are decided over this single stream rather than per node kind.
 */
function kanbanDeclarations(
  lines: string[],
  headerLine: number,
): KanbanDeclaration[] {
  const declarations: KanbanDeclaration[] = [];
  for (const column of parseKanban(lines, headerLine)) {
    declarations.push({ id: column.id, line: column.line, kind: 'column' });
    for (const card of column.cards) {
      declarations.push({ id: card.id, line: card.line, kind: 'card' });
    }
  }
  return declarations;
}

/**
 * Report every `kind` declaration whose id an earlier declaration already
 * holds, naming that holder. Both duplicate rules are this same walk over the
 * one namespace, differing only in which kind of declaration they answer for —
 * so each of the four collision directions lands with exactly one rule and the
 * two need no knowledge of each other. A colliding declaration does not become
 * a holder, which is what makes every repeat cite the first.
 */
function kanbanCollisions(
  lines: string[],
  headerLine: number,
  kind: KanbanNodeKind,
  message: (node: KanbanDeclaration, holder: KanbanDeclaration) => string,
): RuleFinding[] {
  const findings: RuleFinding[] = [];
  const holders = new Map<string, KanbanDeclaration>();
  for (const node of kanbanDeclarations(lines, headerLine)) {
    const holder = holders.get(node.id);
    if (holder === undefined) {
      holders.set(node.id, node);
    } else if (node.kind === kind) {
      findings.push({ message: message(node, holder), line: node.line });
    }
  }
  return findings;
}

/**
 * The consequence every kanban id collision has *except* column-on-column:
 * both nodes render — nothing in a kanban references a node id, so no relation
 * is lost — but the renderer derives each node's DOM id from it
 * (`<svg-id>-<node-id>`), leaving two elements in the document under one id.
 */
function kanbanCollidingIdsClause(
  holder: KanbanDeclaration,
  fileLine: (bodyLine: number) => number,
): string {
  const noun = holder.kind === 'column' ? 'a column' : 'a card';
  return `is already used by ${noun} on line ${fileLine(holder.line)}; both nodes render, but Mermaid emits each node's id as a DOM id, so the document carries that id twice and \`getElementById\`, an \`#id\` selector, a fragment link, or a click handler reaches only one of them.`;
}

export const kanbanDuplicateColumn: Rule = {
  id: 'kanban-duplicate-column',
  appliesTo: isKanban,
  evaluate: ({ lines, headerLine, fileLine }) =>
    kanbanCollisions(lines, headerLine, 'column', (column, holder) =>
      // Two *columns* is the severe case and gets its own sentence: `getData`
      // hands each of them every card whose `parentId` matches, and the
      // renderer re-filters that already-duplicated list per column. Against an
      // earlier card there is no fan-out, only the shared id collision.
      holder.kind === 'column'
        ? `kanban column id \`${column.id}\` is already declared on line ${fileLine(holder.line)}; Mermaid hands every card declared under either column to both of them, so each card renders several times over, in a column its author did not put it in.`
        : `kanban column id \`${column.id}\` ${kanbanCollidingIdsClause(holder, fileLine)}`,
    ),
};

export const kanbanDuplicateTaskId: Rule = {
  id: 'kanban-duplicate-task-id',
  appliesTo: isKanban,
  evaluate: ({ lines, headerLine, fileLine }) =>
    kanbanCollisions(
      lines,
      headerLine,
      'card',
      (card, holder) =>
        `kanban task id \`${card.id}\` ${kanbanCollidingIdsClause(holder, fileLine)}`,
    ),
};

export const kanbanEmptyColumn: Rule = {
  id: 'kanban-empty-column',
  appliesTo: isKanban,
  evaluate: ({ lines, headerLine }) =>
    parseKanban(lines, headerLine)
      .filter((column) => column.cards.length === 0)
      .map((column) => ({
        message: `kanban column \`${column.id}\` has no cards; it renders as a header over an empty column.`,
        line: column.line,
      })),
};

export const kanbanNoColumns: Rule = {
  id: 'kanban-no-columns',
  appliesTo: isKanban,
  evaluate: ({ lines, headerLine }) => {
    if (parseKanban(lines, headerLine).length > 0) return [];
    return [
      {
        message:
          'kanban has no columns; it parses but renders as an empty diagram.',
        line: headerLine,
      },
    ];
  },
};
