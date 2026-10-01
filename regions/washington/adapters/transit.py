"""Reviewed official transit feeds; credentials come only from server settings."""
SOURCES = {'ctran-transit': {'name': 'ctran',
                   'label': 'C-TRAN',
                   'static_url': '',
                   'realtime_url': '',
                   'bbox': (-123.0, 45.4, -122.2, 46.1),
                   'unavailable': 'access_unverified'},
 'soundtransit-transit': {'name': 'soundtransit',
                          'label': 'Sound Transit',
                          'static_url': 'https://www.soundtransit.org/GTFS-rail/40_gtfs.zip',
                          'realtime_url': 'https://api.pugetsound.onebusaway.org/api/gtfs_realtime/vehicle-positions-for-agency/40.pb',
                          'key': 'soundtransit_api_key',
                          'key_param': 'key',
                          'bbox': (-123.2, 46.8, -121.3, 48.3)}}
