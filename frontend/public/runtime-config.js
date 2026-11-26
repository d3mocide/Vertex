// Placeholder for the dev server and builds outside Docker. In the Docker image nginx serves the copy the
// container writes at startup (docker-entrypoint.d/40-vertex-runtime-config.sh) instead; see src/config.ts.
window.__VERTEX_CONFIG__ = window.__VERTEX_CONFIG__ || {}
