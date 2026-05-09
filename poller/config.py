from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    redis_url: str = "redis://localhost:6379"
    database_url: str = "postgresql+asyncpg://vertex:vertex@localhost:5432/vertex"
    log_level: str = "INFO"

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

    # Mode D — OpenSky supplement alongside local sources (beast or ultrafeeder).
    # When enabled, OpenSky polls on its own interval and fills in aircraft not
    # seen locally within adsb_opensky_stale_threshold seconds.
    adsb_opensky_supplement: bool = False
    # Seconds between OpenSky polls. Anonymous budget ~400 req/day; keep >= 220s
    # for anonymous use. With credentials 30s is safe (~2880 req/day vs 4000 limit).
    adsb_opensky_interval: int = 240
    # Seconds since last local sighting before OpenSky may update an aircraft.
    adsb_opensky_stale_threshold: int = 15
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

    # TinyGS integration is sunset by default due to upstream API instability.
    # Set true to opt in and re-enable the poller.
    tinygs_enabled: bool = False

    # P25 audio archiving — records per-call audio segments from the Icecast stream.
    # Requires an enabled RadioStream in the DB. Disabled by default.
    p25_audio_enabled: bool = False
    p25_audio_dir: str = "/data/audio"
    p25_audio_retention_days: int = 7

    class Config:
        env_file = ".env"


settings = Settings()
