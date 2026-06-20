# @mermaid-lint/cli

Validate Mermaid diagrams embedded in Markdown files. Uses the official `mermaid.parse()` API — catches real syntax errors, not just missing diagram-type keywords.

**[Full docs and examples →](https://github.com/jasonworden/mermaid-lint)**

## Install

```bash
npm install --save-dev @mermaid-lint/cli
# or use without installing:
npx mermaid-lint
```

## Usage

```bash
mermaid-lint                        # validate git-tracked *.md / *.mdx / *.markdown / *.mmd
mermaid-lint --all                  # scan every supported file on disk
mermaid-lint "docs/**/*.md"         # glob pattern (quoted to prevent shell expansion)
mermaid-lint --ext crv              # also discover *.crv files (Carve, etc.)
mermaid-lint docs/page.crv          # explicitly-named files lint regardless of extension
mermaid-lint --quiet                # failures only
mermaid-lint --format json          # machine-readable JSON output
mermaid-lint --strict               # treat semantic warnings as errors (exit 1)
mermaid-lint --no-semantic          # skip semantic checks (syntax errors only)
```

**Exit codes:** `0` = all valid · `1` = validation failures (or warnings with `--strict`) · `2` = usage/IO error

## Configuration

Drop a `mermaid-lint.config.js` in your project root:

```js
export default {
  files: ['docs/**/*.md', '**/*.mmd'],
  ignore: ['dist/**'],
  extensions: ['crv'], // extra extensions for discovery, beyond .md/.mdx/.markdown/.mmd
  strict: false,
  semantic: true,
  format: 'text',
};
```

## Pre-commit hook

```bash
npm install --save-dev husky lint-staged
npx husky init
```

`package.json`:
```json
{
  "lint-staged": {
    "*.{md,mmd,mdx}": "mermaid-lint"
  }
}
```

`.husky/pre-commit`:
```sh
npx lint-staged
```
