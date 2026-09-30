from pydantic import field_validator, model_validator
from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    database_url: str = "postgresql+asyncpg://vertex@localhost:5432/vertex"
    redis_url: str = "redis://localhost:6379"
    log_level: str = "INFO"

    region_lat: float = 45.3842
    region_lon: float = -122.7635
    bbox_min_lat: float = 44.8
    bbox_max_lat: float = 45.9
    bbox_min_lon: float = -123.5
    bbox_max_lon: float = -121.8
    region_name: str = "Default"
    region_timezone: str = "America/Los_Angeles"
    nws_alert_zones: str = ""  # presence pins alert-zone selection; value stays server-side
    # Only used to tell the capabilities endpoint whether the ODOT provider is configured.
    odot_api_key: str = ""
    wsdot_api_key: str = ""       # WSDOT Traveler API access code; never expose its value
    # Shared with the poller; never embed this credential in a stored source URL.
    meshcore_api_key: str = ""

    # Self-hosted Nominatim used for city/county boundary lookup in the
    # geofence UI (same variables as the poller). Blank disables city lookup.
    geocoder_url: str = ""
    geocoder_state: str = "Oregon"
    # ZIP-code boundaries come from the US Census TIGERweb service (sends the
    # searched ZIP to census.gov). Set false to keep lookups fully local.
    boundary_zip_lookup_enabled: bool = True

    # Authentication (disabled by default — set AUTH_ENABLED=true to activate)
    auth_enabled: bool = False
    auth_secret_key: str = ""       # generate: openssl rand -hex 32
    auth_token_expire_hours: int = 8
    auth_cookie_secure: bool = False
    allowed_hosts: list[str] = ["localhost", "127.0.0.1", "[::1]"]
    trusted_proxies: list[str] = ["127.0.0.1/32", "::1/128", "172.16.0.0/12"]

    cors_origins: list[str] = ["http://localhost:3000", "http://localhost"]

    cors_allow_credentials: bool = False

    @field_validator("cors_origins", mode="before")
    @classmethod
    def parse_cors_origins(cls, v):
        if isinstance(v, str):
            return [x.strip() for x in v.split(",") if x.strip()]
        return v

    @field_validator("allowed_hosts", "trusted_proxies", mode="before")
    @classmethod
    def parse_allowed_hosts(cls, v):
        if isinstance(v, str):
            return [x.strip() for x in v.split(",") if x.strip()]
        return v

    p25_audio_dir: str = "/data/audio"
    # Exact hostnames/IPs allowed to resolve to private ranges for intentional LAN integrations.
    private_host_allowlist: list[str] = []
    allow_private_ips: bool = False  # deprecated; retained only for config compatibility

    @model_validator(mode="after")
    def _check_secret(self):
        if self.auth_enabled and len(self.auth_secret_key) < 32:
            raise ValueError("AUTH_SECRET_KEY must be ≥32 chars when AUTH_ENABLED=true")
        return self

    @field_validator("private_host_allowlist", mode="before")
    @classmethod
    def parse_private_host_allowlist(cls, v):
        if isinstance(v, str):
            return [x.strip().lower().rstrip(".") for x in v.split(",") if x.strip()]
        return v

    class Config:
        env_file = ".env"


settings = Settings()
