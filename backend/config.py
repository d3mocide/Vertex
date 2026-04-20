from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    database_url: str = "postgresql+asyncpg://civicgrid:civicgrid@localhost:5432/civicgrid"
    redis_url: str = "redis://localhost:6379"
    log_level: str = "INFO"

    region_lat: float = 45.3842
    region_lon: float = -122.7635
    bbox_min_lat: float = 44.8
    bbox_max_lat: float = 45.9
    bbox_min_lon: float = -123.5
    bbox_max_lon: float = -121.8

    class Config:
        env_file = ".env"


settings = Settings()
