# Changelog

## 0.13.0

- Honor the `rules` key from the project's mermaid-lint config file: the editor
  now applies per-rule severity (and can enable off-by-default rules such as
  `no-orphan-nodes`) exactly like the CLI, instead of silently ignoring it.

## 0.11.2

- Marketplace icon: brighter (whitened) brush strokes so the crossed makeup
  brushes read clearly against the red mermaid tail.
- Docs: accurate supported-file description (Markdown `.md`/`.markdown` fenced
  blocks and standalone `.mmd`); Marketplace + Open VSX install badges; release
  runbook in `PUBLISHING.md`.

## 0.11.1

- Added the Marketplace/Open VSX listing icon.

## 0.11.0

- Initial release: live Mermaid validation for `.md` fenced blocks and `.mmd`
  files — inline diagnostics, hover messages, Problems-panel entries, debounced
  on-type validation, project config-file support, and quick-fix code actions
  backed by mermaid-lint's `--fix`.
