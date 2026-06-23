import { applyFixes } from 'markdownlint';
import type { LintResults, Rule } from 'markdownlint';
import { lint } from 'markdownlint/promise';
import { describe, expect, it, vi } from 'vitest';

// Spy on core's validator so the perf test can assert the shared validation runs
// once per document regardless of how many rules are registered. The spy still
// delegates to the real implementation, so every other test exercises real
// validation. (vi.mock is hoisted above the index import below.)
vi.mock('@mermaid-lint/core', async (importActual) => {
  const actual = await importActual<typeof import('@mermaid-lint/core')>();
  return { ...actual, lintMarkdown: vi.fn(actual.lintMarkdown) };
});

import { lintMarkdown } from '@mermaid-lint/core';
import mermaidRules, { all, recommended, rules } from '../index.js';

/** Build a markdownlint config that enables exactly the given rules by name. */
function enable(ruleList: Rule[], extra: Record<string, unknown> = {}) {
  const config: Record<string, unknown> = { default: false };
  for (const rule of ruleList)
    for (const name of rule.names) config[name] = true;
  return { ...config, ...extra };
}

function lintWith(
  content: string,
  ruleList: Rule[],
  extra: Record<string, unknown> = {},
): Promise<LintResults> {
  return lint({
    strings: { 'test.md': content },
    customRules: ruleList,
    config: enable(ruleList, extra),
  });
}

/** The set of rule names that produced an error for test.md. */
function firedNames(result: LintResults): Set<string> {
  const names = new Set<string>();
  for (const err of result['test.md']) {
    for (const name of err.ruleNames ?? []) names.add(name);
  }
  return names;
}

const VALID = '```mermaid\nflowchart LR\n  A --> B\n```\n';
const PARSE_ERROR = '```mermaid\nflowchart LR\n  A -->|broken label B\n```\n';
const SELF_LOOP = '```mermaid\nflowchart LR\n  A --> A\n```\n';
const GRAPH_KEYWORD = '```mermaid\ngraph LR\n  A --> B\n```\n';
const ORPHAN = '```mermaid\nflowchart LR\n  A --> B\n  C[Hi]\n```\n';
const DUP_IDS =
  '```mermaid\nflowchart LR\n  A[One] --> B\n  A[Two] --> C\n```\n';
// Self-loop on A plus an orphan node C — triggers two distinct rules.
const SELF_LOOP_AND_ORPHAN =
  '```mermaid\nflowchart LR\n  A --> A\n  C[Hi]\n```\n';

describe('@mermaid-lint/markdownlint exports', () => {
  it('default export is the recommended bundle', () => {
    expect(mermaidRules).toBe(recommended);
  });

  it('recommended excludes the off-by-default rules; all includes them', () => {
    const recNames = new Set(recommended.flatMap((r) => r.names));
    const allNames = new Set(all.flatMap((r) => r.names));
    expect(recNames.has('mermaid-no-orphan-nodes')).toBe(false);
    expect(recNames.has('mermaid-prefer-explicit-participants')).toBe(false);
    expect(allNames.has('mermaid-no-orphan-nodes')).toBe(true);
    expect(allNames.has('mermaid-prefer-explicit-participants')).toBe(true);
  });

  it('rule names mirror core rule ids, with mermaid-syntax for parsing', () => {
    expect(rules.syntax.names).toContain('mermaid-syntax');
    expect(rules['no-self-loop'].names).toContain('mermaid-no-self-loop');
    expect(rules.syntax.tags).toEqual(['mermaid-diagram', 'code']);
    expect(typeof rules['no-self-loop'].description).toBe('string');
  });
});

describe('@mermaid-lint/markdownlint — recommended', () => {
  it('passes on a valid mermaid block', async () => {
    expect((await lintWith(VALID, recommended))['test.md']).toHaveLength(0);
  });

  it('flags a parse error under mermaid-syntax', async () => {
    const result = await lintWith(PARSE_ERROR, recommended);
    expect(firedNames(result).has('mermaid-syntax')).toBe(true);
  });

  it('surfaces a warn-default semantic rule (self-loop)', async () => {
    const result = await lintWith(SELF_LOOP, recommended);
    expect(firedNames(result).has('mermaid-no-self-loop')).toBe(true);
  });

  it('surfaces a warn-default rule on the legacy graph keyword (prefer-flowchart)', async () => {
    const result = await lintWith(GRAPH_KEYWORD, recommended);
    expect(firedNames(result).has('mermaid-prefer-flowchart')).toBe(true);
  });

  it('surfaces the error-default rule (duplicate ids)', async () => {
    const result = await lintWith(DUP_IDS, recommended);
    expect(firedNames(result).has('mermaid-duplicate-ids')).toBe(true);
  });

  it('does NOT surface an off-by-default rule (orphan nodes)', async () => {
    expect((await lintWith(ORPHAN, recommended))['test.md']).toHaveLength(0);
  });

  it("violation detail names the finding (so a rule name + detail tell you what's wrong)", async () => {
    const err = (await lintWith(SELF_LOOP, recommended))['test.md'][0];
    expect(err.errorDetail).toMatch(/self-loop/);
  });
});

