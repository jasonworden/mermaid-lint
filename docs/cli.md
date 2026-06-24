# CLI

`mermaid-lint` runs through `npx`, so projects can validate Mermaid diagrams
without adding a dependency:

```bash
npx mermaid-lint
```

By default, the CLI validates git-tracked `.md`, `.mdx`, `.markdown`, and `.mmd`
files. It exits with `0` when all diagrams are valid, `1` when validation fails
(or warnings are promoted by `--strict`), and `2` for usage or IO errors.

## Common Commands

```bash
npx mermaid-lint                        # validate git-tracked supported files
npx mermaid-lint --all                  # scan every supported file on disk
npx mermaid-lint "docs/**/*.md"         # lint a quoted glob pattern
npx mermaid-lint --include "docs/**/*.md" --exclude "docs/archive/**"
npx mermaid-lint --ext crv              # also discover *.crv files
npx mermaid-lint docs/page.crv          # explicitly named files always lint
npx mermaid-lint -                      # read Markdown from stdin
npx mermaid-lint --no-gitignore         # include gitignored files
npx mermaid-lint --quiet                # print failures only
npx mermaid-lint --format json          # machine-readable output
npx mermaid-lint --strict               # treat semantic warnings as errors
npx mermaid-lint --no-semantic          # skip semantic checks
npx mermaid-lint --fix                  # autofix mechanical issues
npx mermaid-lint --fix "docs/**/*.md"   # autofix only matching files
```

## Discovery

When no paths are passed, discovery uses `git ls-files` for:

- `.md`
- `.mdx`
- `.markdown`
- `.mmd`

Use `--all` to scan the filesystem instead, `--ext <ext>` to add supported
extensions, or explicit file paths to lint a file regardless of extension.

## Output

Text output points at the source file, line, column, severity, parser message,
and detected diagram type:

```text
docs/architecture.md:42:5: error: Expecting 'SPACE', got 'TXT' (sequenceDiagram)
```

JSON output is documented in [json-output.md](json-output.md).

## Autofix

`--fix` applies only mechanical, meaning-preserving corrections:

- Normalize flowchart arrows such as `->` to `-->`.
- Insert missing sequence-message colons.
- Close unclosed Markdown code fences when the CLI owns the file rewrite.

Semantic findings are reported but never auto-changed.

## Non-JavaScript Projects

Only Node.js 20 or newer is required. See
[ci-and-precommit.md](ci-and-precommit.md) for Python, Go, Rust, pre-commit,
husky, lint-staged, and CI recipes.
