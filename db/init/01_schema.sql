-- Civic Grid database schema
-- Requires PostGIS extension (provided by postgis/postgis image)

CREATE EXTENSION IF NOT EXISTS postgis;

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
    geom           GEOMETRY(POINT, 4326),
    CONSTRAINT observations_coords_consistent
        CHECK (
            (lat IS NULL) = (lon IS NULL)
            AND (lat IS NULL) = (geom IS NULL)
        )
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
    entity_id  VARCHAR(64)  REFERENCES entities(entity_id) ON DELETE SET NULL,
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
-- geofences: spatial alert zones (polygons and circles)
-- -------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS geofences (
    id          SERIAL       PRIMARY KEY,
    name        VARCHAR(128) NOT NULL UNIQUE,
    description TEXT,
    zone_type   VARCHAR(32)  NOT NULL DEFAULT 'alert',
    geofence_shape VARCHAR(16) NOT NULL DEFAULT 'polygon',
    center_lat  DOUBLE PRECISION,
    center_lon  DOUBLE PRECISION,
    radius_m    DOUBLE PRECISION,
    dwell_seconds INTEGER NOT NULL DEFAULT 0,
    geom        GEOMETRY(GEOMETRY, 4326),
    active      BOOLEAN      NOT NULL DEFAULT TRUE,
    created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    CONSTRAINT geofences_circle_requires_radius
        CHECK (geofence_shape <> 'circle' OR (radius_m IS NOT NULL AND center_lat IS NOT NULL)),
    CONSTRAINT geofences_polygon_requires_geom
        CHECK (geofence_shape <> 'polygon' OR geom IS NOT NULL)
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
    -- SECURITY: Store only references (env var names, Vault paths), never inline secrets.
    -- Webhook tokens and passwords must not be stored here in plaintext.
    action_config JSONB        NOT NULL,
    cooldown_seconds  INTEGER,
    max_per_hour      INTEGER,
    dedup_key         VARCHAR(256),
    created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    CONSTRAINT alert_rules_no_inline_secrets
        CHECK (NOT (action_config ? 'token' OR action_config ? 'secret' OR action_config ? 'password'))
);

CREATE INDEX IF NOT EXISTS ix_alert_rules_trigger ON alert_rules (trigger_type);

-- -------------------------------------------------------------------------
-- maintenance: purge observations older than 30 days
-- -------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION purge_old_observations() RETURNS void
    SECURITY DEFINER SET search_path = public
    LANGUAGE SQL AS $$
        DELETE FROM observations WHERE ts < NOW() - INTERVAL '30 days';
    $$;

REVOKE EXECUTE ON FUNCTION purge_old_observations() FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION purge_old_observations() TO vertex;

-- -------------------------------------------------------------------------
-- users: local accounts for dashboard authentication
-- -------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
    id            SERIAL       PRIMARY KEY,
    username      VARCHAR(64)  UNIQUE NOT NULL,
    password_hash VARCHAR(256) NOT NULL,
    role          VARCHAR(32)  NOT NULL DEFAULT 'viewer',
    created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    last_login    TIMESTAMPTZ
);
