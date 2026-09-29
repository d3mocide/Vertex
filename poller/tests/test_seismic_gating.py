import unittest

from pollers.seismic import _LOCAL_KM, _REGIONAL_KM, _severity


class SeismicSeverityTests(unittest.TestCase):
    def test_local_quakes_scale_with_magnitude(self):
        self.assertEqual(_severity(1.2, 50), "low")
        self.assertEqual(_severity(2.6, 50), "medium")
        self.assertEqual(_severity(3.6, _LOCAL_KM), "high")

    def test_regional_quakes_need_to_be_large(self):
        self.assertEqual(_severity(3.2, _LOCAL_KM + 1), "low")
        self.assertEqual(_severity(4.2, 500), "medium")
        self.assertEqual(_severity(5.1, _REGIONAL_KM), "high")


if __name__ == "__main__":
    unittest.main()
