# Mesh Networking Integration Audit — 2026-05-10

## Overview
This audit covers the current state of the Mesh Core integration with the **RemoteTerm** instance at `http://192.168.75.175:8000`. This integration provides real-time comms, map-based link visualization, and node neighbor tracking.

## Validation Status: http://192.168.75.175:8000
Audit performed via `vertex-poller-1` container diagnostics on 2026-05-10.

| Component | Endpoint | Result | Status |
| :--- | :--- | :--- | :--- |
| **Contacts** | `GET /api/contacts` | Valid JSON array of mesh nodes | ✅ OK |
| **Health** | `GET /api/health` | Healthy telemetry (Heltec V3, v1.15.0) | ✅ OK |
| **Neighbors** | `GET /api/neighbors` | `404 Not Found` | ❌ Broken |
| **WebSocket** | `ws://.../api/ws` | Active connection; receiving events | ✅ OK |

### Connectivity Evidence
Poller logs confirm a healthy radio connection and successful telemetry parsing:
```log
2026-05-10 03:41:34,573 INFO [pollers.meshcore] [meshcore] radio connected (parsed from {
  'status': 'ok', 
  'radio_connected': True, 
  'radio_device_info': {'model': 'Heltec V3', ...}, 
  'radio_stats': {'battery_mv': 3807, 'uptime_secs': 40524, 'noise_floor': -103, 'last_rssi': -48, 'last_snr': 11.75, ...}
})
```

## Functional Findings

### 1. Link Visualization (Map Lines)
*   **Mechanism**: Driven by WebSocket `packet` events overheard by the local station.
*   **Logic**: The poller publishes a synthetic `mesh_links` update to the frontend bus whenever a packet is received.
*   **Observation**: SNR and RSSI are correctly reported from the live instance, allowing the map to render green/amber/red connection lines to the local station.

### 2. Neighbor Tracking (Entity Detail)
*   **Mechanism**: Relies on `GET /api/neighbors` to build the full adjacency graph of the mesh network.
*   **Issue**: Since this endpoint returns a `404`, the `mesh_links` database table is currently empty.
*   **Impact**: The "Neighbors" list in the `EntityDetail` panel (which fetches from our backend) remains empty ("No active links").
*   **Anomaly**: Anomaly detection logged a severe drop in `mesh_node` count (17 vs baseline 115) during the audit period, likely corresponding to a tracking loss or filtering change on the RemoteTerm station.

## Recommendations
1.  **RemoteTerm Update**: Verify if the RemoteTerm instance at `.175` needs a version upgrade or specific configuration to enable the `/api/neighbors` endpoint.
2.  **Poller Hardening**: Consider persisting real-time links from WebSocket `packet` events into the `mesh_links` table so they appear in the Entity Detail neighbor list, even if the full adjacency graph is unavailable.
3.  **Frontend/Store Alignment**: `EntityDetail.tsx` currently fetches from the REST API exclusively; it should be updated to fallback to the live `meshLinks` array in the Zustand store for better real-time consistency.
