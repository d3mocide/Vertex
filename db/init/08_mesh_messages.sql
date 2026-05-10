-- mesh_messages: Historical log of mesh network messages
CREATE TABLE IF NOT EXISTS mesh_messages (
    id               VARCHAR(64)  PRIMARY KEY,
    msg_type         VARCHAR(32),
    conversation_key VARCHAR(128) NOT NULL,
    text             TEXT,
    sender_name      VARCHAR(128),
    sender_key       VARCHAR(128),
    outgoing         BOOLEAN      NOT NULL DEFAULT FALSE,
    acked            BOOLEAN      NOT NULL DEFAULT FALSE,
    ts               TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    source_url       TEXT         NOT NULL
);

CREATE INDEX IF NOT EXISTS ix_mesh_messages_ts ON mesh_messages (ts DESC);
CREATE INDEX IF NOT EXISTS ix_mesh_messages_conversation ON mesh_messages (conversation_key);
