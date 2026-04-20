FROM alpine:3.20

RUN apk add --no-cache icecast gettext

COPY icecast.xml.template /etc/icecast/icecast.xml.template
COPY start.sh /start.sh
RUN chmod +x /start.sh

EXPOSE 8000

HEALTHCHECK --interval=10s --timeout=3s --retries=3 \
    CMD wget -qO- http://localhost:8000/status.xsl > /dev/null || exit 1

CMD ["/start.sh"]
