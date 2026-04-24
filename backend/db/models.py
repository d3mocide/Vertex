from datetime import datetime
from typing import Optional
from sqlalchemy import String, Float, DateTime, Text, JSON, ForeignKey, Index, Boolean
from sqlalchemy.orm import Mapped, mapped_column, relationship
from geoalchemy2 import Geometry

from db.session import Base


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    username: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    password_hash: Mapped[str] = mapped_column(String(256))
    role: Mapped[str] = mapped_column(String(32), default="admin")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    last_login: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)


class Entity(Base):
    __tablename__ = "entities"

    entity_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    entity_type: Mapped[str] = mapped_column(String(32), index=True)
    source: Mapped[str] = mapped_column(String(32), index=True)
    display_name: Mapped[Optional[str]] = mapped_column(String(128))
    identity: Mapped[Optional[dict]] = mapped_column(JSON)
    tags: Mapped[Optional[list]] = mapped_column(JSON)
    first_seen: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    last_seen: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)

    observations: Mapped[list["Observation"]] = relationship(back_populates="entity")


class Observation(Base):
    __tablename__ = "observations"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    entity_id: Mapped[str] = mapped_column(
        String(64), ForeignKey("entities.entity_id", ondelete="CASCADE"), index=True
    )
    ts: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)
    lat: Mapped[Optional[float]] = mapped_column(Float)
    lon: Mapped[Optional[float]] = mapped_column(Float)
    altitude: Mapped[Optional[float]] = mapped_column(Float)
    heading: Mapped[Optional[float]] = mapped_column(Float)
    speed: Mapped[Optional[float]] = mapped_column(Float)
    vertical_rate: Mapped[Optional[float]] = mapped_column(Float)
    status: Mapped[Optional[str]] = mapped_column(String(64))
    signal_quality: Mapped[Optional[float]] = mapped_column(Float)
    raw_payload: Mapped[Optional[dict]] = mapped_column(JSON)
    geom: Mapped[Optional[object]] = mapped_column(Geometry("POINT", srid=4326))

    entity: Mapped["Entity"] = relationship(back_populates="observations")

    __table_args__ = (Index("ix_observations_entity_ts", "entity_id", "ts"),)


class Event(Base):
    __tablename__ = "events"

    event_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    event_type: Mapped[str] = mapped_column(String(64), index=True)
    entity_id: Mapped[Optional[str]] = mapped_column(String(64), index=True)
    ts: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)
    severity: Mapped[str] = mapped_column(String(16), default="info")
    summary: Mapped[str] = mapped_column(Text)
    details: Mapped[Optional[dict]] = mapped_column(JSON)


class Geofence(Base):
    __tablename__ = "geofences"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(128))
    description: Mapped[Optional[str]] = mapped_column(Text)
    zone_type: Mapped[str] = mapped_column(String(32), default="alert")
    geom: Mapped[object] = mapped_column(Geometry("POLYGON", srid=4326))
    active: Mapped[bool] = mapped_column(Boolean, default=True)
