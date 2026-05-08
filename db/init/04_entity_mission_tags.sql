-- Entity mission tags: operator-assigned labels for grouping/highlighting entities
CREATE TABLE IF NOT EXISTS entity_mission_tags (
    id          SERIAL       PRIMARY KEY,
    entity_id   VARCHAR(64)  NOT NULL REFERENCES entities(entity_id) ON DELETE CASCADE,
    tag         VARCHAR(64)  NOT NULL,
    color       VARCHAR(16)  NOT NULL DEFAULT '#FFB800',
    created_by  VARCHAR(64)  REFERENCES users(username) ON DELETE SET NULL,
    created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS ix_entity_mission_tags_entity_id ON entity_mission_tags (entity_id);
