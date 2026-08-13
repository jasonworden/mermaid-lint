import { describe, expect, it } from 'vitest';
import { parseRawError } from '../../src/explain/parse-raw.js';
import { EXPLAIN_RULES } from '../../src/explain/rules.js';
import { locateHeader } from '../../src/header.js';
import { detectDiagramType } from '../../src/type-detect.js';
import { validateWithMermaidJS } from '../../src/validate.js';

function toInput(raw: string, body: string, line?: number) {
  return {
    parsed: parseRawError(raw),
    raw,
    body,
    line,
    type: detectDiagramType(body),
  };
}

/** Run the table the way `explainParseError` will: first match that confirms. */
function explain(raw: string, body: string, line?: number) {
  const input = toInput(raw, body, line);
  const sourceLine =
    line === undefined ? '' : (body.split('\n')[line - 1] ?? '');
  for (const rule of EXPLAIN_RULES) {
    if (!rule.matches(input)) continue;
    const out = rule.confirm(sourceLine, input);
    if (out) return { id: rule.id, ...out };
  }
  return undefined;
}

/**
 * Assert a near-miss really is one: the rule's token signature *does* fire, so
 * the only thing standing between the user and a wrong message is `confirm`.
 * Without this a "near-miss" test can pass because `matches` already excluded
 * the case, proving nothing about the confirm gate.
 */
function expectSignatureFires(
  id: string,
  raw: string,
  body: string,
  line?: number,
) {
  const rule = EXPLAIN_RULES.find((candidate) => candidate.id === id);
  expect(rule, `no rule with id ${id}`).toBeDefined();
  expect(rule?.matches(toInput(raw, body, line))).toBe(true);
}

// Every raw below is verbatim from a probe against the bundled mermaid, except
// where a comment says otherwise. Keeping them literal is what makes the
// near-misses meaningful: a rule must decline on a signature it really sees.

const SEQ_COLON_RAW =
  "Parse error on line 2:\n...ce->>Bob hello there\n-----------------------^\nExpecting 'TXT', got 'NEWLINE'";

const NOTE_COLON_RAW =
  "Parse error on line 3:\n...  Note over A hello\n----------------------^\nExpecting ',', 'TXT', got 'NEWLINE'";

const LINK_EXPECTED =
  "'SEMI', 'NEWLINE', 'EOF', 'AMP', 'START_LINK', 'LINK', 'LINK_ID'";

const SINGLE_DASH_RAW = `Parse error on line 2:\nflowchart LR  A -> B\n----------------^\nExpecting ${LINK_EXPECTED}, got 'MINUS'`;

const NODE_STRING_RAW = `Parse error on line 2:\nflowchart LR  My Node --> B\n-----------------^\nExpecting ${LINK_EXPECTED}, got 'NODE_STRING'`;

const SHAPE_CLOSERS =
  "'SQE', 'DOUBLECIRCLEEND', 'PE', '-)', 'STADIUMEND', 'SUBROUTINEEND', 'PIPE', 'CYLINDEREND', 'DIAMOND_STOP', 'TAGEND', 'TRAPEND', 'INVTRAPEND', 'UNICODE_TEXT', 'TEXT', 'TAGSTART'";

const UNCLOSED_RAW = `Parse error on line 2:\n... LR  A[Start --> B\n---------------------^\nExpecting ${SHAPE_CLOSERS}, got '1'`;

const PAREN_RAW = `Parse error on line 2:\n...hart LR  A[call foo(bar)] --> B\n----------------------^\nExpecting ${SHAPE_CLOSERS}, got 'PS'`;

const MISMATCHED_RAW =
  "Parse error on line 2:\n...owchart LR  A[Start) --> B\n----------------------^\nExpecting 'SQE', 'TAGEND', 'UNICODE_TEXT', 'TEXT', 'TAGSTART', got 'PE'";

const RESERVED_END_RAW =
  "Parse error on line 2:\n...lowchart LR  A --> end\n----------------------^\nExpecting 'AMP', 'COLON', 'PIPE', 'TESTSTR', 'DOWN', 'DEFAULT', 'NUM', 'COMMA', 'NODE_STRING', 'BRKT', 'MINUS', 'MULT', 'UNICODE_TEXT', got 'end'";

const STRAY_END_RAW =
  "Parse error on line 3:\n...hart LR  A --> B  end\n---------------------^\nExpecting 'SEMI', 'NEWLINE', 'SPACE', 'EOF', 'subgraph', 'acc_title', 'acc_descr', 'acc_descr_multiline_value', 'AMP', 'COLON', 'STYLE', 'LINKSTYLE', 'CLASSDEF', 'CLASS', 'CLICK', 'DOWN', 'DEFAULT', 'NUM', 'COMMA', 'NODE_STRING', 'BRKT', 'MINUS', 'MULT', 'UNICODE_TEXT', 'direction_tb', 'direction_bt', 'direction_rl', 'direction_lr', 'direction_td', got 'end'";

const FLOW_BLOCK_EXPECTED =
  "'SEMI', 'NEWLINE', 'SPACE', 'EOF', 'subgraph', 'end', 'acc_title', 'acc_descr', 'acc_descr_multiline_value', 'AMP', 'COLON', 'STYLE', 'LINKSTYLE', 'CLASSDEF', 'CLASS', 'CLICK', 'DOWN', 'DEFAULT', 'NUM', 'COMMA', 'NODE_STRING', 'BRKT', 'MINUS', 'MULT', 'UNICODE_TEXT', 'direction_tb', 'direction_bt', 'direction_rl', 'direction_lr', 'direction_td'";

