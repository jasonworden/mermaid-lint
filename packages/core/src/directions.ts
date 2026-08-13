/**
 * Direction tokens mermaid's flowchart grammar accepts, case-sensitively.
 *
 * merman accepts *any* token in the direction slot — `ZZZZ`, `TB2`, and the
 * lowercase spellings all pass — while mermaid rejects each with a lexer error.
 * Same failure shape as {@link MERMAN_UNTRUSTED_TYPES}, but it can't be handled
 * the same way: denylisting `flowchart` and `graph` would put the two most
 * common diagram types on the slow path, which is most of the fast path's
 * value. So the header is checked instead, and only a bad direction defects.
 *
 * Deliberately *not* `semantic.ts`'s `DIRECTION_RE`, which omits `v ^ < >`.
 * That regex answers a style question — did the author state a conventional
 * direction — and this set answers a grammar one. Merging them would either
 * push valid `flowchart v` onto the slow path or let `require-direction` start
 * accepting arrows as directions.
 */
export const FLOWCHART_DIRECTIONS: ReadonlySet<string> = new Set([
  'TB',
  'TD',
  'BT',
  'RL',
  'LR',
  'v',
  '^',
  '<',
  '>',
]);
