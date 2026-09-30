FROM python:3.12-slim@sha256:f77ac9e44ae96ef2c90b8053ea08c31f8be030f824196b0ae4db6d462c84e51f

ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends curl \
    && rm -rf /var/lib/apt/lists/* \
    && groupadd --gid 1000 vertex \
    && useradd --uid 1000 --gid vertex --create-home vertex \
    && mkdir -p /data/audio /config \
    && chown -R vertex:vertex /app /data /config

COPY --chown=vertex:vertex requirements.lock .
RUN pip install --no-cache-dir -r requirements.lock
COPY --chown=vertex:vertex . .

USER vertex
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "2"]
