FROM ubuntu:22.04

ENV DEBIAN_FRONTEND=noninteractive
ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1

RUN apt-get update && apt-get install -y --no-install-recommends \
    gnuradio \
    python3-pip \
    python3-requests \
    python3-yaml \
    python3-numpy \
    rtl-sdr \
    librtlsdr-dev \
    git \
    curl \
    && rm -rf /var/lib/apt/lists/*

RUN git clone --depth=1 https://github.com/boatbod/op25.git /op25

WORKDIR /op25/op25/apps

# User-supplied config is mounted at /op25-config at runtime
COPY start.sh /start.sh
RUN chmod +x /start.sh

EXPOSE 8080

HEALTHCHECK --interval=15s --timeout=5s --retries=3 \
    CMD curl -sf http://localhost:8080/ || exit 1

CMD ["/start.sh"]