const SUBGRAPH_RAW = `Parse error on line 3:\n...aph one    A --> B\n---------------------^\nExpecting ${FLOW_BLOCK_EXPECTED}, got '1'`;

const CLOSED_BLOCK_RAW = `Parse error on line 5:\n...    A --> B  end  ?!@#$\n---------------------^\nExpecting ${FLOW_BLOCK_EXPECTED}, got 'LINK_ID'`;

const LABEL_BLOCK_RAW = `Parse error on line 3:\n...graph one"] --> B  ?!@#$\n----------------------^\nExpecting ${FLOW_BLOCK_EXPECTED}, got 'LINK_ID'`;

const SEQ_LOOP_RAW =
  "Parse error on line 3:\n...->>Bob: hi  loop x\n---------------------^\nExpecting 'SPACE', 'NEWLINE', 'INVALID', 'create', 'box', 'end', 'autonumber', 'activate', 'deactivate', 'title', 'legacy_title', 'acc_title', 'acc_descr', 'acc_descr_multiline_value', 'loop', 'rect', 'opt', 'alt', 'par', 'par_over', 'critical', 'break', 'participant', 'participant_actor', 'destroy', 'note', 'links', 'link', 'properties', 'details', 'ACTOR', got '1'";

describe('sequence-missing-colon', () => {
  it('fires and rebuilds the corrected line', () => {
    const got = explain(
      SEQ_COLON_RAW,
      'sequenceDiagram\n  Alice->>Bob hello there',
      2,
    );
    expect(got?.id).toBe('sequence-missing-colon');
    expect(got?.message).toBe('sequence message is missing a colon');
    expect(got?.suggestion).toBe('  Alice->>Bob: hello there');
    expect(got?.fixable).toBe(true);
  });

  it('declines when the line already has a colon (near-miss)', () => {
    const body = 'sequenceDiagram\n  Alice->>Bob: hi';
    expectSignatureFires('sequence-missing-colon', SEQ_COLON_RAW, body, 2);
    const got = explain(SEQ_COLON_RAW, body, 2);
    expect(got?.id).not.toBe('sequence-missing-colon');
  });

  it('yields to the Note rule on the same signature', () => {
    const got = explain(
      SEQ_COLON_RAW,
      'sequenceDiagram\n  Note over A hello',
      2,
    );
    expect(got?.id).toBe('sequence-note-missing-colon');
  });
});

describe('unknown-diagram-type', () => {
  it('names the likely intent', () => {
    const raw =
      'No diagram type detected matching given configuration for text: flowchat LR\n  A --> B';
    const got = explain(raw, 'flowchat LR\n  A --> B', undefined);
    expect(got?.id).toBe('unknown-diagram-type');
    expect(got?.message).toContain('flowchat');
    expect(got?.message).toContain('flowchart');
    expect(got?.suggestion).toBe('flowchart LR');
  });

  it('declines to guess when nothing is close (near-miss)', () => {
    const raw =
      'No diagram type detected matching given configuration for text: xyzchart_nonexistent LR';
    const got = explain(raw, 'xyzchart_nonexistent LR\n  A --> B', undefined);
    expect(got?.id).toBe('unknown-diagram-type');
    expect(got?.suggestion).toBeUndefined();
  });

  // mermaid also emits this message when the keyword *is* real but the diagram
  // type is not registered in the running config. Calling a spelled-correctly
  // `flowchart` an "unknown diagram type" would be a lie, so the rule declines.
  it('declines when the header keyword is a known type (near-miss)', () => {
    const raw =
      'No diagram type detected matching given configuration for text: flowchart LR\n  A --> B';
    const body = 'flowchart LR\n  A --> B';
    expectSignatureFires('unknown-diagram-type', raw, body, undefined);
    expect(explain(raw, body, undefined)).toBeUndefined();
  });
});

describe('flowchart-bad-direction', () => {
  const zzzz =
    'Lexical error on line 1. Unrecognized text.\nflowchart ZZZZ  A --> B\n---------^';

  it('names the rejected direction', () => {
    const got = explain(zzzz, 'flowchart ZZZZ\n  A --> B', 1);
    expect(got?.id).toBe('flowchart-bad-direction');
    expect(got?.message).toContain('ZZZZ');
    expect(got?.message).toContain('not a valid flowchart direction');
    // Nothing in TB/TD/BT/RL/LR is close enough to `ZZZZ` to name.
    expect(got?.suggestion).toBeUndefined();
  });

  it('corrects a lowercase direction', () => {
    const raw =
      'Lexical error on line 1. Unrecognized text.\nflowchart lr  A --> B\n---------^';
    const got = explain(raw, 'flowchart lr\n  A --> B', 1);
    expect(got?.id).toBe('flowchart-bad-direction');
    expect(got?.message).toContain('`LR`');
    expect(got?.suggestion).toBe('flowchart LR');
  });

  // Same family, same diagram type, but the direction is fine — the lexer
  // choked on the stray `)` two lines down.
  it('declines when the direction is valid (near-miss)', () => {
    const raw =
      'Lexical error on line 2. Unrecognized text.\n... LR  A[Start] --> B)\n----------------------^';
    const body = 'flowchart LR\n  A[Start] --> B)';
    expectSignatureFires('flowchart-bad-direction', raw, body, 2);
    expect(explain(raw, body, 2)).toBeUndefined();
  });

  it('declines when the header has no direction word (near-miss)', () => {
    const raw =
      'Lexical error on line 2. Unrecognized text.\n...art  A[Start] --> B)\n----------------------^';
    const body = 'flowchart\n  A[Start] --> B)';
    expectSignatureFires('flowchart-bad-direction', raw, body, 2);
    expect(explain(raw, body, 2)).toBeUndefined();
  });
});

