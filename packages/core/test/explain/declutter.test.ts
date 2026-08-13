import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  type ExplainInput,
  explainParseError,
} from '../../src/explain/index.js';
import { parseRawError } from '../../src/explain/parse-raw.js';
import { EXPLAIN_RULES } from '../../src/explain/rules.js';
import { detectDiagramType } from '../../src/type-detect.js';
import { validateWithMermaidJS } from '../../src/validate.js';

const INVALID_DIR = join(
  fileURLToPath(import.meta.url),
  '..',
  '..',
  'fixtures',
  'parity',
  'invalid',
);

function toInput(raw: string, body: string, line?: number): ExplainInput {
  return {
    parsed: parseRawError(raw),
    raw,
    body,
    line,
    type: detectDiagramType(body),
  };
}

function explain(raw: string, body: string, line?: number) {
  return explainParseError(toInput(raw, body, line));
}

function ruleById(id: string) {
  const rule = EXPLAIN_RULES.find((candidate) => candidate.id === id);
  if (rule === undefined) throw new Error(`no rule with id ${id}`);
  return rule;
}

// ---------------------------------------------------------------------------
// Raws below are verbatim from a probe against the bundled mermaid, except
// where a comment says the shape is synthesized to reach a branch mermaid's
// own fixtures do not currently exercise.
// ---------------------------------------------------------------------------

const MINDMAP_RAW =
  'There can be only one root. No parent could be found for ("root2")';

const CLASS_UNCLOSED_RAW =
  "Parse error on line 4:\n...  +makeSound() void\n----------------------^\nExpecting 'STRUCT_STOP', 'MEMBER', got 'EOF_IN_STRUCT'";

const KANBAN_LEXICAL_RAW =
  'Lexical error on line 4. Unrecognized text.\n...odo    id1[Task]  @@@@\n---------------------^';

const LANGIUM_LEXER_ONLY_RAW =
  'Parsing failed: Lexer error on line 3, column 3: unexpected character: ->@<- at offset: 33, skipped 4 characters. ';

const LANGIUM_PAIR_RAW =
  "Parsing failed:  Parse error on line 3, column 22: Expecting token of type ',' but found `]`.";

/** Synthetic: a Langium sequence block whose `but found` clause is absent. */
const LANGIUM_EXPECTED_ONLY_RAW =
  'Parsing failed: Parse error on line 2, column 3: Expecting: one of these possible Token sequences:\n  1. [NUMBER]\n  2. [NEWLINE, NUMBER]\n';

/** Synthetic: a Langium sequence block with a `but found` clause and no list. */
const LANGIUM_FOUND_ONLY_RAW =
  "Parsing failed: Parse error on line 2, column 3: Expecting: one of these possible Token sequences:\nbut found: '@'";

const NO_TYPE_RAW =
  'No diagram type detected matching given configuration for text: gantt\n  dateFormat YYYY\n  secret --> value';

const SEQ_COLON_RAW =
  "Parse error on line 2:\n...ce->>Bob hello there\n-----------------------^\nExpecting 'TXT', got 'NEWLINE'";

const NOTE_COLON_RAW =
  "Parse error on line 3:\n...  Note over A hello\n----------------------^\nExpecting ',', 'TXT', got 'NEWLINE'";

describe('Tier 2 declutter: module-thrown messages', () => {
  it('passes a module message through byte-identically', () => {
    const body = 'mindmap\n  root1\n  root2';
    expect(explain(MINDMAP_RAW, body, 3)).toEqual({ message: MINDMAP_RAW });
  });

  it('does not trim, capitalize, or otherwise touch the text', () => {
    // Leading/trailing whitespace and a lowercase opener are exactly what a
    // well-meaning `.trim()` or sentence-caser would "fix". They must survive.
    const raw = '  trying to checkout branch which is not yet created.  ';
    const out = explain(raw, 'gitGraph\n  checkout nope', 2);
    expect(out.message).toBe(raw);
    expect(out).toEqual({ message: raw });
  });

  it('carries no suggestion and no fixable flag', () => {
    const out = explain(MINDMAP_RAW, 'mindmap\n  a\n  b', 3);
    expect(out.suggestion).toBeUndefined();
    expect(out.fixable).toBeUndefined();
    expect(Object.keys(out)).toEqual(['message']);
  });

  it('is reached without any Tier 1 rule matching', () => {
    // The pass-through is only byte-identical for as long as no Tier 1 rule
    // claims this family. A future rule that keys on an empty signature would
    // silently break the contract above; this pins the invariant.
    const input = toInput(MINDMAP_RAW, 'mindmap\n  a\n  b', 3);
    expect(input.parsed.family).toBe('module');
    for (const rule of EXPLAIN_RULES)
      expect(rule.matches(input), `${rule.id} matched a module error`).toBe(
        false,
      );
  });
});

