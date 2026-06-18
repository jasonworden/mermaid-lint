# Load the available Node version manager and switch to the version in .nvmrc.
# Supports fnm, nvm, and n — first one found wins.

if [ -x "/opt/homebrew/bin/fnm" ]; then
  eval "$(/opt/homebrew/bin/fnm env --shell bash)"
  fnm use 2>/dev/null || true
elif command -v fnm >/dev/null 2>&1; then
  eval "$(fnm env --shell bash)"
  fnm use 2>/dev/null || true
elif [ -s "$HOME/.nvm/nvm.sh" ]; then
  . "$HOME/.nvm/nvm.sh"
  nvm use 2>/dev/null || true
elif command -v n >/dev/null 2>&1; then
  NODE_VERSION=$(cat .nvmrc 2>/dev/null | tr -d '[:space:]' | sed 's/^v//')
  if [ -n "$NODE_VERSION" ]; then
    n "$NODE_VERSION" 2>/dev/null || true
  fi
fi