describe('flowchart-single-dash-arrow', () => {
  it('fires and doubles the dash', () => {
    const got = explain(SINGLE_DASH_RAW, 'flowchart LR\n  A -> B', 2);
    expect(got?.id).toBe('flowchart-single-dash-arrow');
    expect(got?.message).toContain('two dashes');
    expect(got?.suggestion).toBe('  A --> B');
    expect(got?.fixable).toBe(true);
  });

  // mermaid only emits `got 'MINUS'` for an unquoted one-dash arrow, so this
  // pairs the real signature with a line whose only `->` is inside a label.
  // Rewriting there would corrupt the user's text, so confirm declines.
  it('declines when the only one-dash arrow is quoted (near-miss)', () => {
    const body = 'flowchart LR\n  A["a -> b"] --> B';
    expectSignatureFires(
      'flowchart-single-dash-arrow',
      SINGLE_DASH_RAW,
      body,
      2,
    );
    expect(explain(SINGLE_DASH_RAW, body, 2)).toBeUndefined();
  });
});

describe('sequence-note-missing-colon', () => {
  it('fires and inserts the colon after the actor', () => {
    const got = explain(
      NOTE_COLON_RAW,
      'sequenceDiagram\n  A->>B: x\n  Note over A hello',
      3,
    );
    expect(got?.id).toBe('sequence-note-missing-colon');
    expect(got?.message).toBe('`Note` is missing a colon before its text');
    expect(got?.suggestion).toBe('  Note over A: hello');
    expect(got?.fixable).toBeUndefined();
  });

  // Identical signature; the participant merely starts with the letters `Note`.
  // The Note rule must decline so the general message rule can answer.
  it('declines for a participant named Notebook (near-miss)', () => {
    const body = 'sequenceDiagram\n  Notebook->>B hello';
    expectSignatureFires('sequence-note-missing-colon', SEQ_COLON_RAW, body, 2);
    const got = explain(SEQ_COLON_RAW, body, 2);
    expect(got?.id).toBe('sequence-missing-colon');
    expect(got?.suggestion).toBe('  Notebook->>B: hello');
  });

  it('declines when the Note already has its colon (near-miss)', () => {
    const body = 'sequenceDiagram\n  A->>B: x\n  Note over A: hello';
    expectSignatureFires(
      'sequence-note-missing-colon',
      NOTE_COLON_RAW,
      body,
      3,
    );
    expect(explain(NOTE_COLON_RAW, body, 3)).toBeUndefined();
  });
});

describe('flowchart-unclosed-shape', () => {
  it('fires and closes the label before the arrow', () => {
    const got = explain(UNCLOSED_RAW, 'flowchart LR\n  A[Start --> B', 2);
    expect(got?.id).toBe('flowchart-unclosed-shape');
    expect(got?.message).toBe('node label opened with `[` was never closed');
    expect(got?.suggestion).toBe('  A[Start] --> B');
  });

  it('explains but suggests nothing when the label is empty', () => {
    const raw = `Parse error on line 3:\n...A[Start] --> B  C[\n---------------------^\nExpecting ${SHAPE_CLOSERS}, got '1'`;
    const got = explain(raw, 'flowchart LR\n  A[Start] --> B\n  C[', 3);
    expect(got?.id).toBe('flowchart-unclosed-shape');
    expect(got?.suggestion).toBeUndefined();
  });

  // A `]` inside a label is label text, not this `[`'s closer.
  it('does not let a quoted closer close the label', () => {
    const raw = `Parse error on line 2:\n... LR  A["x]y" --> B\n---------------------^\nExpecting ${SHAPE_CLOSERS}, got '1'`;
    const got = explain(raw, 'flowchart LR\n  A["x]y" --> B', 2);
    expect(got?.id).toBe('flowchart-unclosed-shape');
    expect(got?.message).toBe('node label opened with `[` was never closed');
    expect(got?.suggestion).toBe('  A["x]y"] --> B');
  });

  // Two labels, the second genuinely unclosed. Were quoted text not ignored,
  // the scan would pair the `(` inside the first label with that label's real
  // `]`, call the line mismatched, and this rule would decline a defect that
  // is plainly there.
  it('blames the real unclosed bracket, not a quoted paren', () => {
    const raw = `Parse error on line 2:\n...R  A["x(y"] --> B[\n---------------------^\nExpecting ${SHAPE_CLOSERS}, got '1'`;
    const got = explain(raw, 'flowchart LR\n  A["x(y"] --> B[', 2);
    expect(got?.id).toBe('flowchart-unclosed-shape');
    expect(got?.message).toBe('node label opened with `[` was never closed');
  });

  // Same expected set (a superset), but every delimiter on the line is
  // balanced — the real defect is the unquoted paren, so this rule stands down.
  it('declines on a balanced line and yields to the paren rule (near-miss)', () => {
    const body = 'flowchart LR\n  A[call foo(bar)] --> B';
    expectSignatureFires('flowchart-unclosed-shape', PAREN_RAW, body, 2);
    expect(explain(PAREN_RAW, body, 2)?.id).toBe('flowchart-unquoted-paren');
  });

  // `[` and `]` pair up here; what is actually unterminated is the quote.
  // "opened with `[` was never closed" would be wrong, so the rule declines.
  it('declines when only a quote is unterminated (near-miss)', () => {
    const raw = `Parse error on line 2:\n...R  A["Start] --> B\n---------------------^\nExpecting ${SHAPE_CLOSERS}, got '1'`;
    const body = 'flowchart LR\n  A["Start] --> B';
    expectSignatureFires('flowchart-unclosed-shape', raw, body, 2);
    expect(explain(raw, body, 2)).toBeUndefined();
  });
});

