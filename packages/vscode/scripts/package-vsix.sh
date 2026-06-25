#!/usr/bin/env bash
#
# Package mermaid-lint-vscode into a publishable .vsix.
#
# The extension does NOT bundle @mermaid-lint/core (it pulls in jsdom + merman,
# which esbuild can't bundle), so the .vsix must ship core + its dependency tree
# as a flat, symlink-free node_modules. pnpm's symlinked node_modules can't be
# packaged by vsce, so we stage a clean directory and install core from npm with
# plain `npm install`. This means the matching @mermaid-lint/core version must be
# PUBLISHED to npm first (merge a version bump to `main` → release.yml publishes
# npm, then creates v<version> and a GitHub Release).
#
# Usage:
#   scripts/package-vsix.sh [--core-version <ver>] [--out <dir>]
#
#   --core-version <ver>  @mermaid-lint/core version to depend on (default: this
#                         package's own version). Must exist on npm.
#   --out <dir>           Directory to write the .vsix into (default: package root).
#
# Publishing the produced .vsix is a separate manual step (needs a Marketplace
# publisher + PAT):  vsce publish --packagePath <file>.vsix   (see README).

set -euo pipefail

readonly SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" &>/dev/null && pwd -P)"
readonly PKG_DIR="$(cd "${SCRIPT_DIR}/.." &>/dev/null && pwd -P)"

STAGING=""

msg_info() { echo "• $*" >&2; }
msg_err() { echo "ERROR: $*" >&2; }
die() { msg_err "$*"; exit 1; }

usage() {
  sed -n '3,22p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
}

cleanup() {
  local code=$?
  if [[ -n "${STAGING}" && -d "${STAGING}" ]]; then
    rm -rf "${STAGING}"
  fi
  exit "${code}"
}

check_required_binaries() {
  local missing=()
  local bin
  for bin in node npm; do
    if ! command -v "${bin}" &>/dev/null; then
      missing+=("${bin}")
    fi
  done
  if [[ ${#missing[@]} -gt 0 ]]; then
    die "missing required binaries: ${missing[*]}"
  fi
}

# Locate the vsce binary installed in this package's devDependencies, falling
# back to npx so the script works even from a fresh checkout.
find_vsce() {
  if [[ -x "${PKG_DIR}/node_modules/.bin/vsce" ]]; then
    echo "${PKG_DIR}/node_modules/.bin/vsce"
  else
    echo "npx @vscode/vsce"
  fi
}

parse_params() {
  CORE_VERSION=""
  OUT_DIR="${PKG_DIR}"
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --core-version)
        CORE_VERSION="${2:-}"
        shift 2
        ;;
      --out)
        OUT_DIR="${2:-}"
        shift 2
        ;;
      -h | --help)
        usage
        exit 0
        ;;
      *)
        die "unknown argument: $1 (try --help)"
        ;;
    esac
  done
}

main() {
  parse_params "$@"
  check_required_binaries

  local version
  version="$(node -p "require('${PKG_DIR}/package.json').version")"
  if [[ -z "${CORE_VERSION}" ]]; then
    CORE_VERSION="${version}"
  fi

  msg_info "Packaging mermaid-lint-vscode@${version} (core ^${CORE_VERSION})"

  msg_info "Building extension bundle…"
  (cd "${PKG_DIR}" && node esbuild.mjs >/dev/null)
  if [[ ! -f "${PKG_DIR}/dist/extension.cjs" ]]; then
    die "build did not produce dist/extension.cjs"
  fi

  STAGING="$(mktemp -d)"
  trap cleanup EXIT INT TERM
  msg_info "Staging in ${STAGING}"

  # Stage a publishable package.json: drop dev/scripts/private, and pin core to
  # the published npm version instead of the workspace protocol.
  node -e '
    const fs = require("fs");
    const [src, coreVer, dest] = process.argv.slice(1);
    const pkg = JSON.parse(fs.readFileSync(src, "utf8"));
    delete pkg.devDependencies;
    delete pkg.scripts;
    delete pkg.private;
    // vsce forbids combining a "files" property with a .vscodeignore (we ship
    // the latter), so the npm-only "files" field must go.
    delete pkg.files;
    pkg.dependencies = { ...(pkg.dependencies || {}), "@mermaid-lint/core": "^" + coreVer };
    fs.writeFileSync(dest, JSON.stringify(pkg, null, 2) + "\n");
  ' "${PKG_DIR}/package.json" "${CORE_VERSION}" "${STAGING}/package.json"

  local f
  for f in dist media README.md CHANGELOG.md LICENSE .vscodeignore; do
    if [[ -e "${PKG_DIR}/${f}" ]]; then
      cp -R "${PKG_DIR}/${f}" "${STAGING}/${f}"
    fi
  done

  msg_info "Installing production dependencies (flat) — core@^${CORE_VERSION} from npm…"
  if ! (cd "${STAGING}" && npm install --omit=dev --no-audit --no-fund >/dev/null 2>&1); then
    die "npm install failed — is @mermaid-lint/core@^${CORE_VERSION} published to npm? (merge the matching version bump to main so release.yml can publish it first)"
  fi

  mkdir -p "${OUT_DIR}"
  local vsix="${OUT_DIR}/mermaid-lint-vscode-${version}.vsix"
  local vsce
  vsce="$(find_vsce)"

  msg_info "Running vsce package…"
  # No --no-dependencies: we WANT the flat node_modules included in the .vsix.
  (cd "${STAGING}" && ${vsce} package --out "${vsix}")

  msg_info "Done: ${vsix}"
  echo "${vsix}"
}

main "$@"
