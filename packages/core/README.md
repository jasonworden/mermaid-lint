# @mermaid-lint/core

Core extraction, validation, and discovery utilities for [mermaid-lint](https://github.com/jasonworden/mermaid-lint) — the engine that finds Mermaid diagrams in Markdown (and `.mmd`) files, validates them, and reports diagnostics.

ESM-only. Requires **Node >= 20**.

## Install

```sh
npm install @mermaid-lint/core
```

## Public API

### Extraction

| Symbol | Signature | Description |
| --- | --- | --- |
| `extractMermaidBlocks` | `(path, text, options?) => Block[]` | Extract every Mermaid block from a Markdown document, or the whole file as one diagram when `path` ends in `.mmd`. |
| `Block` | `interface` | An extracted diagram: `{ path, line, col, body, type }`. |
| `ExtractOptions` | `interface` | `{ fences?: FenceMarker[] }` — which fence markers to recognize. |

### Validation

| Symbol | Signature | Description |
| --- | --- | --- |
| `validateBlock` | `(block) => Promise<ValidationResult>` | Validate a `Block` end to end: structural checks, semantic warnings, fast Rust parser with a mermaid.js fallback. |
| `validateWithMermaidJS` | `(body) => Promise<{ ok: true } \| { ok: false; error: ValidationError }>` | Validate raw diagram source with the bundled mermaid.js parser (authoritative). |
| `ValidationResult` | `type` | `{ ok: true; warnings } \| { ok: false; error; warnings }`. |
| `ValidationError` | `interface` | `{ message, line?, col? }`. |
| `checkSemantics` | `(block) => SemanticWarning[]` | Run semantic checks (currently duplicate flowchart node ids). |
| `SemanticWarning` | `interface` | `{ rule, message, line? }`. |

### Diagnostics adapter

| Symbol | Signature | Description |
| --- | --- | --- |
| `lintMarkdown` | `(path, text, options?) => Promise<Diagnostic[]>` | Main entry point for tool integrations: extract + validate a document, returning all diagnostics with absolute coordinates. |
| `blockToDiagnostics` | `(block) => Promise<Diagnostic[]>` | Validate one block and return its diagnostics with document-absolute coordinates. |
| `Diagnostic` | `interface` | `{ line, column, message, ruleId, severity }`. |
| `Severity` | `type` | `'error' \| 'warning'`. |

### Discovery

| Symbol | Signature | Description |
| --- | --- | --- |
| `discoverFiles` | `(opts?) => string[]` | Discover lintable files (git-tracked markdown family by default). |
| `DiscoverOptions` | `interface` | `{ root?, all?, paths?, ignore?, noGitignore?, extensions? }`. |

### Type detection

| Symbol | Signature | Description |
| --- | --- | --- |
| `detectDiagramType` | `(body) => string` | Detect a diagram's type keyword (e.g. `'flowchart'`), or `'unknown'`. |

### Config

| Symbol | Signature | Description |
| --- | --- | --- |
| `loadConfig` | `(cwd?) => Promise<MermaidLintConfig>` | Load config via lilconfig (`.mermaidlintrc*`, `mermaid-lint.config.*`, or `package.json#mermaidLint`). |
| `MermaidLintConfig` | `interface` | `{ files?, ignore?, strict?, semantic?, format?, extensions?, fences? }`. |

### Fix

| Symbol | Signature | Description |
| --- | --- | --- |
| `fixText` | `(src, opts?) => string` | Auto-fix common Mermaid mistakes (arrow normalization, missing sequence colons, unclosed fences). |
| `FixOptions` | `interface` | `{ path?, fences? }`. |

### Fences

| Symbol | Signature | Description |
| --- | --- | --- |
| `isFenceMarker` | `(value) => value is FenceMarker` | Type guard for a recognized fence-marker name. |
| `ALL_FENCE_MARKERS` | `readonly FenceMarker[]` | The default marker set: `['backtick', 'tilde']`. |
| `FenceMarker` | `type` | `'backtick' \| 'tilde'`. |

## Usage

### Lint a Markdown document

```ts
import { lintMarkdown } from '@mermaid-lint/core';
import { readFile } from 'node:fs/promises';

const path = 'README.md';
const text = await readFile(path, 'utf8');

const diagnostics = await lintMarkdown(path, text);
for (const d of diagnostics) {
  console.log(`${path}:${d.line}:${d.column} [${d.severity}] ${d.message} (${d.ruleId})`);
}
```

### Extract and validate blocks individually

```ts
import { extractMermaidBlocks, validateBlock } from '@mermaid-lint/core';

const blocks = extractMermaidBlocks('diagram.md', text);
for (const block of blocks) {
  const result = await validateBlock(block);
  if (!result.ok) {
    console.error(`Invalid ${block.type} block at line ${block.line}: ${result.error.message}`);
  }
  for (const warning of result.warnings) {
    console.warn(`${warning.rule}: ${warning.message}`);
  }
}
```

## API reference

Full generated API reference: https://docs.mermaidlint.com