describe('flowchart-mismatched-shape', () => {
  it('fires and corrects the closer', () => {
    const got = explain(MISMATCHED_RAW, 'flowchart LR\n  A[Start) --> B', 2);
    expect(got?.id).toBe('flowchart-mismatched-shape');
    expect(got?.message).toBe('node label opened with `[` is closed with `)`');
    expect(got?.suggestion).toBe('  A[Start] --> B');
  });

  it('reads the delimiters off the line, not the token names', () => {
    const raw =
      "Parse error on line 2:\n...owchart LR  A(Start] --> B\n----------------------^\nExpecting 'PE', 'TAGEND', 'UNICODE_TEXT', 'TEXT', 'TAGSTART', got 'SQE'";
    const got = explain(raw, 'flowchart LR\n  A(Start] --> B', 2);
    expect(got?.id).toBe('flowchart-mismatched-shape');
    expect(got?.message).toBe('node label opened with `(` is closed with `]`');
    expect(got?.suggestion).toBe('  A(Start) --> B');
  });

  // `got` is a closer token, but `[` really is closed by `]` — the extra `]` is
  // the surplus. Claiming a mismatch here would name delimiters that agree.
  it('declines when opener and closer agree (near-miss)', () => {
    const raw =
      "Parse error on line 2:\n...owchart LR  A[Start]] --> B\n----------------------^\nExpecting 'SQE', 'TAGEND', 'UNICODE_TEXT', 'TEXT', 'TAGSTART', got 'SUBROUTINEEND'";
    const body = 'flowchart LR\n  A[Start]] --> B';
    expectSignatureFires('flowchart-mismatched-shape', raw, body, 2);
    expectSignatureFires('flowchart-unclosed-shape', raw, body, 2);
    expect(explain(raw, body, 2)).toBeUndefined();
  });
});

describe('flowchart-reserved-end', () => {
  it('fires and capitalizes the id', () => {
    const got = explain(RESERVED_END_RAW, 'flowchart LR\n  A --> end', 2);
    expect(got?.id).toBe('flowchart-reserved-end');
    expect(got?.message).toBe(
      '`end` is a reserved word and cannot be used as a node id',
    );
    expect(got?.suggestion).toBe('  A --> End');
  });

  // Same `got 'end'`, but this `end` closes nothing and is no node id.
  it('declines for a stray block terminator (near-miss)', () => {
    const body = 'flowchart LR\n  A --> B\n  end';
    expectSignatureFires('flowchart-reserved-end', STRAY_END_RAW, body, 3);
    expect(explain(STRAY_END_RAW, body, 3)).toBeUndefined();
  });

  // `end` in the source slot, not the target: capitalizing the trailing word
  // would rename `A`, not the reserved id.
  it('declines when `end` is not the target (near-miss)', () => {
    const raw =
      "Parse error on line 2:\nflowchart LR  end --> A\n--------------^\nExpecting 'SEMI', 'NEWLINE', 'SPACE', 'EOF', 'subgraph', 'acc_title', 'AMP', 'COLON', 'NODE_STRING', 'UNICODE_TEXT', got 'end'";
    const body = 'flowchart LR\n  end --> A';
    expectSignatureFires('flowchart-reserved-end', raw, body, 2);
    expect(explain(raw, body, 2)).toBeUndefined();
  });
});

describe('flowchart-space-in-id', () => {
  it('fires and moves the words into a label', () => {
    const got = explain(NODE_STRING_RAW, 'flowchart LR\n  My Node --> B', 2);
    expect(got?.id).toBe('flowchart-space-in-id');
    expect(got?.message).toContain('`My Node`');
    expect(got?.suggestion).toBe('  MyNode[My Node] --> B');
  });

  // Identical signature. Three words is not the shape the rule knows how to
  // rewrite, and guessing which two belong together would be a coin flip.
  it('declines on three bare words (near-miss)', () => {
    const raw = `Parse error on line 2:\nflowchart LR  My Node Here --> B\n-----------------^\nExpecting ${LINK_EXPECTED}, got 'NODE_STRING'`;
    const body = 'flowchart LR\n  My Node Here --> B';
    expectSignatureFires('flowchart-space-in-id', raw, body, 2);
    expect(explain(raw, body, 2)).toBeUndefined();
  });

  // Identical signature again, but the defect is a malformed arrow. "node id
  // `A -` contains a space" would be nonsense.
  it('declines on a malformed arrow (near-miss)', () => {
    const raw = `Parse error on line 2:\nflowchart LR  A -x B\n----------------^\nExpecting ${LINK_EXPECTED}, got 'NODE_STRING'`;
    const body = 'flowchart LR\n  A -x B';
    expectSignatureFires('flowchart-space-in-id', raw, body, 2);
    expect(explain(raw, body, 2)).toBeUndefined();
  });
});