describe('@mermaid-lint/markdownlint — opt-in granularity', () => {
  it('all surfaces an off-by-default rule (orphan nodes)', async () => {
    const result = await lintWith(ORPHAN, all);
    expect(firedNames(result).has('mermaid-no-orphan-nodes')).toBe(true);
  });

  it('cherry-picking a single off-by-default rule enables just it', async () => {
    const onlyOrphan = [rules['no-orphan-nodes']];
    // The off-by-default rule fires when registered on its own — no config map.
    expect(
      firedNames(await lintWith(ORPHAN, onlyOrphan)).has(
        'mermaid-no-orphan-nodes',
      ),
    ).toBe(true);
    // A self-loop is a different rule — not registered, so nothing fires.
    expect((await lintWith(SELF_LOOP, onlyOrphan))['test.md']).toHaveLength(0);
  });

  it('registering only the syntax rule ignores semantic findings', async () => {
    const onlySyntax = [rules.syntax];
    // Self-loop renders fine — with only the syntax rule registered, nothing fires.
    expect((await lintWith(SELF_LOOP, onlySyntax))['test.md']).toHaveLength(0);
    // A genuine parse error still fires.
    expect(
      firedNames(await lintWith(PARSE_ERROR, onlySyntax)).has('mermaid-syntax'),
    ).toBe(true);
  });

  it('disabling a single rule silences only that rule', async () => {
    const result = await lintWith(SELF_LOOP_AND_ORPHAN, all, {
      'mermaid-no-self-loop': false,
    });
    const fired = firedNames(result);
    expect(fired.has('mermaid-no-self-loop')).toBe(false);
    expect(fired.has('mermaid-no-orphan-nodes')).toBe(true);
  });
});

describe('@mermaid-lint/markdownlint — fences config', () => {
  it('ignores tilde fences when the syntax rule restricts to backtick', async () => {
    const md = '~~~mermaid\nflowchart LR\n  A -->|broken label B\n~~~\n';
    const result = await lintWith(md, [rules.syntax], {
      'mermaid-syntax': { fences: ['backtick'] },
    });
    expect(result['test.md']).toHaveLength(0);
  });

  it('still flags backtick fences when restricted to backtick', async () => {
    const result = await lintWith(PARSE_ERROR, [rules.syntax], {
      'mermaid-syntax': { fences: ['backtick'] },
    });
    expect(firedNames(result).has('mermaid-syntax')).toBe(true);
  });
});

describe('@mermaid-lint/markdownlint — line mapping', () => {
  it('reports a parse error at the correct absolute line', async () => {
    // Fence opens at line 3; body error is on body line 2 → absLine 5.
    const md =
      'Line one\n\n```mermaid\nflowchart LR\n  A -->|broken label B\n```\n';
    const result = await lintWith(md, [rules.syntax]);
    expect(result['test.md'][0].lineNumber).toBe(5);
  });

  it('reports an unclosed fence at the opener line (not past EOF)', async () => {
    const md = '```mermaid\nflowchart LR\n  A --> B\n';
    const errors = (await lintWith(md, [rules.syntax]))['test.md'];
    expect(errors).toHaveLength(1);
    expect(errors[0].lineNumber).toBe(1);
  });
});

