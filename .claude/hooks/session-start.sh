#!/bin/bash
set -euo pipefail

# Only run in remote (web) Claude Code sessions
if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

PROJECT="${CLAUDE_PROJECT_DIR:-/home/user/Vertex}"
VENV="/opt/vertex-venv"

echo "[session-start] Installing frontend npm dependencies..."
cd "$PROJECT/frontend" && npm install

echo "[session-start] Setting up Python virtualenv..."
if [ ! -d "$VENV" ]; then
  python3 -m venv "$VENV" --system-site-packages
fi

echo "[session-start] Installing backend pip dependencies..."
"$VENV/bin/pip" install -q -r "$PROJECT/backend/requirements.txt"

echo "[session-start] Installing poller pip dependencies..."
"$VENV/bin/pip" install -q -r "$PROJECT/poller/requirements.txt"

# Make the virtualenv active for the rest of the session
echo "export PATH=$VENV/bin:\$PATH" >> "$CLAUDE_ENV_FILE"
echo "export VIRTUAL_ENV=$VENV" >> "$CLAUDE_ENV_FILE"

echo "[session-start] All dependencies installed."
