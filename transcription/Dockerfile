FROM python:3.12-slim@sha256:f77ac9e44ae96ef2c90b8053ea08c31f8be030f824196b0ae4db6d462c84e51f

ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 HF_HOME=/models/huggingface XDG_CACHE_HOME=/models
RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg \
    && rm -rf /var/lib/apt/lists/* \
    && groupadd --gid 1000 vertex \
    && useradd --uid 1000 --gid vertex --create-home vertex \
    && mkdir -p /app /data/audio /models \
    && chown -R vertex:vertex /app /data /models

WORKDIR /app
COPY --chown=vertex:vertex requirements.lock .
RUN pip install --no-cache-dir -r requirements.lock
COPY --chown=vertex:vertex . .

USER vertex
CMD ["python", "-u", "main.py"]
