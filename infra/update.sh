#!/usr/bin/env bash
set -euo pipefail

# Vertex — Update script for Raspberry Pi 5
# Usage: sudo bash /opt/vertex/infra/update.sh

if [[ $EUID -ne 0 ]]; then
  echo "Error: this script must be run as root (use sudo)." >&2
  exit 1
fi

echo "==> Pulling latest code (fast-forward only)..."
git -C /opt/vertex pull --ff-only

echo "==> Pulling latest Docker images..."
docker compose -f /opt/vertex/docker-compose.yml pull

echo "==> Restarting Vertex service..."
systemctl restart vertex

echo "Vertex updated and restarted."
