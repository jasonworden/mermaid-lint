# Release history

This is a selective map of the releases that most changed what mermaid-lint is
or how people use it. It is intentionally not a full changelog.

```mermaid
timeline TD
  title mermaid-lint
  v0.1 : CLI + core extraction
  v0.2 : Globs, .mdx/.mmd, JSON output
  v0.5 : Rust WASM fast path + JS fallback parity harness
  v0.6 : GitHub Action
  v0.7 : stdin, --include/--exclude, --no-gitignore
  v0.9 : remark / unified plugin
  v0.10 : markdownlint custom rule
  v0.11 : VS Code extension
  v0.12 : custom file extensions (--ext)
  v0.13 : shared markdown adapter + textlint rule
  v0.14 : CommonMark fence support + hosted API docs
  v0.17 : broader semantic rule set + per-rule severity
  v0.23 : adapter parity rollup: per-rule config + host autofix coverage across the Markdown integrations
  v0.34 : expanded semantic coverage (journey, timeline, C4Context) + docs consistency guards
```

## What belongs here

Add an entry when a release materially changes mermaid-lint's user-facing
capabilities, integrations, validation model, or maintenance surface.

Good candidates:

- a new integration surface such as the GitHub Action, VS Code extension, or a
  new lint/test runner adapter
- a validation-model change such as the Rust fast path, semantic rules, or a
  new family of supported diagram checks
- a docs or distribution milestone that changes how the project is consumed or
  maintained

## Maintenance

Not every release needs an entry. This page is for notable releases, not for
every minor, patch, or follow-up housekeeping version.

A `vx.y.z` entry can act as a rollup of everything notable since the last
version that already has an entry here; it does not need to represent only
changes shipped in exactly that one version.

When a release is notable enough to change how people describe mermaid-lint in
docs, demos, or release notes, add or update a short entry here in the same
patch.
