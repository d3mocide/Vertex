"""
Batch geofence tagging: which active geofences contain each point.

Used to annotate located items (traffic incidents, fires, quakes, radio
incidents) with the operator's own areas of interest, so the AI briefing
and the UI can say "inside Willamette River — Portland Reach" rather than
just "16 km from centre". Circle geofences are stored as polygons in
`geom`, so one ST_Contains covers every shape.
"""
import logging

logger = logging.getLogger(__name__)


async def geofences_for_points(pool, points: list[tuple[float | None, float | None]]) -> list[list[str]]:
    """Return, for each (lat, lon), labels ("<name> (<zone_type>)") of active geofences containing it.

    Points with a missing coordinate get an empty list. One round trip for
    the whole batch; failures degrade to "no tags" rather than raising.
    """
    result: list[list[str]] = [[] for _ in points]
    idx = [i for i, (lat, lon) in enumerate(points)
           if isinstance(lat, (int, float)) and isinstance(lon, (int, float))]
    if pool is None or not idx:
        return result
    try:
        rows = await pool.fetch(
            """
            SELECT p.i, g.name, g.zone_type
            FROM unnest($1::int[], $2::float8[], $3::float8[]) AS p(i, lat, lon)
            JOIN geofences g
              ON g.active = TRUE
             AND ST_Contains(g.geom, ST_SetSRID(ST_MakePoint(p.lon, p.lat), 4326))
            ORDER BY p.i, g.name
            """,
            idx, [points[i][0] for i in idx], [points[i][1] for i in idx],
        )
    except Exception as exc:
        logger.debug("[geo_tags] geofence lookup failed: %s", exc)
        return result
    for i, name, zone_type in rows:
        # Zone type tells the reader why the area matters ("maritime", "airport", …).
        result[i].append(f"{name} ({zone_type})" if zone_type else name)
    return result
