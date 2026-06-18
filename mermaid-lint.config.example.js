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
  // Treat semantic warnings (e.g. duplicate node IDs) as errors. Default: false.
  // strict: true,
  // Set to false to disable semantic checks entirely (syntax errors only). Default: true.
  // semantic: true,
  // Output format: 'text' (human-readable, default) or 'json' (machine-readable).
  // format: 'text',
};
