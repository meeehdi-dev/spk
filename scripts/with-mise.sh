#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."

if command -v mise >/dev/null 2>&1; then
  spk_mise=$(command -v mise)
else
  spk_mise="$HOME/.local/bin/mise"
  if [[ ! -x "$spk_mise" ]]; then
    spk_installer=$(mktemp)
    trap 'rm -f "$spk_installer"' EXIT
    curl --fail --silent --show-error --location https://mise.run --output "$spk_installer"
    MISE_INSTALL_PATH="$spk_mise" sh "$spk_installer"
    rm -f "$spk_installer"
    trap - EXIT
  fi
fi

"$spk_mise" trust "$PWD/mise.toml"
"$spk_mise" install
exec "$spk_mise" exec -- "$@"
