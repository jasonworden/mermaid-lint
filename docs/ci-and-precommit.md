# CI & pre-commit

mermaid-lint only requires [Node.js ≥20](node-support.md) — it works in any
project regardless of language. This page collects recipes for running it in CI
and as a pre-commit hook.

## Non-JavaScript projects (Python / Go / Rust / …)

mermaid-lint runs via `npx` without adding it to your project's dependencies:

```bash
# Validate all Markdown in a docs/ folder
npx mermaid-lint "docs/**/*.md"

# Scan everything recursively (no git required)
npx mermaid-lint --all

# Machine-readable output for CI scripts (see docs/json-output.md)
npx mermaid-lint --format json --all | python -c "
import sys, json
out = json.load(sys.stdin)
if out['summary']['errors']:
    for f in out['files']:
        for d in f['diagrams']:
            if not d['ok']:
                print(f\"{f['path']}:{d['line']}: {d['error']['message']}\")
    sys.exit(1)
"
```

The JSON schema is documented in [docs/json-output.md](json-output.md).

## Pre-commit hook (any language)

Using [`pre-commit`](https://pre-commit.com):

```yaml
# .pre-commit-config.yaml
repos:
  - repo: local
    hooks:
      - id: mermaid-lint
        name: Validate Mermaid diagrams
        language: node
        entry: npx mermaid-lint
        types: [markdown]
        pass_filenames: true
```

## Pre-commit hook (Node.js / JavaScript projects)

Use [husky](https://typicode.github.io/husky/) +
[lint-staged](https://github.com/lint-staged/lint-staged) to run mermaid-lint on
only the staged Markdown files before every commit.

```bash
npm install --save-dev husky lint-staged
npx husky init
```

Add to `package.json`:

```json
{
  "lint-staged": {
    "*.{md,mmd,mdx}": "mermaid-lint"
  }
}
```

Set `.husky/pre-commit` to:

```sh
npx lint-staged
```

lint-staged passes staged file paths as positional arguments — mermaid-lint
validates each file directly.

## GitHub Actions

```yaml
- uses: jasonworden/mermaid-lint-action@v1
  with:
    files: 'docs/**/*.md **/*.mmd'
    strict: true
```

See [mermaid-lint-action](https://github.com/jasonworden/mermaid-lint-action)
for full options and inline PR annotation support.
