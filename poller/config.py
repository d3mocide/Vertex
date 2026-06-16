from pydantic import BaseModel
from pydantic_settings import BaseSettings
from typing import Optional


class RegionBbox(BaseModel):
    min_lat: float
    max_lat: float
    min_lon: float
    max_lon: float


class RegionConfig(BaseModel):
    id: str
    name: str
    bbox: RegionBbox
    enabled: bool = True
    show_on_map: bool = True


def load_regions(settings: Optional["Settings"] = None) -> list[RegionConfig]:
    """Load regions from sources.yml, falling back to the single bbox from settings."""
    import yaml, os
    from config import settings as global_settings
    s = settings or global_settings
    sources_path = os.environ.get("SOURCES_YML", "/config/sources.yml")
    try:
        if os.path.exists(sources_path):
            with open(sources_path) as f:
                data = yaml.safe_load(f) or {}
            raw = data.get("regions") or []
            regions = [RegionConfig(**r) for r in raw if r.get("enabled", True)]
            if regions:
                return regions
    except Exception:
        pass
    # Fallback: build a single region from env-var bbox
    return [RegionConfig(
        id="default",
        name=s.region_name,
        bbox=RegionBbox(
            min_lat=s.bbox_min_lat,
            max_lat=s.bbox_max_lat,
            min_lon=s.bbox_min_lon,
            max_lon=s.bbox_max_lon,
        ),
    )]


