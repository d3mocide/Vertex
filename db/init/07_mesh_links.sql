-- mesh_links: RF link state between MeshCore nodes (updated each contact poll cycle)
CREATE TABLE IF NOT EXISTS mesh_links (
    id          SERIAL       PRIMARY KEY,
    source_url  TEXT         NOT NULL,
    node_a      VARCHAR(64)  NOT NULL,
    node_b      VARCHAR(64)  NOT NULL,
    snr         DOUBLE PRECISION,
    link_quality DOUBLE PRECISION,
    last_seen   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    CONSTRAINT mesh_links_unique UNIQUE (source_url, node_a, node_b)
);

CREATE INDEX IF NOT EXISTS ix_mesh_links_last_seen ON mesh_links (last_seen DESC);
CREATE INDEX IF NOT EXISTS ix_mesh_links_node_a    ON mesh_links (node_a);
CREATE INDEX IF NOT EXISTS ix_mesh_links_node_b    ON mesh_links (node_b);
