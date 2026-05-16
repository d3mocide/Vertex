-- SNR threshold alert configuration, one row per MeshCore source URL.
-- Rows are created on demand by the admin UI; the poller falls back to
-- DEFAULT_THRESHOLD (-90 dBm) when no matching row exists.
CREATE TABLE IF NOT EXISTS mesh_alert_configs (
    id            SERIAL PRIMARY KEY,
    source_url    TEXT    NOT NULL,
    snr_threshold REAL    NOT NULL DEFAULT -90.0,
    cooldown_secs INTEGER NOT NULL DEFAULT 300,
    enabled       BOOLEAN NOT NULL DEFAULT TRUE,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_mesh_alert_configs_url
    ON mesh_alert_configs (source_url);
