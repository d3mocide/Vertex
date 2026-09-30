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
ARG VITE_RADAR_LAYER=RTX-N0Q-0
ARG VITE_OBSERVATION_RANGE_KM=50
ENV VITE_RADAR_LAYER=$VITE_RADAR_LAYER
ENV VITE_OBSERVATION_RANGE_KM=$VITE_OBSERVATION_RANGE_KM
RUN npm run build

# Serve stage
FROM nginx:alpine
COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
