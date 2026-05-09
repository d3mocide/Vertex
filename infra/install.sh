#!/usr/bin/env bash
set -euo pipefail

# Vertex — First-time install script for Raspberry Pi 5
# Usage: sudo bash infra/install.sh
# Requires VERTEX_REPO_URL to be set in the environment before running.

if [[ $EUID -ne 0 ]]; then
  echo "Error: this script must be run as root (use sudo)." >&2
  exit 1
fi

echo "==> Installing system dependencies..."
apt-get update -y
apt-get install -y docker.io docker-compose-plugin curl git

echo "==> Enabling and starting Docker..."
systemctl enable --now docker

echo "==> Preparing /opt/vertex..."
mkdir -p /opt/vertex

if [[ -d /opt/vertex/.git ]]; then
  echo "==> Repository found — pulling latest changes..."
  git -C /opt/vertex pull
else
  if [[ -z "${VERTEX_REPO_URL:-}" ]]; then
    echo "Error: VERTEX_REPO_URL is not set. Export it before running this script:" >&2
    echo "  export VERTEX_REPO_URL=https://github.com/d3mocide/Vertex.git" >&2
    exit 1
  fi
  echo "==> Cloning repository from ${VERTEX_REPO_URL}..."
  git clone "$VERTEX_REPO_URL" /opt/vertex
fi

echo "==> Configuring environment..."
if [[ ! -f /opt/vertex/.env ]]; then
  cp /opt/vertex/.env.example /opt/vertex/.env
  echo "    NOTE: /opt/vertex/.env has been created from .env.example."
  echo "    Edit it with your region, API keys, and data sources before the service starts."
else
  echo "    /opt/vertex/.env already exists — skipping copy."
fi

echo "==> Installing systemd unit..."
cp /opt/vertex/infra/vertex.service /etc/systemd/system/vertex.service

echo "==> Enabling and starting Vertex service..."
systemctl daemon-reload
systemctl enable vertex
systemctl start vertex

echo ""
echo "Vertex is starting at http://$(hostname -I | awk '{print $1}')"
echo "Check status with: sudo systemctl status vertex"
echo "Follow logs with:  sudo journalctl -u vertex -f"
