import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  blockToDiagnostics,
  extractMermaidBlocks,
  lintMarkdown,
} from '../index.js';

const repoRoot = resolve(import.meta.dirname, '../../..');

describe('lintMarkdown', () => {
  it('returns no diagnostics for a valid mermaid block', async () => {
    const md = '```mermaid\nflowchart LR\n  A --> B\n```\n';
    expect(await lintMarkdown('test.md', md)).toEqual([]);
  });

  it('returns an error diagnostic for an invalid mermaid block', async () => {
    const md = '```mermaid\nflowchart LR\n  A -->|broken label B\n```\n';
    const diags = await lintMarkdown('test.md', md);
    const errors = diags.filter((d) => d.severity === 'error');
    expect(errors).toHaveLength(1);
    expect(errors[0].ruleId).toBe('mermaid');
  });

  it('maps a body error to its absolute document line', async () => {
    // Fence opens at line 3; body error is on body line 2 → 3 + 2 = 5.
    const md =
      'Line one\n\n```mermaid\nflowchart LR\n  A -->|broken label B\n```\n';
    const errors = (await lintMarkdown('test.md', md)).filter(
      (d) => d.severity === 'error',
    );
    expect(errors[0].line).toBe(5);
  });

  it('reports an unclosed fence at the opener line, not past EOF', async () => {
    const md = '```mermaid\nflowchart LR\n  A --> B\n';
    const errors = (await lintMarkdown('test.md', md)).filter(
      (d) => d.severity === 'error',
    );
    expect(errors).toHaveLength(1);
    expect(errors[0].line).toBe(1);
  });

  it('reports an empty mermaid block at the opener line', async () => {
    const md = '```mermaid\n```\n';
    const errors = (await lintMarkdown('test.md', md)).filter(
      (d) => d.severity === 'error',
    );
    expect(errors).toHaveLength(1);
    expect(errors[0].line).toBe(1);
  });

  it('ignores non-mermaid code blocks', async () => {
    const md = '```js\nconsole.log("hello")\n```\n';
    expect(await lintMarkdown('test.md', md)).toEqual([]);
  });

  it('flags only the invalid block among several', async () => {
    const md = [
      '```mermaid',
      'flowchart LR',
      '  A --> B',
      '```',
      '',
      '```mermaid',
      'flowchart LR',
      '  C -->|broken label D',
      '```',
      '',
    ].join('\n');
    const errors = (await lintMarkdown('test.md', md)).filter(
      (d) => d.severity === 'error',
    );
    expect(errors).toHaveLength(1);
  });

  it('surfaces warn-severity findings as warning diagnostics', async () => {
    // Legacy `graph` keyword → prefer-flowchart, a warn-severity rule.
    const md = '```mermaid\ngraph LR\n  A --> B\n```\n';
    const warnings = (await lintMarkdown('test.md', md)).filter(
      (d) => d.severity === 'warning',
    );
    expect(warnings.length).toBeGreaterThan(0);
    expect(warnings[0].ruleId).toBe('prefer-flowchart');
  });

  it('surfaces error-severity findings as error diagnostics', async () => {
    // Conflicting duplicate ids → duplicate-ids, an error-severity rule.
    const md =
      '```mermaid\nflowchart LR\n  A[Start] --> B\n  A[Begin] --> C\n```\n';
    const errors = (await lintMarkdown('test.md', md)).filter(
      (d) => d.severity === 'error' && d.ruleId === 'duplicate-ids',
    );
    expect(errors).toHaveLength(1);
  });
});

