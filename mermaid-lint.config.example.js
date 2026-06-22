// mermaid-lint.config.example.js
// Copy to mermaid-lint.config.js (or .mermaidlintrc.json) and customise.
// CLI flags always override config values.
// Docs: https://github.com/jasonworden/mermaid-lint

/** @type {import('@mermaid-lint/core').MermaidLintConfig} */
export default {
  // Glob patterns to validate. Defaults to git-tracked *.md / *.mdx / *.markdown / *.mmd.
  // Only used when no file paths are passed on the command line and --all is not set.
  // files: ['docs/**/*.md', '**/*.mmd'],
  // Glob patterns to exclude from validation.
  // ignore: ['node_modules/**', 'dist/**', 'coverage/**'],
  // Extra extensions for auto-discovery, beyond .md/.mdx/.markdown/.mmd. Accepts
  // 'crv' or '.crv'. Merges with the --ext CLI flag. Files named explicitly on
  // the command line are always linted, regardless of extension.
  // extensions: ['crv'],
  // Treat warn-severity findings as errors (exit 1). Default: false.
  // strict: true,
  // Set to false to disable ALL semantic rules (syntax errors only). Default: true.
  // semantic: true,
  // Per-rule severity ('off' | 'warn' | 'error'), layered over the defaults.
  // Most rules default to 'warn'; 'duplicate-ids' defaults to 'error' and
  // 'no-orphan-nodes' defaults to 'off' (opt-in).
  // rules: {
  //   'prefer-flowchart': 'warn',     // legacy `graph` keyword → prefer `flowchart`
  //   'require-direction': 'warn',    // `flowchart`/`graph` with no direction
  //   'no-experimental': 'warn',      // `*-beta` diagram types (unstable syntax)
  //   'duplicate-ids': 'error',       // same node id, conflicting labels
  //   'no-duplicate-edges': 'warn',   // same edge defined twice (renders stacked)
  //   'no-self-loop': 'warn',         // a node with an edge to itself (`A --> A`)
  //   'no-empty-labels': 'warn',      // a node with an empty label (`A[ ]`)
  //   'no-orphan-nodes': 'off',       // declared but unconnected node (opt-in)
  //   'no-activate-without-deactivate': 'warn', // unbalanced sequence activate/deactivate
  //   'prefer-explicit-participants': 'off',    // participant used before declaration (opt-in)
  //   'no-duplicate-methods': 'warn', // same method signature twice on one class
  // },
  // Output format: 'text' (human-readable, default) or 'json' (machine-readable).
  // format: 'text',
  // Code-fence markers to recognize. Default: ['backtick', 'tilde'] (CommonMark).
  // 'backtick' → ```mermaid … ```   'tilde' → ~~~mermaid … ~~~
  // Restrict to ['backtick'] to ignore tilde fences.
  // fences: ['backtick', 'tilde'],
};
