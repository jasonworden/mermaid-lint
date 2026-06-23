import { readFileSync } from 'node:fs';
import { type DiscoverOptions, discoverFiles } from './discover.js';
import { type Block, extractMermaidBlocks } from './extract.js';
import { type Diagnostic, blockToDiagnostics } from './markdown-adapter.js';
import { type RulesConfig, resolveRules } from './rules.js';

// Framework-agnostic building blocks shared by the test-runner adapters
// (@mermaid-lint/jest, @mermaid-lint/vitest) and available to anyone who wants
// to lint Mermaid outside a test harness. The adapters keep these out of the
// describe/it layer so the logic stays unit-testable: a function that *defines*
// tests can't be exercised in isolation, but these can.

/** Options for {@link lintMermaidFiles}: discovery plus per-rule severities. */
export interface LintFilesOptions extends DiscoverOptions {
  /** Per-rule severity overrides layered over the defaults (see `resolveRules`). */
  rules?: RulesConfig;
}

/** A single Mermaid block paired with every diagnostic core produced for it. */
export interface MermaidBlockResult {
  block: Block;
  diagnostics: Diagnostic[];
}

/**
 * Discover lintable files and extract their Mermaid blocks — synchronously, with
 * no validation. The test adapters call this during the test runner's
 * synchronous collection phase (one test is then registered per block), so it
 * must not be async.
 *
 * @param opts - Discovery options (see {@link DiscoverOptions}).
 * @returns Every Mermaid block across the discovered files.
 * @public
 */
export function collectMermaidBlocks(opts: DiscoverOptions = {}): Block[] {
  const blocks: Block[] = [];
  for (const file of discoverFiles(opts)) {
    const text = readFileSync(file, 'utf8');
    blocks.push(...extractMermaidBlocks(file, text));
  }
  return blocks;
}

/**
 * Validate every discovered Mermaid block and return the diagnostics per block.
 * This is the composable, returns-data entry point — it registers no tests, so
 * callers (and tests) can assert on the results directly.
 *
 * Diagnostics are unfiltered: both syntax errors (severity `error`) and semantic
 * findings (severity `warning` or `error`, per the resolved rules) are included.
 * Use {@link selectFailures} to apply a `strict` policy.
 *
 * @param opts - Discovery options plus optional per-rule severities.
 * @returns One `{ block, diagnostics }` entry per Mermaid block.
 * @public
 */
export async function lintMermaidFiles(
  opts: LintFilesOptions = {},
): Promise<MermaidBlockResult[]> {
  const { rules, ...discoverOpts } = opts;
  const resolved = resolveRules({ rules });
  const blocks = collectMermaidBlocks(discoverOpts);
  return Promise.all(
    blocks.map(async (block) => ({
      block,
      diagnostics: await blockToDiagnostics(block, resolved),
    })),
  );
}

/**
 * The diagnostics that should fail a test run. Syntax errors and `error`-severity
 * findings always count; `warning`-severity findings count only under `strict`.
 * This matches the `strict` semantics of the remark and textlint adapters.
 *
 * @param diagnostics - Diagnostics for a block (e.g. from {@link lintMermaidFiles}).
 * @param strict - When `true`, `warning`-severity findings also fail.
 * @returns The subset of `diagnostics` that constitute failures.
 * @public
 */
export function selectFailures(
  diagnostics: Diagnostic[],
  strict = false,
): Diagnostic[] {
  return diagnostics.filter(
    (d) => d.severity === 'error' || (strict && d.severity === 'warning'),
  );
}
