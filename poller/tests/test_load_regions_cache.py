"""load_regions parses sources.yml once per version of the file."""
import os
import tempfile
import time
import unittest
from unittest.mock import patch

import config


class LoadRegionsCacheTests(unittest.TestCase):
    def setUp(self):
        config._regions_yaml_cache = None
        self.dir = tempfile.TemporaryDirectory()
        self.path = os.path.join(self.dir.name, "sources.yml")

    def tearDown(self):
        config._regions_yaml_cache = None
        self.dir.cleanup()

    def _write(self, name):
        with open(self.path, "w") as f:
            f.write(f"regions:\n  - id: r1\n    name: {name}\n    bbox: {{min_lat: 45.0, max_lat: 46.0, min_lon: -123.0, max_lon: -122.0}}\n")

    def test_parsed_once_until_the_file_changes(self):
        self._write("First")
        with patch.dict(os.environ, {"SOURCES_YML": self.path}), patch("yaml.safe_load", wraps=__import__("yaml").safe_load) as load:
            for _ in range(5):
                self.assertEqual(config.load_regions()[0].name, "First")
            self.assertEqual(load.call_count, 1)
            time.sleep(0.01)
            self._write("Second, renamed")
            self.assertEqual(config.load_regions()[0].name, "Second, renamed")
            self.assertEqual(load.call_count, 2)

    def test_callers_get_their_own_objects(self):
        self._write("Shared")
        with patch.dict(os.environ, {"SOURCES_YML": self.path}):
            first = config.load_regions()
            first[0].name = "changed by a caller"
            self.assertEqual(config.load_regions()[0].name, "Shared")


if __name__ == "__main__":
    unittest.main()
