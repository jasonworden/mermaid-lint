# Releasing & publishing

This repo ships to **three** registries from **two** toolchains:

| Artifact | Registry | Tool | Trigger |
|---|---|---|---|
| `@mermaid-lint/{core,cli,vitest,jest,remark,markdownlint}` | npm | `pnpm publish` (CI) | git **version tag** |
| `mermaid-lint-vscode` | VS Code Marketplace | [`vsce`](https://github.com/microsoft/vscode-vsce) | manual |
| `mermaid-lint-vscode` | [Open VSX](https://open-vsx.org) | [`ovsx`](https://github.com/eclipse/openvsx/tree/master/cli) | manual |

The extension is **not** on npm (it's `"private": true`) and the libraries are
**not** extensions — so the two toolchains never overlap. The only ordering
constraint is: **publish `@mermaid-lint/core` to npm before building the
`.vsix`**, because the `.vsix` installs core from npm (see
[`README.md`](README.md#packaging--publishing)).

> **Versions are independent.** The npm libraries share one version (`core`,
> `cli`, … all move together on a tag). `mermaid-lint-vscode` carries its **own**
> version in [`package.json`](package.json) and is bumped on its own cadence
> (e.g. an icon-only change bumps just the extension). When building a `.vsix`,
> pin it to a *published* core version with `--core-version`.

---

## 1. Publish the npm libraries (tag-triggered)

The monorepo publishes `@mermaid-lint/*` to npm from CI when you push a version
tag. Bump, tag, push:

```bash
# from the repo root, on an up-to-date main
git tag v0.11.0
git push origin v0.11.0     # CI runs `pnpm -r publish` → npm
```

Verify (bypassing any local registry mirror such as a corporate Nexus in
`.npmrc`):

```bash
npm view @mermaid-lint/core version --registry=https://registry.npmjs.org/
```

If a tag's publish was missed, re-pushing the **same** tag re-triggers the
workflow; npm rejects a re-publish of an already-published version, so this is
safe.

---

## 2. Build the extension `.vsix`

Core must already be on npm (step 1). Then:

```bash
pnpm install
pnpm --filter mermaid-lint-vscode package
# → packages/vscode/mermaid-lint-vscode-<version>.vsix
```

`scripts/package-vsix.sh` stages a clean directory, rewrites the
`@mermaid-lint/core: workspace:*` dependency to the published version, runs a
flat `npm install --omit=dev` (pnpm's symlinked `node_modules` can't be packaged
by `vsce`), then `vsce package`. Override the core version for a test build with
`--core-version <ver>`.

Sanity-check the bundle before publishing:

```bash
pnpm --filter mermaid-lint-vscode exec vsce ls    # files that will ship
```

---

## 3. Publish to the VS Code Marketplace (`vsce`)

Requires a **publisher** (`mermaid-lint`) and an Azure DevOps **Personal Access
Token** with the *Marketplace → Manage* scope. See
[Publishing Extensions](https://code.visualstudio.com/api/working-with-extensions/publishing-extension).

```bash
pnpm --filter mermaid-lint-vscode exec vsce publish \
  --packagePath packages/vscode/mermaid-lint-vscode-<version>.vsix \
  --pat "$VSCE_PAT"
```

The Marketplace re-verifies the listing after upload; the new version usually
goes live within a minute or two. Confirm:

```bash
pnpm --filter mermaid-lint-vscode exec vsce show mermaid-lint.mermaid-lint-vscode
```

---

## 4. Publish to Open VSX (`ovsx`)

Open VSX is the registry used by Cursor, VSCodium, Windsurf, Gitpod, and other
non-Microsoft VS Code builds. It takes the **same** `.vsix` and the **same**
install id (`mermaid-lint.mermaid-lint-vscode`), with a separate account/token
from [open-vsx.org](https://open-vsx.org).

The token is stored in **1Password** under the item **`open-vsx.org Access
Token`** (field: `credential`). Retrieve it at publish time — never paste the
value into a file or shell history:

```bash
# requires the 1Password CLI (`op`), signed in
OVSX_TOKEN="$(op item get 'open-vsx.org Access Token' --fields credential --reveal)"

npx ovsx publish \
  packages/vscode/mermaid-lint-vscode-<version>.vsix \
  --pat "$OVSX_TOKEN"

unset OVSX_TOKEN
```

> **First publish only:** the `mermaid-lint` namespace must exist on Open VSX —
> `npx ovsx create-namespace mermaid-lint --pat "$OVSX_TOKEN"` (idempotent).

Confirm: <https://open-vsx.org/extension/mermaid-lint/mermaid-lint-vscode>

### Is it safe to name the 1Password item in this public repo?

**Yes.** The item *name* (`open-vsx.org Access Token`) is a label — a pointer to
where the secret lives, not the secret itself. The token *value* never leaves
1Password and is only ever held in a shell variable at publish time. Recording
where credentials live (so the next release doesn't hardcode them) is good
hygiene, not a leak. The rule that matters: **never commit a token value** — not
the PAT, not the Open VSX token, not anything from `op ... --reveal`.

---

## Quick checklist for a normal release

- [ ] Bump versions (npm libs via tag; extension via `package.json`).
- [ ] `git tag vX.Y.Z && git push origin vX.Y.Z` → wait for npm publish (step 1).
- [ ] `pnpm --filter mermaid-lint-vscode package` (step 2).
- [ ] `vsce publish --packagePath …` (step 3).
- [ ] `ovsx publish … --pat "$OVSX_TOKEN"` with the token from 1Password (step 4).
- [ ] Verify both listings show the new version and icon.
