from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    database_url: str = "postgresql+asyncpg://vertex:vertex@db:5432/vertex"
    redis_url: str = "redis://redis:6379"
    log_level: str = "INFO"

    # Whisper model configuration — tune to match available RAM on the Pi.
    # tiny (~150 MB RAM, fastest), base (~300 MB), small (~600 MB), medium (~1.5 GB)
    whisper_model: str = "base"
    # ISO 639-1 code (e.g. "en"), or "auto" to let Whisper detect per-call.
    whisper_language: str = "en"
    # int8 is the fastest/lowest-RAM option for CPU inference.
    whisper_compute_type: str = "int8"
    whisper_device: str = "cpu"

    p25_audio_dir: str = "/data/audio"
    # How often (seconds) to scan the audio directory for new files.
    scan_interval: float = 5.0

    class Config:
        env_file = ".env"


settings = Settings()
