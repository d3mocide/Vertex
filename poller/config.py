from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    redis_url: str = "redis://localhost:6379"
    database_url: str = "postgresql+asyncpg://outpost:outpost@localhost:5432/outpost"
    log_level: str = "INFO"

    # Home location (Tualatin)
    region_lat: float = 45.3842
    region_lon: float = -122.7635

    # Tualatin/Portland Metro bounding box
    bbox_min_lat: float = 44.8
    bbox_max_lat: float = 45.9
    bbox_min_lon: float = -123.5
    bbox_max_lon: float = -121.8

    # NWS
    nws_station_primary: str = "KHIO"
    nws_station_secondary: str = "KUAO"
    nws_zone: str = "ORZ006"
    # Multi-county NWS alert zones (Washington, Multnomah, Clackamas counties)
    nws_alert_zones: str = "ORZ006,ORZ005,ORZ007"

    # ODOT TripCheck Data API (free key from developer.odot.state.or.us)
    odot_incidents_url: str = ""  # deprecated RSS URL, kept for backward compat
    odot_api_key: str = ""         # set to enable the new TripCheck REST API

    # EPA AirNow AQI API (free key from airnowapi.org)
    airnow_api_key: str = ""

    # Local ADS-B — Ultrafeeder tar1090
    # Option A: Set ULTRAFEEDER_URL to the full aircraft.json URL
    #   e.g. http://192.168.1.50/data/aircraft.json
    # Option B: Set ULTRAFEEDER_HOST + ULTRAFEEDER_PORT (port 80 = HTTP tar1090)
    ultrafeeder_url: str = ""   # direct URL override (takes precedence)
    ultrafeeder_host: str = ""  # hostname / IP of external ultrafeeder
    ultrafeeder_port: int = 80  # tar1090 HTTP port (NOT the TCP beast port 30047)

    # Local AIS-catcher WebSocket
    ais_catcher_host: str = ""
    ais_catcher_port: int = 8100

    # AISstream.io public fallback
    aisstream_api_key: str = ""

    # OP25 HTTP terminal (used when running in compose with sdr profile)
    op25_host: str = ""
    op25_port: int = 8080

    # MeshCore bridge WebSocket
    meshcore_bridge_host: str = ""
    meshcore_bridge_port: int = 7001

    class Config:
        env_file = ".env"


settings = Settings()
