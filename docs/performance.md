# Performance

mermaid-lint uses a two-tier parser:

- `@mermanjs/web` (Rust/WASM) handles the fast path.
- `mermaid.parse()` loads only when the fast path reports an error, so
  mermaid.js remains the authoritative fallback for final verdicts and precise
  line/column diagnostics.

This avoids paying the mermaid.js + jsdom startup cost for valid diagrams.

## Benchmarks

Benchmarks run on Apple M4 Max (64 GB), Node.js 22. Test input: one Markdown
file with the given number of flowchart diagrams. About one third contain
duplicate-ID conflicts, and all are syntactically valid. Values are total
milliseconds with milliseconds per diagram in parentheses.

| Diagrams | mermaid-lint v0.3.0 | mermaid-lint v0.5.0 |
|---|---|---|
| 10 | - | 108 ms (10.8 ms/d) |
| 50 | 407 ms (8.1 ms/d) | 121 ms (2.4 ms/d) |
| 200 | 553 ms (2.8 ms/d) | 159 ms (0.8 ms/d) |
| 1000 | 1018 ms (1.0 ms/d) | 260 ms (0.3 ms/d) |
| 10000 | 6643 ms (0.7 ms/d) | 1699 ms (0.2 ms/d) |
| 100000 | 62734 ms (0.63 ms/d) | 15590 ms (0.16 ms/d) |

v0.5.0 is 3.4-4.0x faster than v0.3.0 on this benchmark. The fixed startup
cost is replaced by about 100 ms of WASM initialization plus about 0.1 ms per
diagram on the happy path.

For files with parse errors, both runtimes load. That path is slower by design
because mermaid.js provides the canonical parser verdict and error locations.

A narrow subset of that path costs more still. Some failures are not parse
errors at all — a diagram module's own post-parse checks, such as mindmap's
"only one root" or gitGraph's unknown-branch `checkout` — and mermaid attaches
no position to them. mermaid-lint recovers one by re-parsing prefixes of the
diagram to find the line that first provokes the same error, which costs
`log2(lines)` extra parses (about ten for a thousand-line diagram). It runs only
for errors that carry no position from any other signal, and never for a valid
diagram.

## Accuracy Checks

Parser parity is enforced in CI. The test set includes 24+ valid and 10+
invalid diagrams across major Mermaid diagram types. CI fails if merman accepts
a diagram that mermaid.js rejects.

## Reproduce

```bash
pnpm bench
```
