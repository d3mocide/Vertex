#!/usr/bin/env bash
# Re-resolve each Python lock against its requirements.txt without upgrading anything that still satisfies it.
# Used by hand, by the Dependabot lock workflow and by DEPENDENCIES.md, so every lock comes out the same.
# Extra arguments go to pip-compile, e.g. scripts/sync_python_locks.sh -P certifi   (upgrade one package)
#                                         scripts/sync_python_locks.sh --upgrade     (refresh everything; review the diff)
set -euo pipefail
cd "$(dirname "$0")/.."
for service in backend poller transcription; do
  pip-compile -q --strip-extras "$@" --output-file="$service/requirements.lock" "$service/requirements.txt"
done