describe('flowchart-unquoted-paren', () => {
  it('fires and quotes the label', () => {
    const got = explain(PAREN_RAW, 'flowchart LR\n  A[call foo(bar)] --> B', 2);
    expect(got?.id).toBe('flowchart-unquoted-paren');
    expect(got?.message).toBe('`(` inside a label needs quoting');
    expect(got?.suggestion).toBe('  A["call foo(bar)"] --> B');
  });

  // Same `got 'PS'`, same expected set — but the label is a diamond, not a
  // `[...]`, so wrapping square brackets in quotes would rewrite nothing real.
  it('declines when the paren is not inside a `[...]` (near-miss)', () => {
    const raw = `Parse error on line 2:\nflowchart LR  A{is (x)?} --> B\n-------------------^\nExpecting ${SHAPE_CLOSERS}, got 'PS'`;
    const body = 'flowchart LR\n  A{is (x)?} --> B';
    expectSignatureFires('flowchart-unquoted-paren', raw, body, 2);
    expectSignatureFires('flowchart-unclosed-shape', raw, body, 2);
    expect(explain(raw, body, 2)).toBeUndefined();
  });
});

describe('block-missing-end', () => {
  it('names the unclosed flowchart block', () => {
    const got = explain(
      SUBGRAPH_RAW,
      'flowchart LR\n  subgraph one\n    A --> B',
      3,
    );
    expect(got?.id).toBe('block-missing-end');
    expect(got?.message).toBe('`subgraph` block was never closed with `end`');
    expect(got?.suggestion).toBeUndefined();
  });

  it('names the unclosed sequence block', () => {
    const got = explain(
      SEQ_LOOP_RAW,
      'sequenceDiagram\n  Alice->>Bob: hi\n  loop x',
      3,
    );
    expect(got?.id).toBe('block-missing-end');
    expect(got?.message).toBe('`loop` block was never closed with `end`');
  });

  // Same expected set, which always lists `end` as legal here — but every
  // block in the body is closed, so nothing is missing an `end`.
  it('declines when every block is closed (near-miss)', () => {
    const body = 'graph TD\n  subgraph one\n    A --> B\n  end\n  ?!@#$';
    expectSignatureFires('block-missing-end', CLOSED_BLOCK_RAW, body, 5);
    expect(explain(CLOSED_BLOCK_RAW, body, 5)).toBeUndefined();
  });

  // The word `subgraph` appears only inside a node label. Counting it as an
  // opener would invent a block the author never wrote.
  it('declines when the keyword is only inside a label (near-miss)', () => {
    const body = 'flowchart LR\n  A["subgraph one"] --> B\n  ?!@#$';
    expectSignatureFires('block-missing-end', LABEL_BLOCK_RAW, body, 3);
    expect(explain(LABEL_BLOCK_RAW, body, 3)).toBeUndefined();
  });
});

/** One firing example per rule, keyed by id, for the whole-table assertions. */
const EVERY_RULE_FIRING: Record<
  string,
  [raw: string, body: string, line?: number]
> = {
  'unknown-diagram-type': [
    'No diagram type detected matching given configuration for text: flowchat LR\n  A --> B',
    'flowchat LR\n  A --> B',
    undefined,
  ],
  'flowchart-bad-direction': [
    'Lexical error on line 1. Unrecognized text.\nflowchart ZZZZ  A --> B\n---------^',
    'flowchart ZZZZ\n  A --> B',
    1,
  ],
  'sequence-note-missing-colon': [
    NOTE_COLON_RAW,
    'sequenceDiagram\n  A->>B: x\n  Note over A hello',
    3,
  ],
  'sequence-missing-colon': [
    SEQ_COLON_RAW,
    'sequenceDiagram\n  Alice->>Bob hello there',
    2,
  ],
  'flowchart-single-dash-arrow': [SINGLE_DASH_RAW, 'flowchart LR\n  A -> B', 2],
  'flowchart-space-in-id': [
    NODE_STRING_RAW,
    'flowchart LR\n  My Node --> B',
    2,
  ],
  'flowchart-mismatched-shape': [
    MISMATCHED_RAW,
    'flowchart LR\n  A[Start) --> B',
    2,
  ],
  'flowchart-unclosed-shape': [
    UNCLOSED_RAW,
    'flowchart LR\n  A[Start --> B',
    2,
  ],
  'flowchart-unquoted-paren': [
    PAREN_RAW,
    'flowchart LR\n  A[call foo(bar)] --> B',
    2,
  ],
  'flowchart-reserved-end': [RESERVED_END_RAW, 'flowchart LR\n  A --> end', 2],
  'block-missing-end': [
    SUBGRAPH_RAW,
    'flowchart LR\n  subgraph one\n    A --> B',
    3,
  ],
};

