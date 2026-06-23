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
| `validateBlock` | `(block, rules?) => Promise<ValidationResult>` | Validate a `Block` end to end: structural checks, semantic warnings (at the given per-rule severities), fast Rust parser with a mermaid.js fallback. |
| `validateWithMermaidJS` | `(body) => Promise<{ ok: true } \| { ok: false; error: ValidationError }>` | Validate raw diagram source with the bundled mermaid.js parser (authoritative). |
| `ValidationResult` | `type` | `{ ok: true; warnings } \| { ok: false; error; warnings }`. |
| `ValidationError` | `interface` | `{ message, line?, col? }`. |
| `checkSemantics` | `(block, rules?) => SemanticWarning[]` | Run the semantic rule set (self-loops, duplicate ids, orphan nodes, sequence/class checks, …) at the given per-rule severities; skips rules resolved to `off`. |
| `SemanticWarning` | `interface` | `{ rule, message, line?, severity }`. |

### Rules

| Symbol | Signature | Description |
| --- | --- | --- |
| `resolveRules` | `(opts?) => ResolvedRules` | Resolve `{ rules?, semantic? }` into a concrete severity for every rule, layered over `RULE_DEFAULTS` (`semantic: false` disables all). |
| `RULE_DEFAULTS` | `ResolvedRules` | The default severity for every rule. |
| `ALL_RULE_IDS` | `RuleId[]` | Every known rule id. |
| `isRuleSeverity` | `(value) => value is RuleSeverity` | Type guard for `'off' \| 'warn' \| 'error'`. |
| `RuleId` | `type` | Union of rule ids (`'duplicate-ids' \| 'no-self-loop' \| …`). |
| `RuleSeverity` | `type` | `'off' \| 'warn' \| 'error'`. |
| `RulesConfig` | `type` | `Partial<Record<RuleId, RuleSeverity>>` — user overrides. |
| `ResolvedRules` | `type` | `Record<RuleId, RuleSeverity>` — a severity for every rule. |
| `EmittedSeverity` | `type` | `'warn' \| 'error'` — the severities a finding can carry. |

### Diagnostics adapter

| Symbol | Signature | Description |
| --- | --- | --- |
| `lintMarkdown` | `(path, text, options?, rules?) => Promise<Diagnostic[]>` | Main entry point for tool integrations: extract + validate a document, returning all diagnostics with absolute coordinates. |
| `blockToDiagnostics` | `(block, rules?) => Promise<Diagnostic[]>` | Validate one block and return its diagnostics with document-absolute coordinates. |
| `Diagnostic` | `interface` | `{ line, column, message, ruleId, severity }`. |
| `Severity` | `type` | `'error' \| 'warning'`. |

### Discovery

| Symbol | Signature | Description |
| --- | --- | --- |
| `discoverFiles` | `(opts?) => string[]` | Discover lintable files (git-tracked markdown family by default). |
| `DiscoverOptions` | `interface` | `{ root?, all?, paths?, ignore?, noGitignore?, extensions? }`. |

### File linting

| Symbol | Signature | Description |
| --- | --- | --- |
| `collectMermaidBlocks` | `(opts?) => Block[]` | Synchronously discover files and extract their Mermaid blocks (no validation) — useful when a caller must register work during a synchronous phase. |
| `lintMermaidFiles` | `(opts?) => Promise<MermaidBlockResult[]>` | Discover, extract, and validate; returns the diagnostics per block. The composable, returns-data entry point used by the jest/vitest adapters. |
| `selectFailures` | `(diagnostics, strict?) => Diagnostic[]` | The diagnostics that should fail a run: `error`-severity always; `warning`-severity only under `strict`. |
| `LintFilesOptions` | `interface` | `DiscoverOptions & { rules? }`. |
| `MermaidBlockResult` | `interface` | `{ block, diagnostics }`. |

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
