#!/bin/sh
set -e

# Substitute environment variables into the config template
export ICECAST_SOURCE_PASSWORD="${ICECAST_SOURCE_PASSWORD:-hackme}"
export ICECAST_RELAY_PASSWORD="${ICECAST_RELAY_PASSWORD:-hackme}"
export ICECAST_ADMIN_PASSWORD="${ICECAST_ADMIN_PASSWORD:-changeme}"
export ICECAST_HOSTNAME="${ICECAST_HOSTNAME:-localhost}"
export ICECAST_PORT="${ICECAST_PORT:-8000}"
export ICECAST_MAX_CLIENTS="${ICECAST_MAX_CLIENTS:-25}"

envsubst < /etc/icecast/icecast.xml.template > /etc/icecast/icecast.xml

exec icecast -c /etc/icecast/icecast.xml
