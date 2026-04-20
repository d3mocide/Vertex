-- Seed geofences for the Tualatin / Portland Metro area
-- All coordinates WGS84 (SRID 4326), approximate boundaries

INSERT INTO geofences (name, description, zone_type, geom, active) VALUES
(
    'PDX Airport Zone',
    'Portland International Airport flight operations area',
    'airport',
    ST_GeomFromText(
        'POLYGON((-122.625 45.565, -122.555 45.565, -122.555 45.605, -122.625 45.605, -122.625 45.565))',
        4326
    ),
    TRUE
),
(
    'Tualatin Valley Corridor',
    'Primary monitoring zone covering Tualatin, Sherwood, Tigard, and surrounding communities',
    'monitor',
    ST_GeomFromText(
        'POLYGON((-122.90 45.32, -122.60 45.32, -122.60 45.48, -122.90 45.48, -122.90 45.32))',
        4326
    ),
    TRUE
),
(
    'Willamette River — Portland Reach',
    'Willamette River maritime corridor through downtown Portland',
    'maritime',
    ST_GeomFromText(
        'POLYGON((-122.700 45.400, -122.655 45.400, -122.655 45.560, -122.700 45.560, -122.700 45.400))',
        4326
    ),
    TRUE
),
(
    'Columbia River — Portland Metro',
    'Columbia River main shipping channel through Portland metro area',
    'maritime',
    ST_GeomFromText(
        'POLYGON((-122.850 45.610, -122.350 45.610, -122.350 45.670, -122.850 45.670, -122.850 45.610))',
        4326
    ),
    TRUE
),
(
    'HIO — Hillsboro Airport Zone',
    'Portland-Hillsboro Airport (KHIO) operations area',
    'airport',
    ST_GeomFromText(
        'POLYGON((-122.975 45.525, -122.935 45.525, -122.935 45.555, -122.975 45.555, -122.975 45.525))',
        4326
    ),
    TRUE
),
(
    'TTD — Twin Oaks Airpark',
    'Twin Oaks Airpark (KTTD) Troutdale operations area',
    'airport',
    ST_GeomFromText(
        'POLYGON((-122.415 45.540, -122.385 45.540, -122.385 45.555, -122.415 45.555, -122.415 45.540))',
        4326
    ),
    TRUE
);
