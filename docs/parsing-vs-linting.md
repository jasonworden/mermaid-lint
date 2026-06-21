# Parsing / compiling vs. linting

> A short conceptual guide to *why* `mermaid-lint` is built the way it is, and
> to the two very different questions a tool can ask about a piece of source.
> Written for learning and reasoning about the codebase — not API reference.

## Two different questions

Every tool that "checks" source code is really asking one (or both) of two
questions, and they are not the same:

| Question | Discipline | Failure means | Analogy |
|---|---|---|---|
| **"Is this well-formed?"** | Parsing / compiling | The input does not conform to the grammar — the tool literally cannot build a model of it. | `gcc` rejecting `int x = ;` |
| **"Is this *good*?"** | Linting | The input parses fine, but violates a higher-level rule of style, clarity, or semantics. | ESLint flagging an unused variable |

A useful way to hold it: **parsing decides whether a program *exists*; linting
critiques a program that already exists.** You cannot meaningfully lint what you
cannot parse — so parsing comes first, and a parse failure short-circuits the
rest.

## How a compiler frontend frames it

Classic compiler construction splits the "front end" into stages:

```
source text
   │  lexing        → tokens          ("words")
   │  parsing       → AST / CST       ("sentences" — grammar checked here)
   │  semantic pass → annotated tree  ("meaning" — types, scopes, references)
   ▼
intermediate representation → … → output
```

- **Lexing + parsing** answer *"is it well-formed?"*. A syntax error is raised
  here. The output is a tree (AST = abstract, or CST = concrete/lossless).
- **Semantic analysis** runs *after* a successful parse and answers questions
  the grammar can't: "is this variable declared?", "do these types match?".

A **linter** is essentially a tool that stops after parsing, walks the tree, and
applies a library of *opinions* — rules that are not required for the program to
exist, but that catch bugs and enforce consistency. ESLint, markdownlint,
remark-lint, and textlint are all "parse, then walk the tree and complain".

## How `mermaid-lint` maps onto this

`mermaid-lint` validates Mermaid diagrams, and it deliberately separates the two
questions. The pipeline lives in
[`packages/core/src/validate.ts`](../packages/core/src/validate.ts):

```
diagram body
   │
   ├── 1. PARSE (well-formed?) ────────────────────────────────
   │      merman  (Rust → WASM, fast)        validate.ts → merman.ts
   │        │  valid?  ── yes ──▶ accept (fast path)
   │        │  no / unsupported / panic
   │        ▼
   │      mermaid.js  (the real parser, authoritative)
   │        parse(body) throws ──▶ syntax error  { message, line, col }
   │
   └── 2. LINT (any smells?) ──────────────────────────────────
          checkSemantics(block)                semantic.ts
            e.g. duplicate node IDs ──▶ warning  { rule, message, line }
```

Two layers, two meanings:

1. **Parsing / "does it compile?"** — Stage 1 is a two-tier parser. **merman**
   ([`merman.ts`](../packages/core/src/merman.ts)) is a fast Rust/WASM parser
   used as a fast path; when it can't give a confident *valid* verdict,
   `mermaid-lint` falls back to **mermaid.js itself**, which is authoritative
   (it's the same parser the renderer uses). A failure here is a **syntax error**
   (`severity: 'error'`) — the diagram is malformed and would not render.

2. **Linting / "is it good?"** — Stage 2,
   [`checkSemantics`](../packages/core/src/semantic.ts), runs rules over a
   diagram that *does* parse: duplicate IDs with conflicting labels, and similar
   smells. These are **warnings** (`severity: 'warning'`) — the diagram renders,
   but something is probably wrong. They're opt-in via `strict` mode in the
   editor/lint integrations because they're advisory, not fatal.

The shared [`markdown-adapter.ts`](../packages/core/src/markdown-adapter.ts)
normalizes both into one `Diagnostic` shape (`error` | `warning`), so every
integration reports them consistently.

## Why this distinction drives the integration design

The parse step is **expensive and asynchronous**: mermaid.js needs a DOM
(`mermaid-lint` bootstraps `jsdom`) and is imported and run dynamically; even the
WASM parser initializes asynchronously. That single fact decides which host
linters `mermaid-lint` can plug into:

| Host | Rule model | Can it run our parser? |
|---|---|---|
| **markdownlint** | async custom rules | ✅ yes |
| **remark-lint** | async transforms | ✅ yes |
| **textlint** | rule may return a Promise | ✅ yes |
| **ESLint** | **synchronous** rules only | ❌ no — async parse can't run inside a rule ([#39](https://github.com/jasonworden/mermaid-lint/issues/39)) |
| **Biome** | GritQL *pattern matching*; no Markdown linting yet | ❌ no — can't invoke an external async validator ([#38](https://github.com/jasonworden/mermaid-lint/issues/38)) |

The pattern to notice: a host linter can only delegate to `mermaid-lint` if its
*own* rule execution model can await an async parse. ESLint and Biome treat a
rule as a synchronous tree-walk (the "lint" half of the picture) and have no
hook for "go parse this embedded sub-language with a heavyweight async parser
first". That's not a Mermaid limitation — it's the parsing/linting boundary
showing up in tooling architecture.

## Takeaways

- **Parse before you lint.** Well-formedness is a precondition for every other
  check; a parse error is categorically different from a style warning.
- **Errors vs. warnings mirror compile-vs-lint.** In `mermaid-lint`, syntax =
  error (won't render), semantics = warning (renders, but suspect).
- **Async parsing is the architectural pivot.** Whether a linter can host
  `mermaid-lint` comes down to whether its rule model can await the parse — the
  same reason `textlint` works and `ESLint` (today) cannot.