class Settings(BaseSettings):
    redis_url: str = "redis://localhost:6379"
    database_url: str = "postgresql+asyncpg://vertex:vertex@localhost:5432/vertex"
    log_level: str = "INFO"

    @property
    def regions(self) -> list[RegionConfig]:
        return load_regions(self)

    # Home location (Tualatin)
    region_lat: float = 45.3842
    region_lon: float = -122.7635
    region_name: str = "Tualatin Valley"

    # Tualatin/Portland Metro bounding box
    bbox_min_lat: float = 44.8
    bbox_max_lat: float = 45.9
    bbox_min_lon: float = -123.5
    bbox_max_lon: float = -121.8

    # NWS
    nws_station_primary: str = "KHIO"
    nws_station_secondary: str = "KUAO"
    nws_zone: str = "ORZ006"
    # Fallback alert zones used only if alert_zone_configs table is empty on startup.
    # Populated from sources.yml alert_zones section after first run.
    nws_alert_zones: str = "ORZ006,ORZ005,ORZ007"

    # ODOT TripCheck Data API (free key from developer.odot.state.or.us)
    odot_incidents_url: str = ""  # deprecated RSS URL, kept for backward compat
    odot_api_key: str = ""         # set to enable the new TripCheck REST API

    # Traffic flow corridor filter — comma-separated highway name fragments.
    # Only detector stations whose highway name contains one of these fragments
    # are included in the traffic:flow feed. Override to match your region.
    traffic_flow_corridors: str = "I-5,99W,Pacific Highway"

    # EPA AirNow AQI API (free key from airnowapi.org)
    airnow_api_key: str = ""

    # Wildfire relevance controls
    # Local fires within the configured bbox or alert radius remain alertable.
    # Regional fires are retained for awareness, but older regional incidents
    # are dropped to keep the feed operationally relevant.
    fire_alert_radius_km: int = 150
    fire_alert_recent_hours: int = 720    # 30 days
    fire_regional_radius_km: int = 1200
    fire_regional_recent_hours: int = 336  # 14 days

    # AI situational summary — configure any LiteLLM-compatible model.
    # Examples:
    #   anthropic/claude-haiku-4-5-20251001  (requires SUMMARY_LLM_API_KEY)
    #   ollama/llama3.2                       (requires SUMMARY_LLM_API_BASE=http://host:11434)
    #   openai/gpt-4o-mini                    (requires SUMMARY_LLM_API_KEY)
    # Leave SUMMARY_LLM_MODEL blank to disable the summary poller entirely.
    summary_llm_model: str = ""
    summary_llm_api_key: str = ""
    summary_llm_api_base: str = ""

    # AISstream.io public cloud fallback (used when no local ais sources in DB)
    aisstream_api_key: str = ""

    # APRS-IS fallback login/filter settings
    aprs_callsign: str = "N0CALL"
    aprs_passcode: str = "-1"
    aprs_filter_radius_km: int = 80

    # ADS-B ingest strategy
    adsb_enable_beast: bool = False
    adsb_beast_host: str = "localhost"
    adsb_beast_port: int = 30005
    adsb_beast_reconnect_initial_seconds: int = 1
    adsb_beast_reconnect_max_seconds: int = 30
    # Seconds without a BEAST frame before the transport is considered unhealthy
    # and the HTTP fallback (if local sources are configured) takes over.
    adsb_beast_stale_threshold_seconds: int = 30
    # Deprecated — HTTP fallback now activates automatically on BEAST health.
    # Kept here so existing .env files do not cause a validation error.
    adsb_beast_http_fallback: bool = True
    adsb_publish_only_changes: bool = True
    allow_private_ips: bool = False

    # Mode D — OpenSky supplement alongside local sources (beast or ultrafeeder).
    # When enabled, OpenSky polls on its own interval and fills in aircraft not
    # seen locally within adsb_opensky_stale_threshold seconds. On by default —
    # most OpenSky users register a free account, which makes the fast cadence
    # below safe and gives a smooth ~30s handover when BEAST hits a signal gap.
    adsb_opensky_supplement: bool = True
    # Seconds between OpenSky polls. With credentials 30s is safe (~2880 req/day
    # vs 4000 limit). Anonymous (no credentials) budget is ~400 req/day — raise
    # this to >= 220s for anonymous use to avoid being rate limited.
    adsb_opensky_interval: int = 30
    # Seconds since last local sighting before OpenSky may update an aircraft.
    adsb_opensky_stale_threshold: int = 25
    # Write OpenSky supplement positions to the observations table.
    adsb_opensky_record_observations: bool = True
    # Optional OpenSky Network credentials (https://opensky-network.org).
    # Authenticated accounts receive 10x the anonymous request budget.
    adsb_opensky_username: str = ""
    adsb_opensky_password: str = ""

    # Observation persistence mode
    # record: persist every observation row (current behavior)
    # live_only: keep live entity updates, skip observation inserts
    adsb_history_mode: str = "record"
    adsb_enrichment_cache_dir: str = "/data"
    adsb_aircraft_db_path: str = "/data/aircraft_db.csv.gz"
    adsb_airports_db_path: str = "/data/airports.csv"
    adsb_airlines_db_path: str = "/data/airlines.dat"
    adsb_navaids_db_path: str = "/data/navaids.csv"

    # TAK/CoT output — set COT_ENABLED=true to broadcast entity positions
    # to ATAK/WinTAK clients via UDP multicast or a dedicated TAK server.
    cot_enabled: bool = False
    cot_multicast_addr: str = "239.2.3.1"
    cot_multicast_port: int = 6969
    cot_stale_seconds: int = 60
    # Optional unicast to a TAK server (overrides multicast when set)
    cot_takserver_host: str = ""
    cot_takserver_port: int = 8087

    # TAK/CoT ingest — set COT_RECEIVE_ENABLED=true to receive CoT from openTAK.
    # Connects to openTAK via TCP streaming; ingests field operator positions as
    # tak_client entities and TAK map markers as Vertex annotations.
    cot_receive_enabled: bool = False
    cot_receive_host: str = ""
    cot_receive_port: int = 8087

    # Anomaly detection — statistical baseline monitoring
    anomaly_enabled: bool = True
    anomaly_window_minutes: int = 60   # rolling window for baseline
    anomaly_sigma_threshold: float = 2.5

    # FlashAlert and TVFR alert feed env-var fallbacks
    flashalert_enabled: bool = False
    flashalert_url: str = ""
    tvfr_enabled: bool = False
    tvfr_rss_url: str = ""

    # TriMet GTFS-RT — Portland Metro rail (MAX light rail, WES commuter, Portland Streetcar)
    # Free AppID at: https://developer.trimet.org/
    trimet_gtfs_enabled: bool = False
    trimet_app_id: str = ""
    trimet_gtfs_static_url: str = "https://developer.trimet.org/schedule/gtfs.zip"
    trimet_gtfs_rt_url: str = "https://developer.trimet.org/ws/gtfs/VehiclePositions"
    # Comma-separated GTFS route type ints: 0=Tram, 1=Light Rail, 2=Rail
    trimet_route_types: str = "0,1,2"
    trimet_poll_interval: int = 15

    # P25 audio archiving — records per-call audio segments from the Icecast stream.
    # Requires an enabled RadioStream in the DB. Disabled by default.
    p25_audio_enabled: bool = False
    p25_audio_dir: str = "/data/audio"
    p25_audio_retention_days: int = 7
    p25_audio_delay_seconds: float = 0.0

    # NWS text products (NWWS-style). Office code for the local forecast office.
    nws_office: str = "PDX"

    # Weather Underground / Weather Company Personal Weather Station.
    # Obtain an API key at https://www.wunderground.com/member/api-keys
    wunderground_api_key: str = ""
    wunderground_station_id: str = ""

    class Config:
        env_file = ".env"


settings = Settings()
