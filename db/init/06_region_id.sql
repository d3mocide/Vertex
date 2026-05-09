-- Add region_id column to entities for multi-region tracking
ALTER TABLE entities ADD COLUMN IF NOT EXISTS region_id VARCHAR(64);
CREATE INDEX IF NOT EXISTS ix_entities_region_id ON entities (region_id);
