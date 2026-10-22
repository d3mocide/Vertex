# Nominatim's browser interface (nominatim-ui), served next to the API so one port does both.
FROM nginxinc/nginx-unprivileged:alpine@sha256:26b0bf6fbf07297983cb341998d79c831508787de26627dd2a112321b9c3a4af
ARG UI_VERSION=3.12.0
ARG UI_SHA256=12dfeb312626058983a52cbb784c2ef5fb4a2d70ecfb889773083cfb7848ff97
USER root
RUN wget -q -O /tmp/ui.tgz "https://github.com/osm-search/Nominatim-UI/releases/download/v${UI_VERSION}/nominatim-ui-${UI_VERSION}.tar.gz" \
 && echo "${UI_SHA256}  /tmp/ui.tgz" | sha256sum -c - \
 && tar xzf /tmp/ui.tgz -C /tmp \
 && cp -r /tmp/nominatim-ui-${UI_VERSION}/dist/. /usr/share/nginx/html/ \
 && rm -rf /tmp/ui.tgz /tmp/nominatim-ui-${UI_VERSION}
COPY config.theme.js /usr/share/nginx/html/theme/config.theme.js
COPY nginx.conf /etc/nginx/conf.d/default.conf
USER nginx