describe('blockToDiagnostics', () => {
  it('validates a single block built from explicit coordinates', async () => {
    const block = {
      path: 'doc.md',
      line: 10,
      col: 1,
      body: 'flowchart LR\n  A -->|broken label B',
      type: 'flowchart',
    };
    const errors = (await blockToDiagnostics(block)).filter(
      (d) => d.severity === 'error',
    );
    expect(errors).toHaveLength(1);
    // Body error on line 2 → opener(10) + 2 = 12.
    expect(errors[0].line).toBe(12);
  });

  // https://github.com/jasonworden/mermaid-lint/issues/123 — the diagram
  // parses, so before this rule the whole document came back clean.
  it('reports frontmatter-must-be-first as an error diagnostic', async () => {
    const text = [
      '# Doc',
      '',
      '```mermaid',
      '%% a note',
      '---',
      'title: T',
      '---',
      'flowchart LR',
      '  A --> B',
      '```',
    ].join('\n');
    const diags = await lintMarkdown('doc.md', text);
    const found = diags.filter((d) => d.ruleId === 'frontmatter-must-be-first');
    expect(found).toHaveLength(1);
    expect(found[0].severity).toBe('error');
    // Body line 2 (the `---`) → opener(3) + 2 = 5.
    expect(found[0].line).toBe(5);
  });

  it('reports nothing when the frontmatter opens the diagram', async () => {
    const text = [
      '# Doc',
      '',
      '```mermaid',
      '---',
      'title: T',
      '---',
      'flowchart LR',
      '  A --> B',
      '```',
    ].join('\n');
    const diags = await lintMarkdown('doc.md', text);
    expect(diags).toEqual([]);
  });

  it('is suppressible only from file scope, as the README documents', async () => {
    // A `%%` directive above the frontmatter would be the content that breaks
    // the render, so the file-scope directive is the only escape hatch that
    // works. README's "Directives must sit below any YAML frontmatter" section
    // tells readers to use exactly this — keep them in step.
    const block = [
      '```mermaid',
      '%% a note',
      '---',
      'title: T',
      '---',
      'flowchart LR',
      '  A --> B',
      '```',
    ];
    const text = [
      '<!-- mermaid-lint-disable-file frontmatter-must-be-first: vendored -->',
      '',
      ...block,
    ].join('\n');
    const diags = await lintMarkdown('doc.md', text);
    expect(diags.some((d) => d.ruleId === 'frontmatter-must-be-first')).toBe(
      false,
    );

    // Non-vacuous: the same document without the directive still reports.
    const without = await lintMarkdown('doc.md', block.join('\n'));
    expect(without.some((d) => d.ruleId === 'frontmatter-must-be-first')).toBe(
      true,
    );
  });
});

