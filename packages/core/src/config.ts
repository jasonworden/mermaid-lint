import { lilconfig } from 'lilconfig';
import type { FenceMarker } from './fences.js';
import type { RulesConfig } from './rules.js';

/**
 * Resolved mermaid-lint configuration, as loaded from a config file or the
 * `mermaidLint` field in `package.json`.
 *
 * @public
 */
export interface MermaidLintConfig {
  /** Glob patterns of files to lint. */
  files?: string[];
  /** Glob patterns to exclude. */
  ignore?: string[];
  /** Treat semantic warnings as errors. */
  strict?: boolean;
  /** Enable semantic checks (e.g. duplicate-id detection). */
  semantic?: boolean;
  /**
   * Per-rule severity overrides (`"off"` | `"warn"` | `"error"`), layered over
   * the built-in defaults. E.g. `{ "prefer-flowchart": "off", "duplicate-ids":
   * "error" }`. Ignored when `semantic` is `false` (which disables every rule).
   */
  rules?: RulesConfig;
  /** Output format for the CLI. */
  format?: 'text' | 'json';
  /**
   * Extra file extensions to include in auto-discovery, beyond the built-in
   * markdown family (`.md`, `.mdx`, `.markdown`, `.mmd`). E.g. `["crv"]` to
   * lint Mermaid fences in Carve files. Merges with the `--ext` CLI flag.
   */
  extensions?: string[];
  /**
   * Which code-fence markers to recognize for Mermaid blocks. Defaults to both
   * `"backtick"` (```` ```mermaid ````) and `"tilde"` (`~~~mermaid`), matching
   * CommonMark. Restrict to e.g. `["backtick"]` to ignore tilde fences.
   */
  fences?: FenceMarker[];
}

/**
 * Search for and load a mermaid-lint config via lilconfig (`.mermaidlintrc*`,
 * `mermaid-lint.config.*`, or the `mermaidLint` key in `package.json`),
 * starting from `cwd` and walking up. Returns `{}` when none is found.
 *
 * @param cwd - Directory to begin the search from. Defaults to the process cwd.
 * @returns The resolved {@link MermaidLintConfig} (empty if none found).
 * @public
 */
export async function loadConfig(cwd?: string): Promise<MermaidLintConfig> {
  const result = await lilconfig('mermaid-lint', {
    searchPlaces: [
      'package.json',
      '.mermaidlintrc',
      '.mermaidlintrc.json',
      '.mermaidlintrc.js',
      '.mermaidlintrc.cjs',
      '.mermaidlintrc.mjs',
      'mermaid-lint.config.js',
      'mermaid-lint.config.cjs',
      'mermaid-lint.config.mjs',
    ],
    packageProp: 'mermaidLint',
  }).search(cwd);
  return result?.config ?? {};
}
