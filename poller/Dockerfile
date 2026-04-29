FROM python:3.12-slim

WORKDIR /app

ARG AIRCRAFT_DB_URL="https://raw.githubusercontent.com/wiedehopf/tar1090-db/refs/heads/csv/aircraft.csv.gz"
ARG AIRPORTS_DB_URL="https://davidmegginson.github.io/ourairports-data/airports.csv"
ARG AIRLINES_DB_URL="https://raw.githubusercontent.com/jpatokal/openflights/master/data/airlines.dat"
ARG NAVAIDS_DB_URL="https://davidmegginson.github.io/ourairports-data/navaids.csv"
ARG DATA_CACHEBUST="static"

RUN apt-get update \
	&& apt-get install -y --no-install-recommends curl ca-certificates \
	&& rm -rf /var/lib/apt/lists/*

RUN mkdir -p /data \
	&& echo "data fetch ${DATA_CACHEBUST}" \
	&& curl -fsSL -o /data/aircraft_db.csv.gz "${AIRCRAFT_DB_URL}" \
	&& curl -fsSL -o /data/airports.csv "${AIRPORTS_DB_URL}" \
	&& curl -fsSL -o /data/airlines.dat "${AIRLINES_DB_URL}" \
	&& curl -fsSL -o /data/navaids.csv "${NAVAIDS_DB_URL}"

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

CMD ["python", "-u", "main.py"]
