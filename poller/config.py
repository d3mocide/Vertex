from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    redis_url: str = "redis://localhost:6379"
    database_url: str = "postgresql+asyncpg://civicgrid:civicgrid@localhost:5432/civicgrid"
    log_level: str = "INFO"

    bbox_min_lat: float = 44.8
    bbox_max_lat: float = 45.9
    bbox_min_lon: float = -123.5
    bbox_max_lon: float = -121.8

    nws_station_primary: str = "KHIO"
    nws_station_secondary: str = "KUAO"
    nws_zone: str = "ORZ006"

    odot_incidents_url: str = "https://tripcheck.com/Scripts/rss.asp?CMS=true&RSS=TripCheck"

    ultrafeeder_host: str = ""
    ultrafeeder_port: int = 30047

    ais_catcher_host: str = ""
    ais_catcher_port: int = 8100

    aisstream_api_key: str = ""

    class Config:
        env_file = ".env"


settings = Settings()
