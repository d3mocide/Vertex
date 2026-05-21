import os
import pathlib
from typing import Literal

import yaml
from pydantic import BaseModel, field_validator

CONFIG_PATH = pathlib.Path(os.environ.get("SOURCES_CONFIG_PATH", "/config/sources.yml"))


class RadioStreamEntry(BaseModel):
    name: str
    url: str
    format: str = "mp3"
    enabled: bool = True
    source: Literal["config", "user"] = "config"


class NewsFeedEntry(BaseModel):
    name: str
    url: str | None = None
    format: str = "rss"
    enabled: bool = True
    source: Literal["config", "user"] = "config"


class PollerSourceEntry(BaseModel):
    type: Literal["adsb", "ais", "p25", "meshcore", "fire", "aprs", "acars"]
    name: str
    url: str
    enabled: bool = True
    source: Literal["config", "user"] = "config"


class MqttSourceEntry(BaseModel):
    name: str
    normalizer: Literal["rtl_433", "meshtastic", "ais"]
    broker: str = "mosquitto"
    port: int = 1883
    topic: str
    qos: int = 0
    auth_enabled: bool = False
    enabled: bool = True
    source: Literal["config", "user"] = "config"


class AlertFeedEntry(BaseModel):
    name: str
    url: str
    format: str = "rss"
    enabled: bool = True
    source: Literal["config", "user"] = "config"


class AlertZonesConfig(BaseModel):
    nws_zones: list[str] = []
    source: Literal["config", "user"] = "config"

    @field_validator("nws_zones", mode="before")
    @classmethod
    def deduplicate(cls, v: list[str]) -> list[str]:
        return list(dict.fromkeys(v))


class RegionBbox(BaseModel):
    min_lat: float
    max_lat: float
    min_lon: float
    max_lon: float


class RegionEntry(BaseModel):
    id: str
    name: str
    bbox: RegionBbox
    enabled: bool = True
    show_on_map: bool = True


class SourcesConfig(BaseModel):
    radio_streams: list[RadioStreamEntry] = []
    news_feeds: list[NewsFeedEntry] = []
    poller_sources: list[PollerSourceEntry] = []
    alert_zones: AlertZonesConfig = AlertZonesConfig()
    alert_feeds: list[AlertFeedEntry] = []
    regions: list[RegionEntry] = []
    mqtt_sources: list[MqttSourceEntry] = []


def load_sources_config() -> SourcesConfig:
    """Parse sources.yml; returns empty SourcesConfig if file is absent."""
    if not CONFIG_PATH.exists():
        return SourcesConfig()
    raw = yaml.safe_load(CONFIG_PATH.read_text()) or {}
    return SourcesConfig.model_validate(raw)
