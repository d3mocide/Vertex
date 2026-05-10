from datetime import datetime, timezone, timedelta

from fastapi import APIRouter, Depends, Query
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from deps import get_db

router = APIRouter(tags=["mesh"])


@router.get("/mesh/links")
async def list_mesh_links(
    stale_minutes: int = Query(30, ge=1, le=1440),
    db: AsyncSession = Depends(get_db),
):
    """Return active mesh RF links updated within the last stale_minutes."""
    cutoff = datetime.now(timezone.utc) - timedelta(minutes=stale_minutes)
    result = await db.execute(
        text(
            "SELECT source_url, node_a, node_b, snr, link_quality, last_seen "
            "FROM mesh_links WHERE last_seen >= :cutoff ORDER BY last_seen DESC"
        ).bindparams(cutoff=cutoff)
    )
    rows = result.mappings().all()
    return [dict(r) for r in rows]


@router.get("/mesh/topology")
async def mesh_topology(
    stale_minutes: int = Query(30, ge=1, le=1440),
    db: AsyncSession = Depends(get_db),
):
    """Return nodes and links as a graph for visualization."""
    cutoff = datetime.now(timezone.utc) - timedelta(minutes=stale_minutes)
    result = await db.execute(
        text(
            "SELECT source_url, node_a, node_b, snr, link_quality "
            "FROM mesh_links WHERE last_seen >= :cutoff"
        ).bindparams(cutoff=cutoff)
    )
    links = [dict(r) for r in result.mappings().all()]
    node_ids = set()
    for lnk in links:
        node_ids.add(lnk["node_a"])
        node_ids.add(lnk["node_b"])
    return {"nodes": list(node_ids), "links": links}
 
 
@router.get("/mesh/messages")
async def list_mesh_messages(
    limit: int = Query(100, ge=1, le=1000),
    db: AsyncSession = Depends(get_db),
):
    """Return recent mesh network messages from the database."""
    result = await db.execute(
        text(
            "SELECT id, msg_type, conversation_key, text, sender_name, sender_key, outgoing, acked, ts as timestamp, source_url "
            "FROM mesh_messages ORDER BY ts DESC LIMIT :limit"
        ).bindparams(limit=limit)
    )
    rows = result.mappings().all()
    # Convert timestamp to ISO string for JSON serialization if needed, 
    # though mappings() usually handles datetime objects which FastAPI serializes.
    return [dict(r) for r in rows]