describe('Tier 2 declutter: token-carrying families', () => {
  it('drops the caret snippet and the line-citing header', () => {
    const out = explain(CLASS_UNCLOSED_RAW, 'classDiagram\n  class Dog {\n', 4);
    expect(out.message).not.toContain('^');
    expect(out.message).not.toContain('Parse error on line');
    expect(out.message).not.toContain('makeSound');
  });

  it('builds an expected/found sentence from the token signature', () => {
    const out = explain(CLASS_UNCLOSED_RAW, 'classDiagram\n  class Dog {\n', 4);
    expect(out.message).toBe(
      'expected `}` or a class member, found an unclosed block',
    );
  });

  it('humanizes the Langium single-token form the same way', () => {
    const out = explain(
      LANGIUM_PAIR_RAW,
      'wardley-beta\n  component A [0.5]',
      2,
    );
    expect(out.message).toBe('expected `,`, found `]`');
  });

  it('omits the found clause when no token was carried', () => {
    const out = explain(LANGIUM_EXPECTED_ONLY_RAW, 'radar-beta\n  a', 2);
    // `NUMBER` is not a token this layer has a phrase for, so it passes
    // through backticked rather than being guessed at.
    expect(out.message).toBe('expected the end of the line or `NUMBER`');
  });

  it('omits the expected clause when the list is empty', () => {
    const out = explain(LANGIUM_FOUND_ONLY_RAW, 'radar-beta\n  a', 2);
    expect(out.message).toBe('unexpected `@`');
  });

  it('says something true when neither clause survives', () => {
    const out = explain(LANGIUM_LEXER_ONLY_RAW, 'eventmodeling\n  a\n  @', 3);
    expect(out.message).toBe('unexpected input');
  });

  it('reduces a jison lexical error to unrecognized text', () => {
    const out = explain(
      KANBAN_LEXICAL_RAW,
      'kanban\n  todo\n  id1[Task]\n  @@@@',
      4,
    );
    expect(out.message).toBe('unrecognized text');
  });

  it('never names a line number', () => {
    for (const raw of [
      CLASS_UNCLOSED_RAW,
      KANBAN_LEXICAL_RAW,
      LANGIUM_LEXER_ONLY_RAW,
      LANGIUM_PAIR_RAW,
    ]) {
      const out = explain(raw, 'classDiagram\n  a\n  b\n  c', 4);
      expect(out.message, raw).not.toMatch(/\bline\s*\d/i);
    }
  });
});

describe('Tier 2 declutter: no diagram type', () => {
  it('names the type without echoing the body back', () => {
    const body = 'gantt\n  dateFormat YYYY\n  secret --> value';
    const out = explain(NO_TYPE_RAW, body, undefined);
    expect(out.message).toBe('no diagram type detected for `gantt`');
    expect(out.message).not.toContain('secret');
    expect(out.message).not.toContain('dateFormat');
  });

  it('does not call a real diagram keyword unknown', () => {
    // Tier 1 declines on a known keyword on purpose: mermaid says the same
    // thing when a genuine type is not registered in the running config.
    // Tier 2 repeating "unknown diagram type `gantt`" would state the very
    // falsehood Tier 1 stepped around.
    const body = 'gantt\n  dateFormat YYYY';
    expect(explain(NO_TYPE_RAW, body, undefined).message).not.toContain(
      'unknown',
    );
  });

  it('falls back to the bare verdict when the body has no header', () => {
    const raw =
      'No diagram type detected matching given configuration for text: ';
    expect(explain(raw, '', undefined).message).toBe(
      'no diagram type detected',
    );
  });
});

