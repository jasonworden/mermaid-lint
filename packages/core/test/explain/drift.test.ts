import { describe, expect, it } from 'vitest';
import { validateWithMermaidJS } from '../../src/validate.js';

/**
 * One body per Tier 1 rule in `EXPLAIN_RULES`, each verified against the
 * currently bundled mermaid to trigger that rule's translation, plus a
 * substring unique to that rule's own message.
 *
 * The substring is the point of this file. `message !== raw` alone would
 * stay green even if a rule's token signature stopped matching and the
 * error fell through to some *other* translation (Tier 1 or Tier 2) that
 * still produces non-raw text — that failure mode is exactly upstream drift,
 * and a bare inequality check cannot see it. Asserting a rule-specific
 * fragment of the message means only that rule's own `confirm()` output can
 * satisfy the case.
 *
 * If a mermaid upgrade renames a token or rewords its error text, the rule
 * that keyed off the old shape stops firing, mermaid's raw jargon (or a
 * different rule's message) comes through instead, and the matching case
 * below fails — loudly, in CI, naming exactly which rule broke.
 */
const TRIGGERS: [id: string, body: string, expectFragment: string][] = [
  ['unknown-diagram-type', 'flowchat LR\n  A --> B', 'unknown diagram type'],
  [
    'flowchart-bad-direction',
    'flowchart ZZZZ\n  A --> B',
    'is not a valid flowchart direction',
  ],
  [
    'sequence-note-missing-colon',
    'sequenceDiagram\n  A->>B: x\n  Note over A hello',
    '`Note` is missing a colon',
  ],
  [
    'sequence-missing-colon',
    'sequenceDiagram\n  Alice->>Bob hello',
    'sequence message is missing a colon',
  ],
  [
    'flowchart-single-dash-arrow',
    'flowchart LR\n  A -> B',
    'is not a flowchart arrow',
  ],
  [
    'flowchart-space-in-id',
    'flowchart LR\n  My Node --> B',
    'contains a space',
  ],
  [
    'flowchart-mismatched-shape',
    'flowchart LR\n  A[Start) --> B',
    'opened with `[` is closed with `)`',
  ],
  [
    'flowchart-unclosed-shape',
    'flowchart LR\n  A[Start --> B',
    'opened with `[` was never closed',
  ],
  [
    'flowchart-unquoted-paren',
    'flowchart LR\n  A[call foo(bar)] --> B',
    '`(` inside a label needs quoting',
  ],
  [
    'flowchart-reserved-end',
    'flowchart LR\n  A --> end',
    '`end` is a reserved word',
  ],
  [
    'block-missing-end',
    'flowchart LR\n  subgraph one\n    A --> B',
    '`subgraph` block was never closed with `end`',
  ],
];

describe('Tier 1 drift guard', () => {
  it.each(TRIGGERS)(
    '%s still fires against the bundled mermaid',
    async (id, body, expectFragment) => {
      const result = await validateWithMermaidJS(body);
      expect(result.ok, `${id}: mermaid now accepts this body`).toBe(false);
      if (result.ok) return;

      expect(
        result.error.message,
        `${id}: no longer translated — mermaid's message shape changed:\n${result.error.raw}`,
      ).not.toBe(result.error.raw);

      // The stronger check: not just "translated somehow" but "translated by
      // *this* rule". A rule that silently stopped matching would either
      // leak mermaid's raw jargon (caught above) or fall through to a
      // different rule/Tier 2 declutter that still changes the text — this
      // is what catches that second case.
      expect(
        result.error.message,
        `${id}: message no longer contains its rule's signature text — a different rule (or Tier 2) may have produced this instead:\n${result.error.message}`,
      ).toContain(expectFragment);
    },
  );
});
