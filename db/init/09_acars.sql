-- ACARS message log — populated by the acars poller from ACARSHub
CREATE TABLE IF NOT EXISTS acars_messages (
    id          BIGSERIAL    PRIMARY KEY,
    station_id  TEXT,
    tail        TEXT,
    flight      TEXT,
    freq        TEXT,
    label       TEXT,
    msg_num     TEXT,
    msg_text    TEXT,
    error       INTEGER      NOT NULL DEFAULT 0,
    mode        TEXT,
    ts          TIMESTAMPTZ  NOT NULL,
    received_at TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    -- Dedup key: same station/tail/freq/time is the same decoded frame
    CONSTRAINT uq_acars_frame UNIQUE (station_id, tail, freq, ts)
);

CREATE INDEX IF NOT EXISTS ix_acars_tail ON acars_messages (tail, ts DESC);
CREATE INDEX IF NOT EXISTS ix_acars_flight ON acars_messages (flight, ts DESC);
CREATE INDEX IF NOT EXISTS ix_acars_ts ON acars_messages (ts DESC);
