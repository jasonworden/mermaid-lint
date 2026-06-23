# JSON output schema

`mermaid-lint --format json` (or `format: 'json'` in the config) emits a
machine-readable report on stdout. Use it to wire mermaid-lint into CI scripts,
dashboards, or other tooling.

```bash
npx mermaid-lint --format json --all
```

## Schema

```json
{
  "version": "0.26.0",
  "files": [
    {
      "path": "docs/api.md",
      "diagrams": [
        { "line": 42, "col": 1, "type": "flowchart", "ok": true,
          "warnings": [{ "rule": "duplicate-ids", "message": "node \"A\" declared with label \"Start\" (line 2) and \"Begin\" (line 7)", "line": 7 }] },
        { "line": 89, "col": 1, "type": "sequenceDiagram", "ok": false,
          "error": { "message": "Expecting 'SPACE'", "line": 2, "col": 5 }, "warnings": [] }
      ]
    }
  ],
  "summary": {
    "files": 5, "diagrams": 12, "ok": 10, "errors": 2, "warnings": 1,
    "types": { "flowchart": 6, "sequenceDiagram": 3, "classDiagram": 3 }
  }
}
```

## Fields

- **`version`** — the mermaid-lint version that produced the report.
- **`files[]`** — one entry per file that contained at least one Mermaid block.
  - **`path`** — the file path.
  - **`diagrams[]`** — one entry per Mermaid block in the file.
    - **`line` / `col`** — 1-indexed position of the fence opener in the file.
    - **`type`** — detected diagram type (e.g. `flowchart`, `sequenceDiagram`).
    - **`ok`** — `true` if the diagram parses.
    - **`error`** — present when `ok` is `false`: `{ message, line, col }` with the
      precise location of the syntax error.
    - **`warnings[]`** — semantic findings: `{ rule, message, line }`. See the
      [semantic rules](../README.md#semantic-rules) for the rule list and how to
      tune severity.
- **`summary`** — totals across all files, plus a `types` histogram.

## Example: fail CI on errors (any language)

```bash
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
