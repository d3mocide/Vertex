"""Ownership rules for location-derived NWS alert zones."""
import re


def zone_changes(nws, rows, explicit_env=False):
    desired = set() if explicit_env else {nws[key] for key in ('forecast_zone', 'county_zone', 'fire_zone')
        if isinstance(nws.get(key), str) and re.fullmatch(r'[A-Z]{2}[ZC]\d{3}', nws[key])}
    existing = {row['zone_code'] for row in rows}
    owned = {row['zone_code'] for row in rows if row['source'] == 'region'}
    return sorted(desired - existing), sorted(owned - desired)
