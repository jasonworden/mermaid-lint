# AGENTS.md

Guidance for framework/tool integration docs under `docs/integrations/`.

## Purpose

These guides explain how to use `mermaid-lint` with a specific host tool,
framework, or authoring environment.

Start with what works **today** using the existing `mermaid-lint` packages and
editor integrations. If future tooling would improve the experience, separate
that clearly from the current recommended path.

## File and content conventions

- One guide per host/tool, named `docs/integrations/<name>.md`.
- Keep `docs/integrations/README.md` updated with every new guide.
- Cross-link the new guide from the root [`README.md`](../../README.md) when it
  becomes part of the user-facing docs story.
- Prefer copy-pasteable commands and minimal config snippets.
- Match the surrounding docs style: concise, practical, and explicit about
  limits.

## What every guide should cover

1. Whether the host already supports Mermaid natively.
2. The best current `mermaid-lint` workflow with existing tools.
3. Editor guidance.
4. CI / pre-commit guidance when it materially helps.
5. Limitations or mismatches between the host and `mermaid-lint`.
6. Optional future improvements, clearly labeled as follow-up work.

## Guardrails

- Do not imply first-class support if the integration is just good
  compatibility.
- Do not promise unpublished addons, starter kits, or template repos as if they
  already exist.
- When a host has multiple possible integrations, lead with the lowest-friction
  recommendation and mention the others as alternatives.
