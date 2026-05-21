"""
Source management endpoints — poller sources, news feeds, and alert zones.

All mutations write through to sources.yml via config_writer so changes
survive database wipes. Entries created via the API carry source='user';
entries seeded from the YAML file carry source='config'.
"""

from datetime import datetime, timezone
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from config_writer import add_entry, add_alert_zone, remove_entry, remove_alert_zone, update_entry, add_mqtt_entry, remove_mqtt_entry, update_mqtt_entry
from deps import get_db
from db.models import AlertZoneConfig, MqttSource, NewsFeed, PollerSource

router = APIRouter(prefix="/sources", tags=["sources"])


# ---------------------------------------------------------------------------
# Poller sources
# ---------------------------------------------------------------------------

class PollerSourceCreate(BaseModel):
    type: Literal["adsb", "ais", "p25", "meshcore", "fire", "aprs"]
    name: str
    url: str
    enabled: bool = True


class PollerSourceResponse(BaseModel):
    id: int
    type: str
    name: str
    url: str
    enabled: bool
    source: str


def _ps_response(ps: PollerSource) -> PollerSourceResponse:
    return PollerSourceResponse(
        id=ps.id, type=ps.type, name=ps.name,
        url=ps.url, enabled=ps.enabled, source=ps.source,
    )


@router.get("/pollers", response_model=list[PollerSourceResponse])
async def list_poller_sources(db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(PollerSource).order_by(PollerSource.type, PollerSource.id))
    return [_ps_response(ps) for ps in result.scalars().all()]


@router.post("/pollers", response_model=PollerSourceResponse, status_code=201)
async def create_poller_source(body: PollerSourceCreate, db: AsyncSession = Depends(get_db)):
    ps = PollerSource(
        type=body.type, name=body.name, url=body.url, enabled=body.enabled,
        source="user",
        created_at=datetime.now(timezone.utc),
        updated_at=datetime.now(timezone.utc),
    )
    db.add(ps)
    await db.commit()
    await db.refresh(ps)
    await add_entry("poller_sources", {
        "type": ps.type, "name": ps.name, "url": ps.url,
        "enabled": ps.enabled, "source": "user",
    })
    return _ps_response(ps)


@router.patch("/pollers/{source_id}/toggle", response_model=PollerSourceResponse)
async def toggle_poller_source(source_id: int, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(PollerSource).where(PollerSource.id == source_id))
    ps = result.scalar_one_or_none()
    if not ps:
        raise HTTPException(404, "Poller source not found")
    ps.enabled = not ps.enabled
    ps.updated_at = datetime.now(timezone.utc)
    await db.commit()
    await db.refresh(ps)
    await update_entry("poller_sources", ps.url, {"enabled": ps.enabled})
    return _ps_response(ps)


@router.delete("/pollers/{source_id}", status_code=204)
async def delete_poller_source(source_id: int, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(PollerSource).where(PollerSource.id == source_id))
    ps = result.scalar_one_or_none()
    if not ps:
        raise HTTPException(404, "Poller source not found")
    url = ps.url
    await db.delete(ps)
    await db.commit()
    await remove_entry("poller_sources", url)


# ---------------------------------------------------------------------------
# News feeds
# ---------------------------------------------------------------------------

class NewsFeedCreate(BaseModel):
    name: str
    url: str | None = None
    format: str = "rss"
    enabled: bool = True


class NewsFeedResponse(BaseModel):
    id: int
    name: str
    url: str | None
    format: str
    enabled: bool
    source: str


def _nf_response(nf: NewsFeed) -> NewsFeedResponse:
    return NewsFeedResponse(
        id=nf.id, name=nf.name, url=nf.url,
        format=nf.format, enabled=nf.enabled, source=nf.source,
    )


@router.get("/feeds", response_model=list[NewsFeedResponse])
async def list_news_feeds(db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(NewsFeed).order_by(NewsFeed.id))
    return [_nf_response(nf) for nf in result.scalars().all()]


@router.post("/feeds", response_model=NewsFeedResponse, status_code=201)
async def create_news_feed(body: NewsFeedCreate, db: AsyncSession = Depends(get_db)):
    nf = NewsFeed(
        name=body.name, url=body.url, format=body.format, enabled=body.enabled,
        source="user",
        created_at=datetime.now(timezone.utc),
        updated_at=datetime.now(timezone.utc),
    )
    db.add(nf)
    await db.commit()
    await db.refresh(nf)
    await add_entry("news_feeds", {
        "name": nf.name, "url": nf.url, "format": nf.format,
        "enabled": nf.enabled, "source": "user",
    })
    return _nf_response(nf)


@router.patch("/feeds/{feed_id}/toggle", response_model=NewsFeedResponse)
async def toggle_news_feed(feed_id: int, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(NewsFeed).where(NewsFeed.id == feed_id))
    nf = result.scalar_one_or_none()
    if not nf:
        raise HTTPException(404, "News feed not found")
    nf.enabled = not nf.enabled
    nf.updated_at = datetime.now(timezone.utc)
    await db.commit()
    await db.refresh(nf)
    if nf.url:
        await update_entry("news_feeds", nf.url, {"enabled": nf.enabled})
    return _nf_response(nf)


