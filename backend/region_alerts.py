"""Reconcile only setup-owned zones, retaining operator/config rows and disabled settings."""
from sqlalchemy import select
from db.models import AlertZoneConfig
from config import settings
import provider_catalog  # installs the shared region-support import path
from nws_defaults import zone_changes


async def sync_region_zones(db, nws):
    rows = (await db.execute(select(AlertZoneConfig))).scalars().all()
    explicit = 'nws_alert_zones' in getattr(settings, 'model_fields_set', set())
    added, removed = zone_changes(nws, [{'zone_code': r.zone_code, 'source': r.source} for r in rows], explicit)
    for row in rows:
        if row.source == 'region' and row.zone_code in removed:
            await db.delete(row)
    for code in added:
        db.add(AlertZoneConfig(zone_code=code, source='region', enabled=True))
