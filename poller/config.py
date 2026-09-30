from pydantic import BaseModel, field_validator
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
    import yaml
    import os
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
    database_url: str = "postgresql+asyncpg://vertex@localhost:5432/vertex"
    log_level: str = "INFO"
    # Optional integrations; enable when an ACARS decoder / MQTT broker source exists.
    acars_enabled: bool = False
    mqtt_enabled: bool = False
    # Diagnostic: when > 0, trace allocations and log the top sites every N
    # minutes. Adds memory/CPU overhead — leave at 0 in normal operation.
    poller_memprofile_minutes: int = 0

    @property
    def regions(self) -> list[RegionConfig]:
        return load_regions(self)

    # Home location (Tualatin)
    region_lat: float = 45.3842
    region_lon: float = -122.7635
    region_name: str = "Tualatin Valley"
    # IANA timezone used to render local times in the AI briefing.
    region_timezone: str = "America/Los_Angeles"

    # Tualatin/Portland Metro bounding box
    bbox_min_lat: float = 44.8
    bbox_max_lat: float = 45.9
    bbox_min_lon: float = -123.5
    bbox_max_lon: float = -121.8

    # NWS
    nws_station_primary: str = "KHIO"
    # Other NWS/ASOS stations around the region, shown alongside the primary one.
    nws_nearby_stations: str = "KPDX,KTTD,KVUO,KSPB,KUAO"
    nws_station_secondary: str = "KUAO"
    nws_zone: str = "ORZ109"
    # Fallback alert zones used only if alert_zone_configs table is empty on startup.
    # Populated from sources.yml alert_zones section after first run.
    nws_alert_zones: str = "ORZ108,ORZ109,ORZ111,ORZ112,ORZ115,ORC067,ORC051,ORC005,ORZ684"

    # ODOT TripCheck Data API (free key from developer.odot.state.or.us)
    odot_incidents_url: str = ""  # deprecated RSS URL, kept for backward compat
    odot_api_key: str = ""         # set to enable the new TripCheck REST API

    # Traffic flow corridor filter — comma-separated highway name fragments.
    # Only detector stations whose highway name contains one of these fragments
    # are included in the traffic:flow feed. Override to match your region.
    traffic_flow_corridors: str = "I-5,I-205,I-84,I-405,US26,OR-217"

    # EPA AirNow AQI API (free key from airnowapi.org)
    airnow_api_key: str = ""

    # Wildfire relevance controls
    # Local fires within the configured bbox or alert radius remain alertable.
    # Regional fires are retained for awareness, but older regional incidents
    # are dropped to keep the feed operationally relevant.
    # NASA FIRMS satellite hotspots (free key: firms.modaps.eosdis.nasa.gov/api/map_key)
    firms_map_key: str = ""
    firms_radius_km: int = 150
    fire_alert_radius_km: int = 150
    fire_alert_recent_hours: int = 720    # 30 days
    fire_regional_radius_km: int = 1200
    fire_regional_recent_hours: int = 72   # 3 days — only recently updated (active) fires
    # NIFC perimeters older than this (by last update) are not fetched.
    nifc_perimeter_max_age_days: int = 30

    # MeshCore API key is kept out of source URLs, API responses, and logs.
    meshcore_api_key: str = ""

    # AI situational summary — any OpenAI-compatible /chat/completions endpoint
    # (LocalAI, llama.cpp, vLLM, Ollama, LM Studio, OpenAI). SUMMARY_LLM_API_BASE
    # is the server root or its /v1 URL; a leading "openai/" on the model name
    # is accepted and stripped. Examples:
    #   SUMMARY_LLM_MODEL=qwen3.5-9b-instruct   SUMMARY_LLM_API_BASE=http://ai-node:8080
    #   SUMMARY_LLM_MODEL=llama3.2              SUMMARY_LLM_API_BASE=http://host:11434/v1
    #   SUMMARY_LLM_MODEL=gpt-4o-mini           (OpenAI; requires SUMMARY_LLM_API_KEY)
    # Leave SUMMARY_LLM_MODEL blank to disable the summary poller entirely.
    summary_llm_model: str = ""
    summary_llm_api_key: str = ""
    summary_llm_api_base: str = ""
    # Output token budget for the summary completion. Reasoning ("thinking")
    # models spend part of this budget on an internal reasoning trace before
    # emitting the final answer, so a small value can starve the answer
    # entirely — raise this if SUMMARY_LLM_MODEL is a reasoning model.
    summary_llm_max_tokens: int = 4096
    # How often the briefing is regenerated, and how many hours of history it covers.
    summary_interval_minutes: int = 60
    summary_window_hours: int = 24
    # Minimum seconds between generations (rate-limits on-demand refreshes
    # from the UI and retries after a failed LLM call).
    summary_min_regen_s: int = 600
    # Request timeout — reasoning models on local hardware can take minutes.
    summary_llm_timeout_s: int = 600
    # Optional sampling / reasoning controls. Blank = provider default.
    summary_llm_temperature: str = ""
    summary_llm_reasoning_effort: str = ""   # low | medium | high
    # Raw JSON merged into the request body, for server-specific knobs, e.g.
    # {"chat_template_kwargs": {"enable_thinking": true}} on vLLM/llama.cpp.
    summary_llm_extra_body: str = ""
    # Past briefings kept in Redis (newest first) for trend comparison.
    summary_history_len: int = 24
    # Hours of P25 transcripts mined for structured radio incidents
    # (feed:radio:incidents and the briefing's radio section).
    radio_incidents_window_hours: int = 24

    # Advisory bar (advisories.py): what counts as "near" and "recent".
    advisory_radius_km: float = 8.0                 # ~5 mi from REGION_LAT/LON
    advisory_radio_max_age_minutes: int = 60
    advisory_traffic_max_age_hours: int = 24
    # FlashAlert notices only surface when they name one of these places.
    advisory_places: str = ("Tualatin,Tigard,Sherwood,Beaverton,Lake Oswego,West Linn,Wilsonville,"
                            "King City,Durham,Aloha,Hillsboro,Washington County,Clackamas County,TVF&R,"
                            "Tualatin Valley Fire")
    # Self-hosted Nominatim for locating radio incidents (see infra/nominatim/).
    # Blank disables geocoding.
    geocoder_url: str = ""
    # State name passed to structured searches (must match the imported extract).
    geocoder_state: str = "Oregon"
    # Days of history used as the "normal" baseline for event and radio volume.
    summary_baseline_days: int = 7
    # Character budget for the data context (~4 chars per token). Lowest-priority
    # sections (news, then transcripts) are trimmed first to fit. The model's
    # context window must hold this + the system prompt (~1k tokens) + the
    # whole reasoning trace + the answer — size it accordingly.
    summary_context_max_chars: int = 24000

    # AISstream.io public cloud fallback (used when no local ais sources in DB)
    aisstream_api_key: str = ""

    # APRS-IS fallback login/filter settings
    aprs_callsign: str = "N0CALL"
    aprs_passcode: str = "-1"
    aprs_filter_radius_km: int = 80

    # MeshCore node gating — a pyMC-Repeater advert table covers the whole
    # regional mesh (every node it has ever heard an advert for), not just
    # nearby RF neighbors. When enabled, nodes advertising a position outside
    # the configured region bbox(es), padded by mesh_bbox_pad_deg degrees,
    # are dropped — mirroring the ADS-B/AIS/Amtrak bbox gating. Nodes with no
    # advertised position always pass (they cannot clutter the map).
    mesh_bbox_filter: bool = True
    mesh_bbox_pad_deg: float = 0.25

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
    # Exact hostnames/IPs allowed to resolve to private ranges for intentional LAN integrations.
    private_host_allowlist: list[str] = []
    allow_private_ips: bool = False  # deprecated; retained only for config compatibility
    # On a fresh install with no region chosen, wait for the setup wizard before polling anything.
    setup_gate: bool = True

    # Seconds since the last resolved CPR fix before a BEAST track's position
    # is flagged stale (freezes client-side extrapolation without dead reckoning).
    adsb_position_stale_seconds: int = 10
    # Maximum age of the last position fix (seconds) that the decoder will
    # dead-reckon forward using the aircraft's last known velocity. Beyond
    # this the position freezes at the last real fix. 0 disables dead reckoning.
    adsb_dead_reckon_max_seconds: int = 60

    # Mode D — OpenSky supplement alongside local sources (beast or ultrafeeder).
    # When enabled, OpenSky polls on its own interval and fills in aircraft not
    # seen locally within adsb_opensky_stale_threshold seconds. On by default —
    # most OpenSky users register a free account, which makes the fast cadence
    # below safe and gives a smooth ~30s handover when BEAST hits a signal gap.
    adsb_opensky_supplement: bool = True
    # Seconds between OpenSky polls. One poll costs 1 credit for our bbox. OpenSky only fills
    # gaps the community feed misses, so 120s (~720/day) is plenty. Anonymous polling is floored at 220s.
    adsb_opensky_interval: int = 120
    # Seconds since last local sighting before OpenSky may update an aircraft.
    adsb_opensky_stale_threshold: int = 25
    # Write OpenSky supplement positions to the observations table.
    adsb_opensky_record_observations: bool = True
    # OpenSky API client (OAuth2 client credentials — create one on your OpenSky account page).
    # Username/password Basic auth is no longer accepted, so without these the poller is anonymous
    # (400 credits/day). Registered: 4000/day; accounts with an active feeder: 8000/day.
    adsb_opensky_client_id: str = ""
    adsb_opensky_client_secret: str = ""

    # Community ADS-B supplement: free readsb-style APIs (airplanes.live, adsb.fi). Unlike OpenSky
    # they have no daily credit quota, and they include registration / type / registered owner.
    # Aircraft your own receiver saw recently are left alone, exactly as with the OpenSky supplement.
    # URLs are tried in order; {lat} {lon} {radius} are filled from REGION_LAT/LON and the radius below.
    adsb_community_supplement: bool = True
    adsb_community_urls: str = (
        "https://api.airplanes.live/v2/point/{lat}/{lon}/{radius},"
        "https://opendata.adsb.fi/api/v2/lat/{lat}/lon/{lon}/dist/{radius}"
    )
    adsb_community_interval: int = 15          # both services allow 1 request/second
    adsb_community_radius_nm: int = 75
    adsb_community_stale_threshold: int = 25
    adsb_community_record_observations: bool = True

    # Observation persistence mode
    # record: persist every observation row (current behavior)
    # live_only: keep live entity updates, skip observation inserts
    adsb_history_mode: str = "record"
    adsb_enrichment_cache_dir: str = "/data"
    adsb_aircraft_db_path: str = "/data/aircraft_db.csv.gz"
    adsb_airports_db_path: str = "/data/airports.csv"
    adsb_airlines_db_path: str = "/data/airlines.dat"
    adsb_navaids_db_path: str = "/data/navaids.csv"

    # TAK/CoT — COT_TAKSERVER_HOST/PORT is shared by both emitter and receiver.
    # Standard TAK Server: port 8087. OpenTAK Server (OTS): port 8088.
    # Leave host blank to use UDP multicast instead of a TAK server.
    cot_enabled: bool = False
    cot_multicast_addr: str = "239.2.3.1"
    cot_multicast_port: int = 6969
    cot_stale_seconds: int = 60
    cot_takserver_host: str = ""
    cot_takserver_port: int = 8087
    # Comma-separated entity types to emit. Empty = all types.
    # Known types: aircraft, vessel, aprs, mesh_node, fire_incident, tak_client
    cot_entity_types: str = ""

    # Enable receive direction (OTS → Vertex). Uses cot_takserver_host/port.
    cot_receive_enabled: bool = False

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
    # OP25's audio websocket (multi_rx "destination": ws://host:9000). When set,
    # calls are recorded straight from OP25's decoded PCM — lossless and
    # without the Icecast delay — instead of from the radio stream.
    p25_audio_ws_url: str = ""

    # NWS text products (NWWS-style). The API files products under different
    # location ids: forecaster products (AFD, LSR, CF6) under the Weather
    # Forecast Office id (Portland = PQR), climate reports (CF6) under the
    # climate station id (Portland = PDX).
    nws_office: str = "PQR"
    nws_climate_station: str = "PDX"

    @field_validator("private_host_allowlist", mode="before")
    @classmethod
    def parse_private_host_allowlist(cls, v):
        if isinstance(v, str):
            return [x.strip().lower().rstrip(".") for x in v.split(",") if x.strip()]
        return v

    class Config:
        env_file = ".env"


settings = Settings()
