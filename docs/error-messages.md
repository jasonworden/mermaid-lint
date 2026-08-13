# Error messages

> How `mermaid-lint` turns mermaid.js parser failures into messages that name
> the actual defect, instead of the grammar's internal vocabulary.

## The problem

mermaid.js is a grammar-driven parser (mostly jison, with a few diagram types
on Langium). When it rejects a diagram, the error it throws is written for
someone who knows the grammar, not someone who wrote the diagram:

```text
Parse error on line 2:
...ce->>Bob hello there
-----------------------^
Expecting 'TXT', got 'NEWLINE'
```

`TXT` and `NEWLINE` are token classes from the grammar, not words the author
typed. The message is technically correct — the parser wanted the message text
and found the end of the line instead — but it does not say *what a sequence
message needs* (a colon after the arrow), which is what the author actually
needs to know.
Worse, the caret line is frequently misleading: mermaid collapses newlines out
of the diagram before handing it to the parser, so the column the caret
underlines in the *echoed* snippet routinely does not correspond to the real
column in the diagram source the author is looking at.

`mermaid-lint` runs a translation layer,
[`packages/core/src/explain/`](../packages/core/src/explain/), over every
parser failure before it reaches a caller. The translation replaces
`ValidationError.message` (and the equivalent `Diagnostic.message` in
Markdown adapters); mermaid's own text is never discarded, only demoted — see
[Reaching the raw text](#reaching-the-raw-text) below.

## Two tiers

### Tier 1: confirmed diagnoses

Tier 1 is a fixed table of rules, each written for one specific way authors
get a construct wrong — a sequence message with no colon, a single-dash
flowchart arrow, an unclosed node-shape delimiter, and so on. A rule is only
considered when mermaid's *token signature* (the family of error and the
expected/got tokens) matches its shape, and even then it re-reads the actual
source line mermaid blamed and **confirms** the diagnosis before returning
anything. If that re-read doesn't line up — the line doesn't look like what
the rule expects — the rule declines rather than guess, and the failure falls
through to Tier 2.

That confirm-or-decline discipline is the whole design: a rule that names the
wrong defect is worse than mermaid's jargon, because it sounds authoritative.
Declining costs nothing, since Tier 2 is always there to fall back on. Rules
run in a fixed order and the first one that both matches and confirms wins;
several rules can share the same token signature (mermaid produces the same
`expected`/`got` pair for genuinely different mistakes), which is exactly why
the confirm step re-reads the source instead of trusting the signature alone.

A confirmed diagnosis also sometimes carries a `suggestion`: one corrected
version of the exact line the author wrote, for the errors mechanical enough
to have one obvious fix. When a suggestion is guaranteed to be exactly what
`--fix` would write, the error is also marked `fixable`.

### Tier 2: generic cleanup

Everything Tier 1 declines to diagnose still gets a pass through Tier 2, which
does no diagnosis of its own — it never asserts what the author meant. It
rebuilds a plain sentence from mermaid's normalized token signature (`expected
X, found Y`, humanized and capped so a long expected-token list doesn't spill
across the terminal), and drops two things from mermaid's original wording:

- **The caret snippet.** As above, mermaid collapses newlines before parsing,
  so the echoed line-and-caret routinely doesn't correspond to the real
  defect. Printing it would point at the wrong place with false confidence.
- **The `Parse error on line N:` header.** The line is already carried
  structurally (`ValidationError.line` / `Diagnostic.line`), and repeating it
  in prose would introduce a second, sometimes-conflicting coordinate system
  inside a Markdown fence, where only the structured position gets mapped
  from the diagram body to the file.

Tier 2 never returns a `suggestion` — it has confirmed nothing about what the
author meant, so it has nothing safe to propose.

One family is passed through unchanged rather than decluttered: errors a
diagram *module* raises after parsing already succeeded (mindmap's "only one
root", gitGraph's "branch which is not yet created", and similar). That prose
is written for humans already, so the translation layer echoes it byte for
byte.

## Reaching the raw text

The translated `message` is what you normally read, but mermaid's original
text is never thrown away — it is kept, line-number-mapped the same way
`message` used to be, as `error.raw` (`ValidationError.raw` in the core API,
`Diagnostic.raw` in Markdown-adapter output). It shows up in
[JSON output](json-output.md) (`--format json`); the CLI's default text
output does not print it, only the translated `message`, an optional
`(fixable with --fix)` marker, and an optional `did you mean: <suggestion>`
line.

## The rule table

These are the Tier 1 rules shipped today, in the order they run
([`packages/core/src/explain/rules.ts`](../packages/core/src/explain/rules.ts)):

| Rule | Confirms | Example message |
|---|---|---|
| `unknown-diagram-type` | the header's first word isn't a registered diagram-type keyword | `` unknown diagram type `flowchrt`; did you mean `flowchart`? `` |
| `flowchart-bad-direction` | the flowchart header's direction token isn't one of `TB TD BT RL LR v ^ < >` | `` `td` is not a valid flowchart direction; did you mean `TD`? `` |
| `sequence-note-missing-colon` | a `Note over/left of/right of ...` line has no colon before its text | `` `Note` is missing a colon before its text `` |
| `sequence-missing-colon` | a sequence message line (`A->>B ...`) has no colon before its text | `sequence message is missing a colon` |
| `flowchart-single-dash-arrow` | a `->` appears where a flowchart link token was expected | `` `->` is not a flowchart arrow — flowchart arrows need two dashes `` |
| `flowchart-space-in-id` | a bare node id contains a space | `` node id `A B` contains a space — put the text in a label instead `` |
| `flowchart-mismatched-shape` | a node label's opening and closing shape delimiters don't match (`[foo)`) | `` node label opened with `[` is closed with `)` `` |
| `flowchart-unclosed-shape` | a node label's opening shape delimiter has no matching closer | `` node label opened with `[` was never closed `` |
| `flowchart-unquoted-paren` | an unquoted `(` appears inside a node label | `` `(` inside a label needs quoting `` |
| `flowchart-reserved-end` | `end` is used as a bare node id | `` `end` is a reserved word and cannot be used as a node id `` |
| `block-missing-end` | a `subgraph`/`loop`-style block has no matching `end` | `` `subgraph` block was never closed with `end` `` |

Several of these also carry a `suggestion`, and `flowchart-single-dash-arrow`
and `sequence-missing-colon` are marked `fixable` (their suggestion is exactly
what `--fix` writes).

## A growth area

Eleven rules is a starting set, not a ceiling — mermaid's grammars can fail in
far more ways than this table covers today, and every failure Tier 1 doesn't
recognize still gets the Tier 2 declutter rather than raw jargon. New rules
get added over time, but only for a defect shape that has a **reliable
confirming check**: something the rule can verify against the actual source
line, not merely a plausible guess from the token signature. A rule that
cannot tell its diagnosis apart from a similar-looking mistake should stay
out of the table and let Tier 2 handle it honestly.
