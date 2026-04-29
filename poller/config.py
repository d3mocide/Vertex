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

    # ADS-B ingest strategy
    # When enabled, poller will start a BEAST TCP consumer task. During this
    # initial rollout, HTTP polling can remain enabled as a fallback path.
    adsb_enable_beast: bool = False
    adsb_beast_host: str = "localhost"
    adsb_beast_port: int = 30005
    adsb_beast_reconnect_initial_seconds: int = 1
    adsb_beast_reconnect_max_seconds: int = 30
    adsb_beast_http_fallback: bool = True
    adsb_publish_only_changes: bool = True

    # Observation persistence mode
    # record: persist every observation row (current behavior)
    # live_only: keep live entity updates, skip observation inserts
    adsb_history_mode: str = "record"
    adsb_enrichment_cache_dir: str = "/data"
    adsb_aircraft_db_path: str = "/data/aircraft_db.csv.gz"
    adsb_airports_db_path: str = "/data/airports.csv"
    adsb_airlines_db_path: str = "/data/airlines.dat"
    adsb_navaids_db_path: str = "/data/navaids.csv"

    class Config:
        env_file = ".env"


settings = Settings()
