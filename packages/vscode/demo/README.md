# mermaid-lint-vscode demo

A tiny, self-contained demo of the extension. These same files are the fixtures
the end-to-end test (`@vscode/test-electron`) asserts against, so the demo can't
drift from what's verified.

| File | Shows |
|---|---|
| `demo.md` | A valid and an invalid ` ```mermaid ` block in one Markdown file |
| `bad.mmd` | A standalone `.mmd` diagram with a syntax error |
| `good.md` | A valid block (used by the test to assert "no false positives") |

## Run the demo

From the repo root, with the extension built (`pnpm install && pnpm -r build`):

**Option A — terminal (no config needed):**

```bash
code --extensionDevelopmentPath="$PWD/packages/vscode" --disable-extensions \
  "$PWD/packages/vscode/demo"
```

**Option B — F5:** open the repo root in VS Code → Run and Debug →
"Run mermaid-lint-vscode (Extension Host)" → `F5`. A second window opens with
this `demo/` folder loaded.

In the **[Extension Development Host]** window:

1. Open **`demo.md`** — the second block (`A -->|broken label B`) shows a red
   squiggle; hover it for the parse error; check **View → Problems**.
2. Open **`bad.mmd`** — squiggle on line 2 (`.mmd` coverage, which the
   markdownlint rule cannot provide).
3. **Quick-fix:** cursor in a fixable block → `Cmd .` → "Fix auto-fixable
   Mermaid issues".
4. **On-type:** break a valid block and watch the squiggle appear (debounced).

## What it looks like

Invalid block in a Markdown file (`demo.md`):

![Invalid mermaid block in a Markdown file](../media/demo-markdown.png)

Standalone `.mmd` file (`bad.mmd`):

![Invalid standalone .mmd file](../media/demo-mmd.png)
