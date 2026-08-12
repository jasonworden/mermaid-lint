import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('line citations in rule messages', () => {
  // Every rule module, not one file: the rules live in `src/semantic/rules/`,
  // and a guard that read a single path would silently stop covering a rule
  // the moment it moved to a new module.
  const rulesDir = resolve(import.meta.dirname, '../../src/semantic/rules');
  const ruleFiles = readdirSync(rulesDir).filter((name) =>
    name.endsWith('.ts'),
  );
  const cites = ruleFiles.flatMap((name) =>
    readFileSync(resolve(rulesDir, name), 'utf8')
      .split('\n')
      .map((text, i) => ({ where: `${name}:${i + 1}`, text }))
      .filter(({ text }) => /line \$\{/.test(text)),
  );

  // A rule counts body lines, but its message is read beside a `file:line`
  // position, so a cited number must be mapped with `ctx.fileLine` first
  // (#137). This scans the source because the rule suite above runs on `.mmd`
  // fixtures, where the two coordinate spaces coincide and a rule that forgot
  // would still pass. Its reach is the established "on line ${...}" phrasing:
  // a rule inventing new wording, or passing `fileLine` the wrong variable,
  // slips past — so a rule that cites a line also wants a fenced-Markdown case
  // in markdown-adapter.test.ts.
  it('maps every cited line number through fileLine', () => {
    const unmapped = cites
      .filter(({ text }) => !/line \$\{fileLine\(/.test(text))
      .map(({ where, text }) => `${where}: ${text.trim()}`);
    expect(unmapped).toEqual([]);
  });

  // Guards the guard. A rename that stopped the pattern matching would leave
  // the check above passing vacuously; so would rephrasing rules out of it one
  // at a time, which is why this is a floor at today's count rather than a
  // loose lower bound. Raise it when you add a citing rule.
  it('still finds every citation it is meant to police', () => {
    expect(cites.length).toBeGreaterThanOrEqual(33);
  });

  // The scan is only as wide as the directory listing: a rules directory that
  // came back empty (moved again, renamed) would leave both checks above
  // passing over nothing at all.
  it('scans every rule module', () => {
    expect(ruleFiles.length).toBeGreaterThanOrEqual(28);
  });
});
