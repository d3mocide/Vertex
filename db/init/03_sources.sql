-- Source configuration tables
-- Runtime DB cache of config/sources.yml.
-- Seeded at startup by poller/config_sync.py; kept in sync by the config watcher.

CREATE TABLE IF NOT EXISTS radio_streams (
    id          SERIAL        PRIMARY KEY,
    name        VARCHAR(128)  NOT NULL,
    url         VARCHAR(512)  NOT NULL,
    format      VARCHAR(16)   NOT NULL DEFAULT 'mp3',
    enabled     BOOLEAN       NOT NULL DEFAULT TRUE,
    source      VARCHAR(16)   NOT NULL DEFAULT 'config',
    created_at  TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS ix_radio_streams_enabled ON radio_streams (enabled);

CREATE TABLE IF NOT EXISTS news_feeds (
    id          SERIAL        PRIMARY KEY,
    name        VARCHAR(128)  NOT NULL,
    url         VARCHAR(512),
    format      VARCHAR(32)   NOT NULL DEFAULT 'rss',
    enabled     BOOLEAN       NOT NULL DEFAULT TRUE,
    source      VARCHAR(16)   NOT NULL DEFAULT 'config',
    created_at  TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS ix_news_feeds_enabled ON news_feeds (enabled);

CREATE TABLE IF NOT EXISTS poller_sources (
    id          SERIAL        PRIMARY KEY,
    type        VARCHAR(32)   NOT NULL,
    name        VARCHAR(128)  NOT NULL,
    url         VARCHAR(512)  NOT NULL,
    enabled     BOOLEAN       NOT NULL DEFAULT TRUE,
    source      VARCHAR(16)   NOT NULL DEFAULT 'config',
    created_at  TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS ix_poller_sources_type    ON poller_sources (type);
CREATE INDEX IF NOT EXISTS ix_poller_sources_enabled ON poller_sources (enabled);

CREATE TABLE IF NOT EXISTS alert_zone_configs (
    id          SERIAL        PRIMARY KEY,
    zone_code   VARCHAR(32)   NOT NULL UNIQUE,
    enabled     BOOLEAN       NOT NULL DEFAULT TRUE,
    source      VARCHAR(16)   NOT NULL DEFAULT 'config',
    created_at  TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS alert_feed_configs (
    id          SERIAL        PRIMARY KEY,
    name        VARCHAR(128)  NOT NULL,
    url         VARCHAR(512)  NOT NULL,
    format      VARCHAR(32)   NOT NULL DEFAULT 'rss',
    enabled     BOOLEAN       NOT NULL DEFAULT TRUE,
    source      VARCHAR(16)   NOT NULL DEFAULT 'config',
    created_at  TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS ix_alert_feed_configs_enabled ON alert_feed_configs (enabled);
