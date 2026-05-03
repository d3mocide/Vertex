-- Entity mission tags: operator-assigned labels for grouping/highlighting entities
CREATE TABLE IF NOT EXISTS entity_mission_tags (
    id          SERIAL       PRIMARY KEY,
    entity_id   VARCHAR(64)  NOT NULL,
    tag         VARCHAR(64)  NOT NULL,
    color       VARCHAR(16)  NOT NULL DEFAULT '#FFB800',
    created_by  VARCHAR(64),
    created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS ix_entity_mission_tags_entity_id ON entity_mission_tags (entity_id);

-- Cooldown columns for alert_rules (added in sprint 5)
ALTER TABLE alert_rules ADD COLUMN IF NOT EXISTS cooldown_seconds  INTEGER;
ALTER TABLE alert_rules ADD COLUMN IF NOT EXISTS max_per_hour      INTEGER;
ALTER TABLE alert_rules ADD COLUMN IF NOT EXISTS dedup_key         VARCHAR(256);
