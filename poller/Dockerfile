FROM python:3.12-slim@sha256:f77ac9e44ae96ef2c90b8053ea08c31f8be030f824196b0ae4db6d462c84e51f

ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
WORKDIR /app

ARG AIRCRAFT_DB_URL="https://raw.githubusercontent.com/wiedehopf/tar1090-db/655afe27950658a4124d15d75766538b1ae9ea3b/aircraft.csv.gz"
ARG AIRPORTS_DB_URL="https://raw.githubusercontent.com/davidmegginson/ourairports-data/f31ef57d6e9b67764b3c2ec2336a10bcaa4e28b6/airports.csv"
ARG AIRLINES_DB_URL="https://raw.githubusercontent.com/jpatokal/openflights/7d1a611e070295dba776d6afb86e57d0d1aa1cef/data/airlines.dat"
ARG NAVAIDS_DB_URL="https://raw.githubusercontent.com/davidmegginson/ourairports-data/f31ef57d6e9b67764b3c2ec2336a10bcaa4e28b6/navaids.csv"
ARG DATA_CACHEBUST="static"
ARG AIRCRAFT_DB_SHA256="8ef7b0f0c48e3ac30e6968ddc29d4c19e7e13226692e0bc62a29a4a81233c8ed"
ARG AIRPORTS_DB_SHA256="5cb29a038a92dbdb94d4fcdd90ce116b2b47394f456d9c43e373d683ef0c4eff"
ARG AIRLINES_DB_SHA256="39be1a432e8b04ebc12860c29281c974a9cb52169c82b2456a835d66ab1548a1"
ARG NAVAIDS_DB_SHA256="57fb332b75be1173c45fd97447611eb3fba07b2c508c2f330961b9a8976e24cb"

# jemalloc replaces glibc's allocator for the whole process. The poller's transient work (schedules, JSON feeds,
# transcripts) fragmented glibc's heap so badly that it sat at 850-1000 MB of a 1 GiB limit with ~125 MB of live
# data, and malloc_trim could not give it back; under jemalloc it runs at ~250 MB. The symlink keeps LD_PRELOAD
# independent of the CPU architecture (amd64 / arm64 install the library in different directories).
RUN apt-get update \
	&& apt-get install -y --no-install-recommends curl ca-certificates libjemalloc2 \
	&& rm -rf /var/lib/apt/lists/* \
	&& ln -s "$(ls /usr/lib/*/libjemalloc.so.2 | head -n 1)" /usr/local/lib/libjemalloc.so.2

RUN mkdir -p /data \
	&& echo "data fetch ${DATA_CACHEBUST}" \
	&& curl -fsSL -o /data/aircraft_db.csv.gz "${AIRCRAFT_DB_URL}" \
	&& curl -fsSL -o /data/airports.csv "${AIRPORTS_DB_URL}" \
	&& curl -fsSL -o /data/airlines.dat "${AIRLINES_DB_URL}" \
	&& curl -fsSL -o /data/navaids.csv "${NAVAIDS_DB_URL}" \
    && echo "${AIRCRAFT_DB_SHA256}  /data/aircraft_db.csv.gz" | sha256sum -c - \
    && echo "${AIRPORTS_DB_SHA256}  /data/airports.csv" | sha256sum -c - \
    && echo "${AIRLINES_DB_SHA256}  /data/airlines.dat" | sha256sum -c - \
    && echo "${NAVAIDS_DB_SHA256}  /data/navaids.csv" | sha256sum -c -

RUN groupadd --gid 1000 vertex \
    && useradd --uid 1000 --gid vertex --create-home vertex \
    && mkdir -p /data/audio /data/cache /config \
    && chown -R vertex:vertex /app /data /config

COPY --chown=vertex:vertex requirements.lock .
RUN pip install --no-cache-dir -r requirements.lock

COPY --chown=vertex:vertex . .

ENV LD_PRELOAD=/usr/local/lib/libjemalloc.so.2 \
    MALLOC_CONF=background_thread:true,dirty_decay_ms:3000,muzzy_decay_ms:3000

USER vertex

CMD ["python", "-u", "main.py"]
