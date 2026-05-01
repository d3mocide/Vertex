-- Civic Grid database schema
-- Requires PostGIS extension (provided by postgis/postgis image)

CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- -------------------------------------------------------------------------
-- entities: every trackable thing (aircraft, vessel, sensor, mesh node)
-- -------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS entities (
    entity_id    VARCHAR(64)  PRIMARY KEY,
    entity_type  VARCHAR(32)  NOT NULL,
    source       VARCHAR(32)  NOT NULL,
    display_name VARCHAR(128),
    identity     JSONB,
    tags         JSONB,
    first_seen   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    last_seen    TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS ix_entities_type     ON entities (entity_type);
CREATE INDEX IF NOT EXISTS ix_entities_source   ON entities (source);
CREATE INDEX IF NOT EXISTS ix_entities_last_seen ON entities (last_seen DESC);

-- -------------------------------------------------------------------------
-- observations: time-series position/state updates per entity
-- -------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS observations (
    id             BIGSERIAL    PRIMARY KEY,
    entity_id      VARCHAR(64)  NOT NULL REFERENCES entities (entity_id) ON DELETE CASCADE,
    ts             TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    lat            DOUBLE PRECISION,
    lon            DOUBLE PRECISION,
    altitude       DOUBLE PRECISION,
    heading        DOUBLE PRECISION,
    speed          DOUBLE PRECISION,
    vertical_rate  DOUBLE PRECISION,
    status         VARCHAR(64),
    signal_quality DOUBLE PRECISION,
    raw_payload    JSONB,
    geom           GEOMETRY(POINT, 4326)
);

CREATE INDEX IF NOT EXISTS ix_obs_entity_ts ON observations (entity_id, ts DESC);
CREATE INDEX IF NOT EXISTS ix_obs_ts        ON observations (ts DESC);
CREATE INDEX IF NOT EXISTS ix_obs_geom      ON observations USING GIST (geom);

-- -------------------------------------------------------------------------
-- events: derived notable occurrences (geofence entry, alert, anomaly)
-- -------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS events (
    event_id   VARCHAR(64)  PRIMARY KEY DEFAULT gen_random_uuid()::text,
    event_type VARCHAR(64)  NOT NULL,
    entity_id  VARCHAR(64),
    ts         TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    severity   VARCHAR(16)  NOT NULL DEFAULT 'info',
    summary    TEXT         NOT NULL,
    details    JSONB
);

CREATE INDEX IF NOT EXISTS ix_events_ts       ON events (ts DESC);
CREATE INDEX IF NOT EXISTS ix_events_type     ON events (event_type);
CREATE INDEX IF NOT EXISTS ix_events_severity ON events (severity);
CREATE INDEX IF NOT EXISTS ix_events_entity   ON events (entity_id);

-- -------------------------------------------------------------------------
-- geofences: spatial alert zones (polygons)
-- -------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS geofences (
    id          SERIAL       PRIMARY KEY,
    name        VARCHAR(128) NOT NULL,
    description TEXT,
    zone_type   VARCHAR(32)  NOT NULL DEFAULT 'alert',
    geofence_shape VARCHAR(16) NOT NULL DEFAULT 'polygon',
    center_lat  DOUBLE PRECISION,
    center_lon  DOUBLE PRECISION,
    radius_m    DOUBLE PRECISION,
    dwell_seconds INTEGER NOT NULL DEFAULT 0,
    geom        GEOMETRY(POLYGON, 4326) NOT NULL,
    active      BOOLEAN      NOT NULL DEFAULT TRUE,
    created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS ix_geofences_geom ON geofences USING GIST (geom);

-- -------------------------------------------------------------------------
-- alert_rules: event-driven outbound actions (webhook/log)
-- -------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS alert_rules (
    id            SERIAL       PRIMARY KEY,
    name          VARCHAR(128) NOT NULL,
    enabled       BOOLEAN      NOT NULL DEFAULT TRUE,
    trigger_type  VARCHAR(32)  NOT NULL,
    rule_filter   JSONB,
    action_type   VARCHAR(32)  NOT NULL DEFAULT 'webhook_post',
    action_config JSONB        NOT NULL,
    created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS ix_alert_rules_trigger ON alert_rules (trigger_type);

-- -------------------------------------------------------------------------
-- maintenance: purge observations older than 30 days
-- -------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION purge_old_observations() RETURNS void
    LANGUAGE SQL AS $$
        DELETE FROM observations WHERE ts < NOW() - INTERVAL '30 days';
    $$;

-- -------------------------------------------------------------------------
-- users: local accounts for dashboard authentication
-- -------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
    id            SERIAL       PRIMARY KEY,
    username      VARCHAR(64)  UNIQUE NOT NULL,
    password_hash VARCHAR(256) NOT NULL,
    role          VARCHAR(32)  NOT NULL DEFAULT 'admin',
    created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    last_login    TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS ix_users_username ON users (username);