describe('explainParseError orchestration', () => {
  it('returns the first Tier 1 rule that matches and confirms', () => {
    const out = explain(
      SEQ_COLON_RAW,
      'sequenceDiagram\n  Alice->>Bob hello',
      2,
    );
    expect(out).toEqual({
      message: 'sequence message is missing a colon',
      suggestion: '  Alice->>Bob: hello',
      fixable: true,
    });
  });

  it('walks the table in its own order, not by specificity of the input', () => {
    // `sequence-note-missing-colon` and `sequence-missing-colon` share a
    // signature; the table's order is the only thing choosing between them.
    const body = 'sequenceDiagram\n  Alice->>Bob: hi\n  Note over Alice hello';
    const out = explain(NOTE_COLON_RAW, body, 3);
    expect(out.message).toBe('`Note` is missing a colon before its text');
  });

  it('falls through to Tier 2 when a matching rule declines', () => {
    const body = 'gantt\n  dateFormat YYYY';
    const input = toInput(NO_TYPE_RAW, body, undefined);
    const rule = ruleById('unknown-diagram-type');

    // The gate really fires — the decline is `confirm`'s doing, so this test
    // exercises the fallthrough path rather than "no rule matched at all".
    expect(rule.matches(input)).toBe(true);
    expect(rule.confirm('', input)).toBeUndefined();

    expect(explainParseError(input).message).toBe(
      'no diagram type detected for `gantt`',
    );
  });

  it('hands each rule the blamed source line', () => {
    const body = 'flowchart LR\n  A[Start --> B';
    const raw =
      "Parse error on line 2:\n... LR  A[Start --> B\n---------------------^\nExpecting 'SQE', 'TAGEND', 'UNICODE_TEXT', 'TEXT', 'TAGSTART', got '1'";
    // Line 2 is the defective one; a rule reading any other line cannot
    // confirm, and the result would be the Tier 2 sentence instead.
    expect(explain(raw, body, 2).message).toContain('never closed');
    expect(explain(raw, body, 1).message).toContain('expected');
  });

  it('declutters when no line is resolved at all', () => {
    const out = explain(CLASS_UNCLOSED_RAW, 'classDiagram\n  class Dog {\n');
    expect(out.message).toBe(
      'expected `}` or a class member, found an unclosed block',
    );
  });
});

describe('golden output over the invalid parity fixtures', () => {
  async function translateFixtures() {
    const files = (await readdir(INVALID_DIR))
      .filter((f) => f.endsWith('.mmd'))
      .sort();
    const out: Record<
      string,
      { family: string; explanation: ReturnType<typeof explainParseError> }
    > = {};

    for (const file of files) {
      const body = (await readFile(join(INVALID_DIR, file), 'utf8')).trim();
      const result = await validateWithMermaidJS(body);
      expect(result.ok, `${file} unexpectedly parsed`).toBe(false);
      if (result.ok) continue;
      // `message` is still mermaid's own text at this point in the branch —
      // body-relative, which is exactly what `validate.ts` will hand the
      // explain layer once it is wired in.
      const raw = result.error.message;
      out[file] = {
        family: parseRawError(raw).family,
        explanation: explainParseError(toInput(raw, body, result.error.line)),
      };
    }
    return out;
  }

  it('translates all 18 invalid fixtures', async () => {
    const translated = await translateFixtures();
    expect(Object.keys(translated).length).toBe(18);
    expect(translated).toMatchSnapshot();
  }, 60000);

  it('leaves no caret artifact and no echoed snippet', async () => {
    const translated = await translateFixtures();
    for (const [file, { explanation }] of Object.entries(translated)) {
      expect(explanation.message, file).not.toMatch(/-{5,}\^/);
      expect(explanation.message, file).not.toContain('\n');
    }
  }, 60000);

  it('cites no line number outside a verbatim module message', async () => {
    const translated = await translateFixtures();
    for (const [file, { family, explanation }] of Object.entries(translated)) {
      // Module messages are mermaid's own prose, passed through untouched by
      // contract — treeView's "Line 2:" among them (issue #190, out of scope).
      if (family === 'module') continue;
      expect(explanation.message, file).not.toMatch(/\bline\s*\d/i);
    }
  }, 60000);
});
