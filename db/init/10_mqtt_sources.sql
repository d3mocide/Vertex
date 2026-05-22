-- MQTT source configuration table
-- Runtime DB cache of mqtt_sources entries from config/sources.yml.
-- Seeded at startup by the config_sync process; kept in sync by the config watcher.
-- Credentials are never stored here — auth uses env vars keyed by source name.

CREATE TABLE IF NOT EXISTS mqtt_sources (
    id           SERIAL        PRIMARY KEY,
    name         VARCHAR(128)  NOT NULL UNIQUE,
    normalizer   VARCHAR(32)   NOT NULL,
    broker       VARCHAR(256)  NOT NULL DEFAULT 'mosquitto',
    port         INTEGER       NOT NULL DEFAULT 1883,
    topic        VARCHAR(512)  NOT NULL,
    qos          INTEGER       NOT NULL DEFAULT 0,
    auth_enabled BOOLEAN       NOT NULL DEFAULT FALSE,
    enabled      BOOLEAN       NOT NULL DEFAULT TRUE,
    source       VARCHAR(16)   NOT NULL DEFAULT 'config',
    created_at   TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    updated_at   TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS ix_mqtt_sources_enabled    ON mqtt_sources (enabled);
CREATE INDEX IF NOT EXISTS ix_mqtt_sources_normalizer ON mqtt_sources (normalizer);
