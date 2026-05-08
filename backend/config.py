from pydantic import model_validator
from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    database_url: str = "postgresql+asyncpg://vertex:vertex@localhost:5432/vertex"
    redis_url: str = "redis://localhost:6379"
    log_level: str = "INFO"

    region_lat: float = 45.3842
    region_lon: float = -122.7635
    bbox_min_lat: float = 44.8
    bbox_max_lat: float = 45.9
    bbox_min_lon: float = -123.5
    bbox_max_lon: float = -121.8

    # Authentication (disabled by default — set AUTH_ENABLED=true to activate)
    auth_enabled: bool = False
    auth_secret_key: str = ""       # generate: openssl rand -hex 32
    auth_token_expire_hours: int = 24

    cors_origins: list[str] = ["http://localhost:3000", "http://localhost"]

    @model_validator(mode="after")
    def _check_secret(self):
        if self.auth_enabled and len(self.auth_secret_key) < 32:
            raise ValueError("AUTH_SECRET_KEY must be ≥32 chars when AUTH_ENABLED=true")
        return self

    class Config:
        env_file = ".env"


settings = Settings()