describe('the table itself', () => {
  it('has a firing example for every rule and no rule beyond them', () => {
    const ids = EXPLAIN_RULES.map((rule) => rule.id);
    expect(ids).toEqual(Object.keys(EVERY_RULE_FIRING));
    for (const [id, [raw, body, line]] of Object.entries(EVERY_RULE_FIRING)) {
      expect(explain(raw, body, line)?.id, id).toBe(id);
    }
  });

  it('has a unique id per rule', () => {
    const ids = EXPLAIN_RULES.map((rule) => rule.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('orders the narrower rule of each ambiguous pair first', () => {
    const ids = EXPLAIN_RULES.map((rule) => rule.id);
    expect(ids.indexOf('sequence-note-missing-colon')).toBeLessThan(
      ids.indexOf('sequence-missing-colon'),
    );
    expect(ids.indexOf('flowchart-mismatched-shape')).toBeLessThan(
      ids.indexOf('flowchart-unclosed-shape'),
    );
  });

  // `fixBlockBody` performs exactly two rewrites. Any other rule claiming
  // `fixable` would promise the user a `--fix` that does not exist.
  it('marks fixable exactly where `fixBlockBody` has a rewrite', () => {
    const fixable = Object.entries(EVERY_RULE_FIRING)
      .filter(([, [raw, body, line]]) => explain(raw, body, line)?.fixable)
      .map(([id]) => id);
    expect(fixable).toEqual([
      'sequence-missing-colon',
      'flowchart-single-dash-arrow',
    ]);
  });

  it('never names a second line number', () => {
    for (const [id, [raw, body, line]] of Object.entries(EVERY_RULE_FIRING)) {
      expect(explain(raw, body, line)?.message, id).not.toMatch(/\bline\s*\d/i);
    }
  });
});

/**
 * End-to-end: hand the body to the real mermaid, feed its actual error through
 * the table, then hand mermaid the suggested correction and require it to
 * parse.
 *
 * This is the test that makes the suggestions trustworthy. Everything above
 * runs against raw strings captured by hand, which pins the table's *shape*
 * but cannot notice a suggestion that is syntactically plausible and still
 * wrong — that is exactly how a rewrite that cut a quoted label in half
 * (`A["a] -->  b" --> B`) passed a full green suite. Each body's only defect is
 * the one its rule repairs, so "mermaid accepts the result" is a fair bar.
 */
describe('suggestions round-trip through mermaid', () => {
  const BODIES: Record<string, string> = {
    'unknown-diagram-type': 'flowchat LR\n  A --> B',
    'flowchart-bad-direction': 'flowchart lr\n  A --> B',
    'flowchart-bad-direction (semicolon header)': 'flowchart lr;\n  A --> B',
    // Mid-token `;`: the direction is cut at it, and the rest of the statement
    // has to survive into the suggestion untouched.
    'flowchart-bad-direction (inline statement)': 'graph lr;A-->B',
    'sequence-note-missing-colon':
      'sequenceDiagram\n  A->>B: x\n  Note over A hello',
    'sequence-missing-colon': 'sequenceDiagram\n  Alice->>Bob hello there',
    'flowchart-single-dash-arrow': 'flowchart LR\n  A -> B',
    'flowchart-space-in-id': 'flowchart LR\n  My Node --> B',
    'flowchart-mismatched-shape': 'flowchart LR\n  A[Start) --> B',
    'flowchart-mismatched-shape (round opener)':
      'flowchart LR\n  A(Start] --> B',
    // A compound shape: `([` is closed by `])`, so repairing the `}` completes
    // the stadium rather than leaving `(` dangling.
    'flowchart-mismatched-shape (compound shape)':
      'flowchart LR\n  A([foo}) --> B',
    // …and the mistyped half can be the outer one.
    'flowchart-mismatched-shape (compound shape, outer closer)':
      'flowchart LR\n  A([foo]] --> B',
    'flowchart-unclosed-shape': 'flowchart LR\n  A[Start --> B',
    'flowchart-unclosed-shape (arrow inside the label)':
      'flowchart LR\n  A["a -->  b" --> B',
    // `---` and `===` are open links with no arrowhead. (`--` alone is not a
    // link at all — mermaid requires edge text with it — so it is no fixture.)
    'flowchart-unclosed-shape (headless link)': 'flowchart LR\n  A[Start --- B',
    'flowchart-unclosed-shape (thick open link)':
      'flowchart LR\n  A[Start === B',
    // The other half of that: two bare dashes are label text, so the closer
    // belongs at the end of the line rather than before them.
    'flowchart-unclosed-shape (bare dashes in the label)':
      'flowchart LR\n  A[Start--End',
    'flowchart-unclosed-shape (spaced bare dashes)':
      'flowchart LR\n  A[Phase 1 -- Phase 2',
    'flowchart-unclosed-shape (edge text before a link)':
      'flowchart LR\n  A[Start -- x --- B',
    // `[/…/]` is a shape of its own; with the closing slash already written,
    // the `]` is genuinely the only missing character.
    'flowchart-unclosed-shape (asymmetric shape)':
      'flowchart LR\n  A[/foo/ --> B',
    // A compound shape needs quoting like any other, and the label to quote is
    // the text between its two *tokens* — not between the `[` and `]` the
    // pattern happens to lock onto.
    'flowchart-unclosed-shape (compound closer half written)':
      'flowchart LR\n  A[(Database) --> B',
    'flowchart-unquoted-paren': 'flowchart LR\n  A[call foo(bar)] --> B',
    'flowchart-unquoted-paren (stadium)':
      'flowchart LR\n  A([init(config)]) --> B',
    'flowchart-unquoted-paren (subroutine)':
      'flowchart LR\n  A[[init(config)]] --> B',
    'flowchart-unquoted-paren (cylinder)':
      'flowchart LR\n  A[(init(config))] --> B',
    'flowchart-reserved-end': 'flowchart LR\n  A --> end',
  };

  for (const [name, body] of Object.entries(BODIES)) {
    it(`repairs ${name}`, async () => {
      const before = await validateWithMermaidJS(body);
      expect(before.ok, 'fixture should not already parse').toBe(false);
      const error = before.ok ? undefined : before.error;

      const got = explain(error?.raw ?? '', body, error?.line);
      expect(got?.suggestion, `no suggestion for ${name}`).toBeDefined();

      const lines = body.split('\n');
      // Rules keyed on the header carry no line of their own.
      const target = error?.line ?? locateHeader(lines).line;
      lines[target - 1] = got?.suggestion ?? '';
      const after = await validateWithMermaidJS(lines.join('\n'));
      expect(
        after.ok,
        `mermaid rejected: ${JSON.stringify(lines.join('\n'))}`,
      ).toBe(true);
    });
  }

  // The counterpart: when a rule cannot name a repair it must stay silent
  // rather than emit something that parses and misleads.
  it('offers no suggestion when one insertion cannot repair the line', async () => {
    const body = 'flowchart LR\n  A[call foo(bar --> B';
    const before = await validateWithMermaidJS(body);
    const error = before.ok ? undefined : before.error;
    const got = explain(error?.raw ?? '', body, error?.line);
    expect(got?.id).toBe('flowchart-unclosed-shape');
    expect(got?.suggestion).toBeUndefined();
  });

  // The `[` really was never closed, so the message stands — but the label
  // needs quoting too, and `A[init(config)] --> B[done]` is not a line mermaid
  // takes. Closing the shape would only uncover the second defect.
  it.each([
    'flowchart LR\n  A[init(config) --> B[done]',
    'flowchart LR\n  A[a (b) c --> B',
    'flowchart LR\n  A[a {b} c --> B',
    // mermaid quotes a label entirely or not at all, and blanking hides the
    // difference: `A[a"b(c)"d]` comes out delimiter-free and is still rejected.
    'flowchart LR\n  A[a"b(c)"d --> B',
    'flowchart LR\n  A[x "y" z --> B',
  ])(
    'offers no suggestion when the label itself needs quoting %j',
    async (body) => {
      const before = await validateWithMermaidJS(body);
      expect(before.ok, 'fixture should not parse').toBe(false);
      const error = before.ok ? undefined : before.error;
      const got = explain(error?.raw ?? '', body, error?.line);
      expect(got?.id).toBe('flowchart-unclosed-shape');
      expect(got?.suggestion).toBeUndefined();
    },
  );

  // Same for an asymmetric shape (`[/…/]`, `[\…\]`) with no closing slash: the
  // bare `]` this rule inserts spells no shape at all, and mermaid rejected the
  // result. Which slash the author meant cannot be recovered from the line.
  it.each([
    'flowchart LR\n  A[/foo --> B',
    'flowchart LR\n  A[/foo bar --> B',
    'flowchart LR\n  A --> B[/foo',
    'flowchart LR\n  A[\\foo --> B',
    'flowchart LR\n  A[\\foo bar --> B',
    'flowchart LR\n  A --> B[\\foo',
  ])(
    'offers no suggestion for an unfinished asymmetric shape %j',
    async (body) => {
      const before = await validateWithMermaidJS(body);
      expect(before.ok, 'fixture should not parse').toBe(false);
      const error = before.ok ? undefined : before.error;
      const got = explain(error?.raw ?? '', body, error?.line);
      expect(got?.id).toBe('flowchart-unclosed-shape');
      expect(got?.suggestion).toBeUndefined();
    },
  );

  // Same for a mistyped closer that leaves another shape open — whether that
  // shape encloses the mismatch (`A([foo}`, a stadium) or follows it
  // (`A[foo} --> B[bar`, where the scan had not yet reached the second `[`).
  //
  // The `bar` cases are the ones balance alone waves through: the enclosing
  // opener *does* close later on the line, so the rewrite balances, and it
  // still does not parse because a stadium's `])` cannot have text inside it.
  it.each([
    'flowchart LR\n  A([foo} --> B',
    'flowchart LR\n  A[(foo} --> B',
    'flowchart LR\n  A[foo} --> B[bar',
    'flowchart LR\n  A[foo} --> B(bar',
    'flowchart LR\n  A([foo} bar) --> B',
    'flowchart LR\n  A((foo} bar) --> B',
    'flowchart LR\n  A((foo} bar)) --> B',
    'flowchart LR\n  A[[foo} bar] --> B',
    'flowchart LR\n  A --> B([x} y)',
  ])(
    'offers no suggestion when one substitution cannot repair %j',
    async (body) => {
      const before = await validateWithMermaidJS(body);
      const error = before.ok ? undefined : before.error;
      const got = explain(error?.raw ?? '', body, error?.line);
      expect(got?.id).toBe('flowchart-mismatched-shape');
      expect(got?.suggestion).toBeUndefined();
    },
  );
});

/**
 * Cases that made a rule state something false about a real diagram. Each runs
 * end-to-end so the signature is mermaid's own, not a hand-copied string.
 */
describe('regressions', () => {
  async function explainReal(body: string) {
    const result = await validateWithMermaidJS(body);
    expect(result.ok, `fixture should not parse: ${body}`).toBe(false);
    const error = result.ok ? undefined : result.error;
    return explain(error?.raw ?? '', body, error?.line);
  }

  // `graph TD;` is the README spelling. Splitting the header on whitespace
  // alone left `TD;`, which is in no direction set, so the rule called a valid
  // header invalid while the real defect was the stray `)` three lines down.
  it('does not call a semicolon-terminated header a bad direction', async () => {
    const got = await explainReal(
      'graph TD;\n  subgraph one\n  A --> B\n  end)',
    );
    expect(got?.id).not.toBe('flowchart-bad-direction');
  });

  it('does not blame the header when the lexer tripped further down', async () => {
    const got = await explainReal('flowchart LR\n  A[Start] --> B)');
    expect(got?.id).not.toBe('flowchart-bad-direction');
  });

  // Isolates the header-line requirement: the `;` is mid-token, so cutting the
  // direction at it still leaves the header line blamed.
  // `graph TD;A-->B` on its own is valid mermaid.
  it('does not blame a header holding an inline statement', async () => {
    const got = await explainReal('graph TD;A-->B\n  C[Start] --> D)');
    expect(got?.id).not.toBe('flowchart-bad-direction');
  });

  // Isolates cutting the direction at `;`: the whole statement is on the
  // header line, so mermaid blames line 1 and the header-line gate passes.
  // Stripping only a *trailing* `;` left the direction as `TD;A-->B)`.
  it('does not blame an inline statement on the header line itself', async () => {
    const got = await explainReal('graph TD;A-->B)');
    expect(got?.id).not.toBe('flowchart-bad-direction');
  });

  // The header-line gate compares against `locateHeader`, not against line 1.
  // mermaid shifts the line it blames for a bad direction in lockstep with
  // anything that pushes the header down, so the rule must still fire — this
  // pins the mermaid behaviour the gate relies on.
  it.each([
    ['a comment', '%% a comment\nflowchart zzz\n  A --> B'],
    ['a blank line', '\nflowchart zzz\n  A --> B'],
    ['frontmatter', '---\ntitle: x\n---\nflowchart zzz\n  A --> B'],
  ])('still fires when the header follows %s', async (_label, body) => {
    const got = await explainReal(body);
    expect(got?.id).toBe('flowchart-bad-direction');
    expect(got?.message).toContain('zzz');
  });

  // `loop`, `rect` and friends are sequence keywords and legal flowchart node
  // ids. mermaid always lists `end` as legal at flowchart statement position,
  // so the signature fires on any flowchart; only the diagram-type partition
  // and the no-link check keep the rule from inventing a block.
  it.each(['loop', 'rect', 'alt', 'opt', 'par', 'critical'])(
    'does not invent a block from the flowchart node id `%s`',
    async (keyword) => {
      const got = await explainReal(
        `flowchart LR\n  ${keyword} --> B\n  ?!@#$`,
      );
      expect(got?.id).not.toBe('block-missing-end');
    },
  );

  // Isolates the diagram-type partition from the no-link check: nothing on the
  // `loop` line resembles a link, so only knowing that flowcharts have no
  // `loop` block keeps this from inventing one.
  it.each(['loop', 'rect'])(
    'does not invent a block from the bare flowchart node id `%s`',
    async (keyword) => {
      const got = await explainReal(`flowchart LR\n  ${keyword}\n  ?!@#$`);
      expect(got?.id).not.toBe('block-missing-end');
    },
  );

  it('still reports a genuinely unclosed sequence block', async () => {
    const got = await explainReal(
      'sequenceDiagram\n  Alice->>Bob: hi\n  loop x',
    );
    expect(got?.id).toBe('block-missing-end');
    expect(got?.message).toBe('`loop` block was never closed with `end`');
  });

  // Isolates the no-link check from the type partition: `rect` is a legal
  // sequence participant name, so inside a sequence diagram only "an opener
  // line carries no link" stops `rect->>B: hi` from being read as a second,
  // inner block and stealing the message from the real one.
  it('names the real block, not a participant sharing a keyword', async () => {
    const got = await explainReal(
      'sequenceDiagram\n  loop x\n    rect->>B: hi',
    );
    expect(got?.id).toBe('block-missing-end');
    expect(got?.message).toBe('`loop` block was never closed with `end`');
  });

  // The price of that check, paid deliberately: a loop whose *label* contains
  // an arrow reads as a statement, so a real unclosed block goes unexplained.
  // Declining loses an explanation; guessing would produce a wrong one, and
  // Tier 2 still declutters mermaid's own wording here.
  it('declines a block whose label contains an arrow', async () => {
    const got = await explainReal(
      'sequenceDiagram\n  loop --> retry\n    A->>B: x',
    );
    expect(got?.id).not.toBe('block-missing-end');
  });

  // `[[` opens a subroutine, `([` a stadium, `[(` a cylinder, `[/` and `[\` the
  // asymmetric shapes. Anchored on any `[` and any `]`, the paren rule read half
  // of one of those tokens as a rectangle: it named a defect that is not the
  // one there *and* offered `A[["foo("] --> B`, which mermaid rejects.
  it.each([
    'flowchart LR\n  A[[foo(] --> B',
    'flowchart LR\n  A([foo(] --> B',
    'flowchart LR\n  A[(foo(] --> B',
    // The asymmetric shapes spell their opener with a slash, which is part of
    // the token: `A["/foo(bar)/"] --> B` parses and is a different node.
    'flowchart LR\n  A[/foo(bar)/] --> B',
    'flowchart LR\n  A[\\foo(bar)\\] --> B',
  ])(
    'does not read half a compound shape opening as a label %j',
    async (body) => {
      const result = await validateWithMermaidJS(body);
      expect(result.ok, `fixture should not parse: ${body}`).toBe(false);
      const error = result.ok ? undefined : result.error;
      // The signature really does reach the rule, so only `confirm` stands
      // between the author and a wrong message.
      expectSignatureFires(
        'flowchart-unquoted-paren',
        error?.raw ?? '',
        body,
        error?.line,
      );
      expect(explain(error?.raw ?? '', body, error?.line)?.id).not.toBe(
        'flowchart-unquoted-paren',
      );
    },
  );

  it.each(['break', 'par_over'])(
    'reports an unclosed `%s` block',
    async (keyword) => {
      const got = await explainReal(
        `sequenceDiagram\n  Alice->>Bob: hi\n  ${keyword} x`,
      );
      expect(got?.id).toBe('block-missing-end');
      expect(got?.message).toBe(
        `\`${keyword}\` block was never closed with \`end\``,
      );
    },
  );
});
