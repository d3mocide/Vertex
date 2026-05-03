CREATE TABLE IF NOT EXISTS annotations (
    id              SERIAL PRIMARY KEY,
    annotation_type VARCHAR(16) NOT NULL CHECK (annotation_type IN ('marker', 'line', 'polygon')),
    label           VARCHAR(256),
    color           VARCHAR(16)  NOT NULL DEFAULT '#FFB800',
    geojson         JSONB        NOT NULL,
    created_by      VARCHAR(64),
    expires_at      TIMESTAMPTZ,
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS ix_annotations_expires_at
    ON annotations (expires_at)
    WHERE expires_at IS NOT NULL;