@router.delete("/feeds/{feed_id}", status_code=204)
async def delete_news_feed(feed_id: int, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(NewsFeed).where(NewsFeed.id == feed_id))
    nf = result.scalar_one_or_none()
    if not nf:
        raise HTTPException(404, "News feed not found")
    url = nf.url
    await db.delete(nf)
    await db.commit()
    if url:
        await remove_entry("news_feeds", url)


# ---------------------------------------------------------------------------
# Alert zones
# ---------------------------------------------------------------------------

class AlertZoneCreate(BaseModel):
    zone_code: str
    enabled: bool = True


class AlertZoneResponse(BaseModel):
    id: int
    zone_code: str
    enabled: bool
    source: str


def _az_response(az: AlertZoneConfig) -> AlertZoneResponse:
    return AlertZoneResponse(
        id=az.id, zone_code=az.zone_code, enabled=az.enabled, source=az.source,
    )


@router.get("/alert-zones", response_model=list[AlertZoneResponse])
async def list_alert_zones(db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(AlertZoneConfig).order_by(AlertZoneConfig.zone_code))
    return [_az_response(az) for az in result.scalars().all()]


@router.post("/alert-zones", response_model=AlertZoneResponse, status_code=201)
async def create_alert_zone(body: AlertZoneCreate, db: AsyncSession = Depends(get_db)):
    az = AlertZoneConfig(
        zone_code=body.zone_code.upper(), enabled=body.enabled,
        source="user",
        created_at=datetime.now(timezone.utc),
        updated_at=datetime.now(timezone.utc),
    )
    db.add(az)
    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        raise HTTPException(409, f"Zone {body.zone_code!r} already exists")
    await db.refresh(az)
    await add_alert_zone(az.zone_code)
    return _az_response(az)


@router.delete("/alert-zones/{zone_id}", status_code=204)
async def delete_alert_zone(zone_id: int, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(AlertZoneConfig).where(AlertZoneConfig.id == zone_id))
    az = result.scalar_one_or_none()
    if not az:
        raise HTTPException(404, "Alert zone not found")
    code = az.zone_code
    await db.delete(az)
    await db.commit()
    await remove_alert_zone(code)


# ---------------------------------------------------------------------------
# MQTT sources
# ---------------------------------------------------------------------------

class MqttSourceCreate(BaseModel):
    name: str
    normalizer: Literal["rtl_433", "meshtastic", "ais"]
    broker: str = "mosquitto"
    port: int = 1883
    topic: str
    qos: int = 0
    auth_enabled: bool = False
    enabled: bool = True


class MqttSourceResponse(BaseModel):
    id: int
    name: str
    normalizer: str
    broker: str
    port: int
    topic: str
    qos: int
    auth_enabled: bool
    enabled: bool
    source: str


def _ms_response(ms: MqttSource) -> MqttSourceResponse:
    return MqttSourceResponse(
        id=ms.id, name=ms.name, normalizer=ms.normalizer,
        broker=ms.broker, port=ms.port, topic=ms.topic,
        qos=ms.qos, auth_enabled=ms.auth_enabled,
        enabled=ms.enabled, source=ms.source,
    )


@router.get("/mqtt", response_model=list[MqttSourceResponse])
async def list_mqtt_sources(db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(MqttSource).order_by(MqttSource.normalizer, MqttSource.id))
    return [_ms_response(ms) for ms in result.scalars().all()]


@router.post("/mqtt", response_model=MqttSourceResponse, status_code=201)
async def create_mqtt_source(body: MqttSourceCreate, db: AsyncSession = Depends(get_db)):
    ms = MqttSource(
        name=body.name, normalizer=body.normalizer, broker=body.broker,
        port=body.port, topic=body.topic, qos=body.qos,
        auth_enabled=body.auth_enabled, enabled=body.enabled,
        source="user",
        created_at=datetime.now(timezone.utc),
        updated_at=datetime.now(timezone.utc),
    )
    db.add(ms)
    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        raise HTTPException(409, f"MQTT source {body.name!r} already exists")
    await db.refresh(ms)
    await add_mqtt_entry({
        "name": ms.name, "normalizer": ms.normalizer, "broker": ms.broker,
        "port": ms.port, "topic": ms.topic, "qos": ms.qos,
        "auth_enabled": ms.auth_enabled, "enabled": ms.enabled, "source": "user",
    })
    return _ms_response(ms)


@router.patch("/mqtt/{source_id}/toggle", response_model=MqttSourceResponse)
async def toggle_mqtt_source(source_id: int, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(MqttSource).where(MqttSource.id == source_id))
    ms = result.scalar_one_or_none()
    if not ms:
        raise HTTPException(404, "MQTT source not found")
    ms.enabled = not ms.enabled
    ms.updated_at = datetime.now(timezone.utc)
    await db.commit()
    await db.refresh(ms)
    await update_mqtt_entry(ms.name, {"enabled": ms.enabled})
    return _ms_response(ms)


@router.delete("/mqtt/{source_id}", status_code=204)
async def delete_mqtt_source(source_id: int, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(MqttSource).where(MqttSource.id == source_id))
    ms = result.scalar_one_or_none()
    if not ms:
        raise HTTPException(404, "MQTT source not found")
    name = ms.name
    await db.delete(ms)
    await db.commit()
    await remove_mqtt_entry(name)
