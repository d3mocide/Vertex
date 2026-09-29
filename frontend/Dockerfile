# Build stage
FROM node:20-alpine AS build
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm config set fetch-retries 5 \
    && npm config set fetch-retry-mintimeout 20000 \
    && npm config set fetch-retry-maxtimeout 120000 \
    && npm ci
COPY . .
# VITE_ vars are baked into the bundle at build time; pass via docker-compose build.args
ARG VITE_REGION_LAT=45.3842
ARG VITE_REGION_LON=-122.7635
ARG VITE_REGION_NAME=Tualatin Valley
ARG VITE_RADAR_LAYER=RTX-N0Q-0
ARG VITE_OBSERVATION_RANGE_KM=50
ENV VITE_REGION_LAT=$VITE_REGION_LAT
ENV VITE_REGION_LON=$VITE_REGION_LON
ENV VITE_REGION_NAME="$VITE_REGION_NAME"
ENV VITE_RADAR_LAYER=$VITE_RADAR_LAYER
ENV VITE_OBSERVATION_RANGE_KM=$VITE_OBSERVATION_RANGE_KM
RUN npm run build

# Serve stage
FROM nginx:alpine
COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