describe('@mermaid-lint/markdownlint — autofix (--fix)', () => {
  /** Lint with the syntax rule, then apply markdownlint's fixes like `--fix`. */
  async function fix(content: string): Promise<string> {
    const result = await lintWith(content, [rules.syntax]);
    return applyFixes(content, result['test.md']);
  }

  it('normalizes a flowchart arrow (-> to -->)', async () => {
    const input = '```mermaid\nflowchart LR\n  A -> B\n```\n';
    expect(await fix(input)).toBe('```mermaid\nflowchart LR\n  A --> B\n```\n');
  });

  it('inserts a missing sequence-message colon', async () => {
    const input = '```mermaid\nsequenceDiagram\n  Alice->>Bob hello\n```\n';
    expect(await fix(input)).toBe(
      '```mermaid\nsequenceDiagram\n  Alice->>Bob: hello\n```\n',
    );
  });

  it('fixes every bad line in one pass (multiple arrows)', async () => {
    const input = '```mermaid\nflowchart LR\n  A -> B\n  C -> D\n```\n';
    expect(await fix(input)).toBe(
      '```mermaid\nflowchart LR\n  A --> B\n  C --> D\n```\n',
    );
  });

  it('preserves indentation when fixing an indented fence', async () => {
    // List-indented fenced block: the fix must keep the 4-space body indent.
    const input =
      '- item\n\n    ```mermaid\n    flowchart LR\n      A -> B\n    ```\n';
    expect(await fix(input)).toBe(
      '- item\n\n    ```mermaid\n    flowchart LR\n      A --> B\n    ```\n',
    );
  });

  it('leaves a valid block untouched (no fixInfo)', async () => {
    const input = '```mermaid\nflowchart LR\n  A --> B\n```\n';
    const result = await lintWith(input, [rules.syntax]);
    expect(result['test.md']).toHaveLength(0);
    expect(applyFixes(input, result['test.md'])).toBe(input);
  });

  it('does not offer a fix for an unfixable parse error', async () => {
    const result = await lintWith(PARSE_ERROR, [rules.syntax]);
    expect(firedNames(result).has('mermaid-syntax')).toBe(true);
    // No mechanical correction applies, so --fix is a no-op.
    expect(applyFixes(PARSE_ERROR, result['test.md'])).toBe(PARSE_ERROR);
  });

  it('names the concrete before → after edit in the finding detail', async () => {
    const input = '```mermaid\nflowchart LR\n  A -> B\n```\n';
    const result = await lintWith(input, [rules.syntax]);
    const fixable = result['test.md'].find((e) => e.fixInfo);
    expect(fixable?.errorDetail).toContain('`A -> B` → `A --> B`');
  });

  it('is idempotent — re-fixing already-fixed content is a no-op', async () => {
    const input = '```mermaid\nflowchart LR\n  A -> B\n```\n';
    const once = await fix(input);
    expect(await fix(once)).toBe(once);
  });

  it('only the syntax rule fixes — semantic rules carry no fixInfo', async () => {
    // A self-loop renders fine (semantic warning); there is nothing to mechanically fix.
    const result = await lintWith(SELF_LOOP, [rules['no-self-loop']]);
    expect(firedNames(result).has('mermaid-no-self-loop')).toBe(true);
    expect(applyFixes(SELF_LOOP, result['test.md'])).toBe(SELF_LOOP);
  });
});

describe('@mermaid-lint/markdownlint — performance', () => {
  it('validates a document once even with all rules registered', async () => {
    vi.mocked(lintMarkdown).mockClear();
    await lintWith(VALID, all);
    // all = 12 rules; without the shared memoized pass this would be 12 calls.
    expect(vi.mocked(lintMarkdown)).toHaveBeenCalledTimes(1);
  });
});

// Regression guard: markdownlint-cli2 must run async rules through its OWN
// bundled markdownlint. Versions < 0.17 bundle markdownlint < 0.37, which
// predates async custom rules and silently skips them (zero errors). This
// exercises that real path end-to-end.
describe('@mermaid-lint/markdownlint — markdownlint-cli2 integration', () => {
  it('runs through markdownlint-cli2 and flags invalid blocks', async () => {
    const { main } = await import('markdownlint-cli2');
    let results: Array<{ fileName: string; lineNumber: number }> = [];
    const exitCode = await main({
      directory: process.cwd(),
      argv: [],
      optionsOverride: {
        config: enable([rules.syntax]),
        customRules: [rules.syntax],
        outputFormatters: [
          [
            (options: { results: typeof results }) => {
              results = options.results;
            },
          ],
        ],
      },
      nonFileContents: {
        'bad.md': '```mermaid\nflowchart LR\n  A -->|broken label B\n```\n',
        'good.md': '```mermaid\nflowchart LR\n  A --> B\n```\n',
      },
      logMessage: () => {},
      logError: () => {},
    });
    expect(exitCode).toBeTruthy();
    expect(results).toHaveLength(1);
    expect(results[0].fileName).toBe('bad.md');
    expect(results[0].lineNumber).toBe(3);
  });
});