describe('suppression', () => {
  const md = (body: string) => `# Doc\n\n\`\`\`mermaid\n${body}\n\`\`\`\n`;

  it('suppresses a semantic finding with -disable-next-line', async () => {
    const withoutDirective = await lintMarkdown(
      'a.md',
      md('flowchart LR\n  A[x] --> B\n  A[y] --> C'),
    );
    expect(withoutDirective.some((d) => d.ruleId === 'duplicate-ids')).toBe(
      true,
    );

    const withDirective = await lintMarkdown(
      'a.md',
      md(
        'flowchart LR\n  A[x] --> B\n%% mermaid-lint-disable-next-line duplicate-ids: upstream\n  A[y] --> C',
      ),
    );
    expect(withDirective.some((d) => d.ruleId === 'duplicate-ids')).toBe(false);
  });

  it('suppresses every rule in the diagram with -disable-diagram all', async () => {
    const diags = await lintMarkdown(
      'a.md',
      md(
        '%% mermaid-lint-disable-diagram all: vendored\ngraph LR\n  A[x] --> B\n  A[y] --> C',
      ),
    );
    // Asserting on the full list (not just `warning`-severity diagnostics)
    // matters here: `graph LR` triggers the warn-severity `prefer-flowchart`,
    // but the duplicate `A` id triggers the *error*-severity `duplicate-ids`.
    // A filter that only looked at warnings could pass even if `all` failed
    // to suppress error-severity findings.
    expect(diags).toEqual([]);
  });

  it('does not suppress syntax errors via `all`', async () => {
    const diags = await lintMarkdown(
      'a.md',
      md(
        '%% mermaid-lint-disable-diagram all: vendored\nflowchart LR\n  A -->',
      ),
    );
    expect(diags.some((d) => d.ruleId === 'mermaid')).toBe(true);
  });

  it('suppresses a syntax error when `mermaid` is named at diagram scope', async () => {
    const diags = await lintMarkdown(
      'a.md',
      md(
        '%% mermaid-lint-disable-diagram mermaid: parser lags\nflowchart LR\n  A -->',
      ),
    );
    expect(diags.some((d) => d.ruleId === 'mermaid')).toBe(false);
  });

  it('never suppresses an unclosed fence, even with -disable-file mermaid', async () => {
    // Structural errors describe the document, not the diagram. An unclosed
    // fence has no parseable body, so no `%%` directive can reach it — making
    // -disable-file the only lever, and a blunt enough one to hide broken
    // Markdown forever. See `ValidationError.structural`.
    const text =
      '<!-- mermaid-lint-disable-file mermaid: vendored -->\n\n' +
      '# Doc\n\n```mermaid\nflowchart LR\n  A --> B\n';
    const diags = await lintMarkdown('a.md', text);
    expect(diags.some((d) => d.ruleId === 'mermaid')).toBe(true);
    // ...and because it suppressed nothing, it is also reported stale. That
    // reads oddly next to the error it tried to silence, but it is the honest
    // answer: this directive can never suppress a structural error, so saying
    // so is what tells the user to delete it rather than keep expecting it to
    // work. Asserted explicitly so the pairing is a decision, not an accident.
    expect(diags.filter((d) => d.ruleId === 'suppression-unused')).toHaveLength(
      1,
    );
  });

  it('never suppresses an empty block, even with -disable-file mermaid', async () => {
    const text =
      '<!-- mermaid-lint-disable-file mermaid: vendored -->\n\n' +
      '```mermaid\n```\n';
    const diags = await lintMarkdown('a.md', text);
    expect(diags.some((d) => d.ruleId === 'mermaid')).toBe(true);
    expect(diags.filter((d) => d.ruleId === 'suppression-unused')).toHaveLength(
      1,
    );
  });

  it('still suppresses a real parse error at file scope', async () => {
    // Guards the inverse of the two above: exempting structural errors must
    // not have exempted genuine diagram-parse failures too.
    const text = `<!-- mermaid-lint-disable-file mermaid: parser lags -->\n\n${md('flowchart LR\n  A -->')}`;
    const diags = await lintMarkdown('a.md', text);
    expect(diags.some((d) => d.ruleId === 'mermaid')).toBe(false);
  });

  it('applies a document-level directive to every block', async () => {
    const text =
      '<!-- mermaid-lint-disable-file duplicate-ids: vendored docs -->\n\n' +
      '```mermaid\nflowchart LR\n  A[x] --> B\n  A[y] --> C\n```\n';
    const diags = await lintMarkdown('a.md', text);
    expect(diags.some((d) => d.ruleId === 'duplicate-ids')).toBe(false);
  });

  it('reports an unknown rule id in a directive', async () => {
    const diags = await lintMarkdown(
      'a.md',
      md(
        '%% mermaid-lint-disable-diagram duplicat-ids: typo\nflowchart LR\n  A --> B',
      ),
    );
    expect(diags.some((d) => d.ruleId === 'suppression-unknown-rule')).toBe(
      true,
    );
  });

  it('reports a directive with no reason as malformed', async () => {
    const diags = await lintMarkdown(
      'a.md',
      md(
        '%% mermaid-lint-disable-diagram duplicate-ids\nflowchart LR\n  A --> B',
      ),
    );
    expect(diags.some((d) => d.ruleId === 'suppression-malformed')).toBe(true);
  });

  it('reports a directive that suppressed nothing', async () => {
    const diags = await lintMarkdown(
      'a.md',
      md(
        '%% mermaid-lint-disable-diagram no-self-loop: stale\nflowchart LR\n  A --> B',
      ),
    );
    expect(diags.some((d) => d.ruleId === 'suppression-unused')).toBe(true);
  });

  it('reports directive diagnostics at the directive line', async () => {
    const diags = await lintMarkdown(
      'a.md',
      md(
        'flowchart LR\n%% mermaid-lint-disable-diagram duplicat-ids: typo\n  A --> B',
      ),
    );
    const finding = diags.find((d) => d.ruleId === 'suppression-unknown-rule');
    // Fence opener is line 3, so body line 2 is document line 5.
    expect(finding?.line).toBe(5);
  });

  it('reports a broken file directive once for the whole document, at the HTML comment line', async () => {
    const text =
      '# Doc\n\n' +
      '<!-- mermaid-lint-disable-file duplicat-ids: typo -->\n\n' +
      '```mermaid\nflowchart LR\n  A --> B\n```\n\n' +
      '```mermaid\nflowchart LR\n  C --> D\n```\n\n' +
      '```mermaid\nflowchart LR\n  E --> F\n```\n\n' +
      '```mermaid\nflowchart LR\n  G --> H\n```\n';
    const diags = await lintMarkdown('a.md', text);
    const findings = diags.filter(
      (d) => d.ruleId === 'suppression-unknown-rule',
    );
    expect(findings).toHaveLength(1);
    // `# Doc` is line 1, a blank line 2, so the HTML comment is line 3 - not
    // any block's fence-opener line.
    expect(findings[0].line).toBe(3);
  });

  it('lets a meta-rule directive suppress another directive naming an unknown rule, without becoming unused itself', async () => {
    const diags = await lintMarkdown(
      'a.md',
      md(
        '%% mermaid-lint-disable-diagram suppression-unknown-rule: shush\n' +
          'flowchart LR\n' +
          '%% mermaid-lint-disable-diagram duplicat-ids: typo\n' +
          '  A --> B',
      ),
    );
    expect(diags.some((d) => d.ruleId === 'suppression-unknown-rule')).toBe(
      false,
    );
    // Naming the meta-rule and having it actually fire must not itself be
    // flagged as a suppression directive that suppressed nothing.
    expect(diags.some((d) => d.ruleId === 'suppression-unused')).toBe(false);
  });

  it('does not let a malformed directive suppress the diagnostic reporting its own malformedness', async () => {
    // This directive both is malformed (no reason) and names the very
    // meta-rule that would report that. It must still be reported: a
    // problem-carrying directive is inert to `isSuppressed`.
    const diags = await lintMarkdown(
      'a.md',
      md(
        '%% mermaid-lint-disable-diagram suppression-malformed\nflowchart LR\n  A --> B',
      ),
    );
    expect(diags.some((d) => d.ruleId === 'suppression-malformed')).toBe(true);
  });

  it('does not treat a file directive inside a fenced code block as live', async () => {
    // Documentation showing the directive syntax, e.g. this project's own
    // README, must not become a live suppression.
    const text =
      '# Doc\n\n' +
      '```markdown\n<!-- mermaid-lint-disable-file duplicate-ids: example -->\n```\n\n' +
      '```mermaid\nflowchart LR\n  A[x] --> B\n  A[y] --> C\n```\n';
    const diags = await lintMarkdown('a.md', text);
    expect(diags.some((d) => d.ruleId === 'duplicate-ids')).toBe(true);
    expect(diags.some((d) => d.ruleId?.startsWith('suppression-'))).toBe(false);
  });

  it('does not treat a file directive inside an inline code span as live', async () => {
    const text =
      '# Doc\n\n' +
      '| Directive | Scope |\n' +
      '|---|---|\n' +
      '| `<!-- mermaid-lint-disable-file <rules>: <reason> -->` | every diagram |\n\n' +
      '```mermaid\nflowchart LR\n  A[x] --> B\n  A[y] --> C\n```\n';
    const diags = await lintMarkdown('a.md', text);
    expect(diags.some((d) => d.ruleId === 'duplicate-ids')).toBe(true);
    expect(diags.some((d) => d.ruleId?.startsWith('suppression-'))).toBe(false);
  });

  it('still honors a real file directive outside any fence or code span', async () => {
    const text =
      '# Doc\n\n' +
      '<!-- mermaid-lint-disable-file duplicate-ids: vendored -->\n\n' +
      '```mermaid\nflowchart LR\n  A[x] --> B\n  A[y] --> C\n```\n';
    const diags = await lintMarkdown('a.md', text);
    expect(diags.some((d) => d.ruleId === 'duplicate-ids')).toBe(false);
  });

  it('reports a bare `%% mermaid-lint-disable` as one suppression-malformed diagnostic, not two', async () => {
    const diags = await lintMarkdown(
      'a.md',
      md('%% mermaid-lint-disable\nflowchart LR\n  A --> B'),
    );
    const malformed = diags.filter((d) => d.ruleId === 'suppression-malformed');
    expect(malformed).toHaveLength(1);
  });

  it('reports `-disable-file` used as a %% body comment as wrong-scope, not silently ignored', async () => {
    const diags = await lintMarkdown(
      'a.md',
      md(
        '%% mermaid-lint-disable-file duplicate-ids: reason\nflowchart LR\n  A --> B',
      ),
    );
    const finding = diags.find((d) => d.ruleId === 'suppression-malformed');
    expect(finding?.message).toContain('mermaid-lint-disable-file');
    expect(finding?.message).toContain('HTML comment');
  });

  it('reports a line-scope keyword used as an HTML comment as wrong-scope, not silently ignored', async () => {
    const text =
      '# Doc\n\n' +
      '<!-- mermaid-lint-disable-next-line duplicate-ids: reason -->\n\n' +
      '```mermaid\nflowchart LR\n  A[x] --> B\n  A[y] --> C\n```\n';
    const diags = await lintMarkdown('a.md', text);
    const finding = diags.find((d) => d.ruleId === 'suppression-malformed');
    expect(finding?.message).toContain('mermaid-lint-disable-next-line');
    expect(finding?.message).toContain('%%');
    // The wrong-scope HTML comment doesn't suppress the duplicate id either.
    expect(diags.some((d) => d.ruleId === 'duplicate-ids')).toBe(true);
  });

  it('reports a stale file directive once for the whole document, at the HTML comment line', async () => {
    const text =
      '# Doc\n\n' +
      '<!-- mermaid-lint-disable-file duplicate-ids: no longer needed -->\n\n' +
      '```mermaid\nflowchart LR\n  A --> B\n```\n\n' +
      '```mermaid\nflowchart LR\n  C --> D\n```\n\n' +
      '```mermaid\nflowchart LR\n  E --> F\n```\n';
    const diags = await lintMarkdown('a.md', text);
    const findings = diags.filter((d) => d.ruleId === 'suppression-unused');
    expect(findings).toHaveLength(1);
    // `# Doc` is line 1, blank line 2, so the HTML comment is line 3 - not any
    // block's fence-opener line.
    expect(findings[0].line).toBe(3);
    expect(findings[0].column).toBe(1);
    expect(findings[0].message).toContain('in this document');
  });

  it('does not report a file directive that suppressed something', async () => {
    const text =
      '<!-- mermaid-lint-disable-file duplicate-ids: vendored -->\n\n' +
      '```mermaid\nflowchart LR\n  A[x] --> B\n  A[y] --> C\n```\n';
    const diags = await lintMarkdown('a.md', text);
    expect(diags.some((d) => d.ruleId === 'suppression-unused')).toBe(false);
  });

  it('does not report a file directive that fired in only one of several blocks', async () => {
    // The whole point of unioning per-block usage: from block 1's index alone
    // this directive looks unused.
    const text =
      '<!-- mermaid-lint-disable-file duplicate-ids: vendored -->\n\n' +
      '```mermaid\nflowchart LR\n  A --> B\n```\n\n' +
      '```mermaid\nflowchart LR\n  C --> D\n```\n\n' +
      '```mermaid\nflowchart LR\n  E[x] --> F\n  E[y] --> G\n```\n';
    const diags = await lintMarkdown('a.md', text);
    expect(diags.some((d) => d.ruleId === 'duplicate-ids')).toBe(false);
    expect(diags.some((d) => d.ruleId === 'suppression-unused')).toBe(false);
  });

  it('reports a file directive in a document with no mermaid blocks at all', async () => {
    const text =
      '# Doc\n\n<!-- mermaid-lint-disable-file all: leftover -->\n\nprose only\n';
    const diags = await lintMarkdown('a.md', text);
    const findings = diags.filter((d) => d.ruleId === 'suppression-unused');
    expect(findings).toHaveLength(1);
    expect(findings[0].line).toBe(3);
  });

  it('does not report a file directive that suppressed another file directive problem', async () => {
    const text =
      '<!-- mermaid-lint-disable-file suppression-unknown-rule: shush -->\n' +
      '<!-- mermaid-lint-disable-file duplicat-ids: typo -->\n\n' +
      '```mermaid\nflowchart LR\n  A --> B\n```\n';
    const diags = await lintMarkdown('a.md', text);
    expect(diags.some((d) => d.ruleId === 'suppression-unknown-rule')).toBe(
      false,
    );
    // The meta-rule directive fired, so it is not itself stale. The typo'd
    // directive carries a problem and is inert, so it is never "unused".
    expect(diags.some((d) => d.ruleId === 'suppression-unused')).toBe(false);
  });

  it('reports a file-scope `all` directive when the only finding is a syntax error', async () => {
    // `all` deliberately excludes `mermaid` (see RULE_IDS_EXCLUDED_FROM_ALL),
    // so over a document whose only problem is a parse error it really did
    // suppress nothing. Suppressing that error takes naming `mermaid`.
    const text =
      '<!-- mermaid-lint-disable-file all: vendored -->\n\n' +
      '```mermaid\nflowchart LR\n  A -->|broken\n```\n';
    const diags = await lintMarkdown('a.md', text);
    expect(diags.some((d) => d.ruleId === 'mermaid')).toBe(true);
    expect(diags.filter((d) => d.ruleId === 'suppression-unused')).toHaveLength(
      1,
    );
  });

  it('marks both of two identical file directives used when the rule fires', async () => {
    // `isSuppressed` deliberately has no early break, so every matching
    // directive is marked used — otherwise the second copy would look stale
    // purely because the first one matched first.
    const text =
      '<!-- mermaid-lint-disable-file duplicate-ids: r1 -->\n' +
      '<!-- mermaid-lint-disable-file duplicate-ids: r2 -->\n\n' +
      '```mermaid\nflowchart LR\n  A[x] --> B\n  A[y] --> C\n```\n';
    const diags = await lintMarkdown('a.md', text);
    expect(diags).toEqual([]);
  });

  it('reports both of two identical file directives when the rule never fires', async () => {
    const text =
      '<!-- mermaid-lint-disable-file duplicate-ids: r1 -->\n' +
      '<!-- mermaid-lint-disable-file duplicate-ids: r2 -->\n\n' +
      '```mermaid\nflowchart LR\n  A --> B\n```\n';
    const diags = await lintMarkdown('a.md', text);
    const findings = diags.filter((d) => d.ruleId === 'suppression-unused');
    expect(findings.map((d) => d.line)).toEqual([1, 2]);
  });

  it('reports a file directive naming a rule that is off by default', async () => {
    // The known false-positive mode: `no-orphan-nodes` is `off`, so it is
    // never queried and the directive looks stale even though the diagram has
    // an orphan. The hedged wording exists for exactly this.
    const text =
      '<!-- mermaid-lint-disable-file no-orphan-nodes: shush -->\n\n' +
      '```mermaid\nflowchart LR\n  A --> B\n  Z\n```\n';
    const diags = await lintMarkdown('a.md', text);
    const findings = diags.filter((d) => d.ruleId === 'suppression-unused');
    expect(findings).toHaveLength(1);
    expect(findings[0].message).toContain('may be off');
  });

  it('does not also report a wrong-scope HTML comment as unused', async () => {
    // It already carries a `wrong-scope` problem, which makes it inert — a
    // directive is reported as broken or as stale, never as both.
    const text =
      '<!-- mermaid-lint-disable-next-line duplicate-ids: r -->\n\n' +
      '```mermaid\nflowchart LR\n  A --> B\n```\n';
    const diags = await lintMarkdown('a.md', text);
    expect(diags.some((d) => d.ruleId === 'suppression-malformed')).toBe(true);
    expect(diags.some((d) => d.ruleId === 'suppression-unused')).toBe(false);
  });

  it('reports a stale file directive at the right line in a CRLF document', async () => {
    const text =
      '# Doc\r\n\r\n' +
      '<!-- mermaid-lint-disable-file duplicate-ids: stale -->\r\n\r\n' +
      '```mermaid\r\nflowchart LR\r\n  A --> B\r\n```\r\n';
    const diags = await lintMarkdown('a.md', text);
    const findings = diags.filter((d) => d.ruleId === 'suppression-unused');
    expect(findings).toHaveLength(1);
    expect(findings[0].line).toBe(3);
  });

  it('returns no diagnostics for a document with neither blocks nor HTML comments', async () => {
    // Covers the false branch of the `<!--` fast path that guards the
    // no-blocks `parseFileDirectives` fallback.
    expect(
      await lintMarkdown('a.md', '# just prose\n\nnothing here\n'),
    ).toEqual([]);
  });

  it('returns no diagnostics for a non-directive HTML comment with no blocks', async () => {
    expect(
      await lintMarkdown('a.md', '# Doc\n\n<!-- TODO: something -->\n'),
    ).toEqual([]);
  });

  it('does not report a file directive as unused for a .mmd file', async () => {
    // `.mmd` is a whole-file diagram, not Markdown - HTML comments in it are
    // diagram content, never directives.
    const diags = await lintMarkdown(
      'a.mmd',
      '<!-- mermaid-lint-disable-file duplicate-ids: n/a -->\nflowchart LR\n  A --> B',
    );
    expect(diags.some((d) => d.ruleId === 'suppression-unused')).toBe(false);
  });
});

