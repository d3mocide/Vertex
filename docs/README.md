# Vertex Documentation

This directory is the primary home for project documentation.

Use the top-level [README.md](../README.md) for a quick overview. Use the pages here when you need implementation detail, setup guidance, or configuration reference.

## Start Here

- [Getting Started](getting-started.md) for first-run setup and local bring-up
- [Architecture Overview](architecture/overview.md) for container roles and data flow
- [Feature Overview](features/overview.md) for the current capability surface
- [Map Key](map-key.md) for symbol, zoom, and color reference
- [Environment Configuration](configuration/environment.md) for `.env` settings
- [Source Configuration](configuration/sources.md) for `config/sources.yml`
- [Poller Filtering and Distance Rules](configuration/poller-filtering.md) for BBOX, radius, and relevance logic by source

## Documentation Structure

### Project Guides

- [Getting Started](getting-started.md)

### Configuration Reference

- [Environment Configuration](configuration/environment.md)
- [Source Configuration](configuration/sources.md)
- [Poller Filtering and Distance Rules](configuration/poller-filtering.md)

### Product Documentation

- [Feature Overview](features/overview.md)
- [Map Key](map-key.md)

### System Design

- [Architecture Overview](architecture/overview.md)

## Documentation Intent

This structure is intentionally split by topic rather than accumulated into a single root README. As new features and settings are added, prefer extending the relevant page here instead of expanding the top-level project summary.