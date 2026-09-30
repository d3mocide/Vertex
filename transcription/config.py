from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    database_url: str = "postgresql+asyncpg://vertex@db:5432/vertex"
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
    # ctranslate2 intra-op threads. Left uncapped it grabs every core, starving
    # the poller/backend/map on small hosts (e.g. a 2-core VPS) whenever a P25
    # call transcribes. 1 thread still transcribes short P25 clips faster than
    # realtime with the base/int8 model; raise on hosts with cores to spare.
    whisper_cpu_threads: int = 1

    # Remote STT via LiteLLM — routes to any OpenAI-compatible
    # /audio/transcriptions endpoint (a local AI node running an
    # OpenAI-compatible whisper server, a LiteLLM proxy router, Groq, etc.)
    # instead of transcribing on this container's CPU. Leave blank to use the
    # local faster-whisper model configured above.
    whisper_remote_model: str = ""
    whisper_remote_api_base: str = ""
    whisper_remote_api_key: str = ""
    # Clean P25 audio before remote transcription: band-pass to the voice
    # band (P25 carries ~300-3400 Hz), trim leading/trailing silence,
    # loudness-normalise, 16 kHz mono WAV. On a 20-call dispatch sample with
    # whisper-large-turbo this found more units and never invented one, and
    # trimming silence cuts Whisper's "Thank you." on near-empty clips.
    whisper_preprocess: bool = True

    p25_audio_dir: str = "/data/audio"
    # How often (seconds) to scan the audio directory for new files.
    scan_interval: float = 5.0

    class Config:
        env_file = ".env"


settings = Settings()
