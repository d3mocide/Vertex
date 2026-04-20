FROM alpine:3.20

# ffmpeg is multi-arch on Alpine (amd64 + arm64)
RUN apk add --no-cache ffmpeg

COPY start.sh /start.sh
RUN chmod +x /start.sh

# No exposed port — pushes outbound to Icecast
CMD ["/start.sh"]
