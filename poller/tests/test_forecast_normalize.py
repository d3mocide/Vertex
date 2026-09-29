import unittest

from pollers.weather import _wind_mph, normalize_forecast


class ForecastTests(unittest.TestCase):
    def test_wind_range_takes_the_top(self):
        self.assertEqual(_wind_mph("5 to 10 mph"), 10)
        self.assertEqual(_wind_mph("0 mph"), 0)
        self.assertIsNone(_wind_mph(""))
        self.assertIsNone(_wind_mph(None))

    def test_normalize_shapes_hourly_and_periods(self):
        hourly = {"properties": {"periods": [
            {"startTime": "2026-09-28T21:00:00-07:00", "temperature": 59, "windSpeed": "5 to 10 mph",
             "windDirection": "W", "shortForecast": "Partly Cloudy",
             "probabilityOfPrecipitation": {"value": 3}},
            {"startTime": "2026-09-28T22:00:00-07:00", "temperature": 57, "windSpeed": "3 mph",
             "windDirection": "W", "shortForecast": "Clear", "probabilityOfPrecipitation": {"value": None}},
        ]}}
        periods = {"properties": {"updateTime": "2026-09-29T03:41:05+00:00", "periods": [
            {"name": "Tonight", "temperature": 50, "isDaytime": False, "shortForecast": "Partly Cloudy",
             "detailedForecast": "Partly cloudy, with a low around 50.", "probabilityOfPrecipitation": {"value": 5}},
        ]}}
        out = normalize_forecast(hourly, periods, hours=1)
        self.assertEqual(len(out["hourly"]), 1)                       # capped
        self.assertEqual(out["hourly"][0]["wind_mph"], 10)
        self.assertEqual(out["periods"][0]["name"], "Tonight")
        self.assertEqual(out["updated"], "2026-09-29T03:41:05+00:00")

    def test_empty_upstream_gives_empty_lists(self):
        out = normalize_forecast({}, {})
        self.assertEqual((out["hourly"], out["periods"]), ([], []))


if __name__ == "__main__":
    unittest.main()
