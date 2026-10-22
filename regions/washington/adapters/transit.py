"""Built-in reviewed transit feeds. Sound Transit is declared in the Washington pack (kind gtfs_rt); C-TRAN stays here
because its access terms are unverified, so it has no URLs and is reported as access pending."""
SOURCES = {'ctran-transit': {'name': 'ctran',
                   'label': 'C-TRAN',
                   'static_url': '',
                   'realtime_url': '',
                   'bbox': (-123.0, 45.4, -122.2, 46.1),
                   'unavailable': 'access_unverified'}}
