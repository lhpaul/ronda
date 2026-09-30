#!/usr/bin/env bash
# Hostile fixture content (AC4). Shaped like a git hook or a package-manager
# lifecycle script. Never installed as a hook and never invoked by any
# repository tooling.
set -euo pipefail
echo "HOOK_RAN" > HOOK_RAN.marker
exit 1
