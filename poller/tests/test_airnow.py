"""AirNow AQI parsing (ziplatlong observation service)."""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

from pollers.weather import parse_aqi                     # noqa: E402

PM = {"parameterName": "PM2.5", "nowcastAQI": 54, "aqiCategoryName": "Moderate"}
O3 = {"parameterName": "OZONE", "nowcastAQI": 25, "aqiCategoryName": "Good"}


def test_the_worst_pollutant_wins():
    assert parse_aqi([O3, PM]) == {"aqi": 54, "aqi_label": "Moderate"}


def test_no_monitor_or_no_value_gives_nothing():
    assert parse_aqi({"WebServiceError": [{"Message": "no data"}]}) is None
    assert parse_aqi([]) is None
    assert parse_aqi([{"parameterName": "PM2.5", "nowcastAQI": None}, {"nowcastAQI": -999}]) is None
    assert parse_aqi([{"AQI": 54, "Category": {"Name": "Moderate"}}]) is None       # the retired service's shape