describe('blockToDiagnostics and file-scope directives', () => {
  it('never reports a stale file directive, however many blocks it is called for', async () => {
    // Per-block callers can't answer "unused document-wide" - a directive that
    // fires in block 3 looks unused from block 1 - so blockToDiagnostics stays
    // silent rather than reporting it once per block. See its doc comment.
    const text =
      '<!-- mermaid-lint-disable-file duplicate-ids: stale -->\n\n' +
      '```mermaid\nflowchart LR\n  A --> B\n```\n\n' +
      '```mermaid\nflowchart LR\n  C --> D\n```\n';
    const blocks = extractMermaidBlocks('a.md', text);
    expect(blocks).toHaveLength(2);
    const diags = (
      await Promise.all(blocks.map((b) => blockToDiagnostics(b)))
    ).flat();
    expect(diags.some((d) => d.ruleId === 'suppression-unused')).toBe(false);
  });

  it('still reports a stale body-scope directive per block', async () => {
    const text =
      '```mermaid\n%% mermaid-lint-disable-diagram no-self-loop: stale\nflowchart LR\n  A --> B\n```\n';
    const [block] = extractMermaidBlocks('a.md', text);
    const diags = await blockToDiagnostics(block);
    const findings = diags.filter((d) => d.ruleId === 'suppression-unused');
    expect(findings).toHaveLength(1);
    expect(findings[0].message).toContain('nothing here');
  });
});

describe('dogfooding: this repo lints clean', () => {
  it('README.md has no suppression-* diagnostics', async () => {
    const text = readFileSync(resolve(repoRoot, 'README.md'), 'utf8');
    const diags = await lintMarkdown('README.md', text);
    const suppressionDiags = diags.filter((d) =>
      d.ruleId.startsWith('suppression-'),
    );
    expect(suppressionDiags).toEqual([]);
  });

  it('docs/semantic-rules.md has no suppression-* diagnostics', async () => {
    const text = readFileSync(
      resolve(repoRoot, 'docs/semantic-rules.md'),
      'utf8',
    );
    const diags = await lintMarkdown('docs/semantic-rules.md', text);
    const suppressionDiags = diags.filter((d) =>
      d.ruleId.startsWith('suppression-'),
    );
    expect(suppressionDiags).toEqual([]);
  });
});
