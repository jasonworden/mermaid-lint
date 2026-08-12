import type { Block } from '../../src/extract.js';
import { RULE_DEFAULTS, type ResolvedRules } from '../../src/rules.js';
import { checkSemantics } from '../../src/semantic/index.js';

// A whole-file `.mmd` block, so body lines and file lines coincide: a rule's
// `line` and any line it cites in its message are then the same number, and
// these stay pure rule-logic tests. The body→file mapping that makes the two
// diverge inside a Markdown fence belongs to the adapter, and is covered by
// "line citations in messages" in markdown-adapter.test.ts (#137).
export function block(body: string, type = 'flowchart'): Block {
  return { path: 'test.mmd', line: 1, col: 1, body, type };
}

// Focus a single rule's findings — `checkSemantics` runs every rule, so the
// duplicate-id tests below filter to that rule to stay isolated from, e.g.,
// `prefer-flowchart` also firing on a `graph` fixture.
export function only(b: Block, rule: string, rules?: ResolvedRules) {
  return checkSemantics(b, rules ?? RULE_DEFAULTS).filter(
    (w) => w.rule === rule,
  );
}
