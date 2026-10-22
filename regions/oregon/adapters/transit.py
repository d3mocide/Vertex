"""Built-in reviewed transit feeds; credentials come only from server settings.

Agencies that need no operator settings are declared in the packs instead (kind gtfs_rt). TriMet stays here because legacy
installs with no pack still resolve it and its URLs, route types and interval are operator settings."""
SOURCES = {'trimet-transit': {'name': 'trimet',
                    'label': 'TriMet',
                    'static_url': 'https://developer.trimet.org/schedule/gtfs.zip',
                    'realtime_url': 'https://developer.trimet.org/ws/gtfs/VehiclePositions',
                    'alerts_url': 'https://developer.trimet.org/ws/V1/FeedSpecAlerts',
                    'key': 'trimet_app_id',
                    'key_param': 'appID',
                    'bbox': (-123.3, 45.1, -122.2, 45.85),
                    'static_setting': 'trimet_gtfs_static_url',
                    'realtime_setting': 'trimet_gtfs_rt_url',
                    'modes_setting': 'trimet_route_types',
                    'interval_setting': 'trimet_poll_interval',
                    'enabled_setting': 'trimet_gtfs_enabled'}}
