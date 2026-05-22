import timeit

def using_all(snapshot):
    return all(value is None for key, value in snapshot.items() if key != "raw") and not snapshot["raw"]

def using_unrolled(snapshot):
    if snapshot["raw"]:
        return False
    for key, value in snapshot.items():
        if key != "raw" and value is not None:
            return False
    return True

snapshot = {
    "selected_altitude_mcp_ft": None,
    "selected_altitude_fms_ft": None,
    "qnh_hpa": None,
    "wind_speed_kt": None,
    "wind_direction_deg": None,
    "static_air_temperature_c": None,
    "static_air_temperature_source": None,
    "total_air_temperature_c": None,
    "static_pressure_hpa": None,
    "turbulence": None,
    "humidity_pct": None,
    "roll_deg": None,
    "true_track_deg": None,
    "groundspeed_kt": None,
    "track_rate_deg_per_s": None,
    "true_airspeed_kt": None,
    "magnetic_heading_deg": None,
    "indicated_airspeed_kt": None,
    "mach": None,
    "baro_vertical_rate_fpm": None,
    "inertial_vertical_rate_fpm": None,
    "raw": {}
}

print("using_all:", timeit.timeit("using_all(snapshot)", globals=globals(), number=100000))
print("using_unrolled:", timeit.timeit("using_unrolled(snapshot)", globals=globals(), number=100000))

snapshot_early_exit = snapshot.copy()
snapshot_early_exit["selected_altitude_mcp_ft"] = 1000
print("using_all (early exit):", timeit.timeit("using_all(snapshot_early_exit)", globals=globals(), number=100000))
print("using_unrolled (early exit):", timeit.timeit("using_unrolled(snapshot_early_exit)", globals=globals(), number=100000))

snapshot_raw = snapshot.copy()
snapshot_raw["raw"] = {"1": "2"}
print("using_all (raw):", timeit.timeit("using_all(snapshot_raw)", globals=globals(), number=100000))
print("using_unrolled (raw):", timeit.timeit("using_unrolled(snapshot_raw)", globals=globals(), number=100000))
