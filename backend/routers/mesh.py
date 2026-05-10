from datetime import datetime, timezone, timedelta
import logging

from fastapi import APIRouter, Depends, Query
from sqlalchemy import text
from sqlalchemy.exc import ProgrammingError
from sqlalchemy.ext.asyncio import AsyncSession

from deps import get_db

router = APIRouter(tags=["mesh"])
logger = logging.getLogger(__name__)

_MESH_MESSAGES_DDL = """
CREATE TABLE IF NOT EXISTS mesh_messages (
    id TEXT PRIMARY KEY,
    msg_type TEXT,
    conversation_key TEXT,
    text TEXT,
    sender_name TEXT,
    sender_key TEXT,
    outgoing BOOLEAN DEFAULT FALSE,
    acked BOOLEAN DEFAULT FALSE,
    ts TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    source_url TEXT
);
CREATE INDEX IF NOT EXISTS ix_mesh_messages_ts ON mesh_messages (ts DESC);
CREATE INDEX IF NOT EXISTS ix_mesh_messages_conversation ON mesh_messages (conversation_key);
"""


def _is_missing_mesh_messages_table(exc: ProgrammingError) -> bool:
    msg = str(exc).lower()
    return "mesh_messages" in msg and ("undefinedtable" in msg or "does not exist" in msg)


async def _ensure_mesh_messages_table(db: AsyncSession) -> None:
    for stmt in _MESH_MESSAGES_DDL.strip().split(";"):
        statement = stmt.strip()
        if not statement:
            continue
        await db.execute(text(statement))
    await db.commit()


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
    query = text(
        "SELECT id, msg_type, conversation_key, text, sender_name, sender_key, outgoing, acked, ts as timestamp, source_url "
        "FROM mesh_messages ORDER BY ts DESC LIMIT :limit"
    ).bindparams(limit=limit)
    try:
        result = await db.execute(query)
    except ProgrammingError as exc:
        if not _is_missing_mesh_messages_table(exc):
            raise

        logger.warning("[mesh] mesh_messages table missing; attempting one-time self-heal")
        try:
            await db.rollback()
            await _ensure_mesh_messages_table(db)
            result = await db.execute(query)
        except Exception:
            logger.exception("[mesh] failed to self-heal mesh_messages table")
            return []

    rows = result.mappings().all()
    return [dict(r) for r in rows]
