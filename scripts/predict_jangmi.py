"""Reconstruct the withheld 2008 Jangmi test event with the exported BPNN."""
from __future__ import annotations

import csv
import hashlib
import json
import math
from datetime import datetime, timedelta, timezone
from pathlib import Path

import numpy as np

from predict_sinlaku import (
    MODEL_DIR, SOURCE, STATION_LAT, STATION_LON, TZ, UTC,
    calculate_metrics, distance_km, harmonic_tide, model_predict,
    previous_track, read_tide_archives,
)

ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "public/data/bpnn/jangmi-predictions.json"
YEAR = 2008
NAME = "JANGMI"
FEATURES = ["surgeC_cm", "pressure_hpa", "wind_m_s", "distance_km",
            "track_dx_deg", "track_dy_deg", "water_cm", "tide_cm"]


def read_track():
    points = []
    with (SOURCE / "ibtracs.WP.csv").open(encoding="utf-8-sig", newline="") as stream:
        for row in csv.DictReader(stream):
            if row.get("SEASON", "").strip() != str(YEAR) or row.get("NAME", "").strip().upper() != NAME:
                continue
            try:
                lat, lon = float(row["LAT"]), float(row["LON"])
                stamp = datetime.strptime(row["ISO_TIME"].strip(), "%Y-%m-%d %H:%M:%S").replace(tzinfo=UTC)
            except (KeyError, ValueError):
                continue
            def optional(key):
                try:
                    value = float(row.get(key, ""))
                    return value if math.isfinite(value) and abs(value) < 9000 else None
                except (TypeError, ValueError):
                    return None
            wind = optional("WMO_WIND") or optional("USA_WIND")
            pressure = optional("WMO_PRES") or optional("USA_PRES")
            points.append({"time": stamp, "lat": lat, "lon": lon,
                           "wind_m_s": wind * 0.514444 if wind is not None else None,
                           "pressure_hpa": pressure})
    return sorted(points, key=lambda point: point["time"])


def main():
    water_all, years = read_tide_archives()
    water = {stamp: value for stamp, value in water_all.items() if stamp.year == YEAR}
    track = read_track()
    if not water or not track:
        raise ValueError("Missing archived hourly Longdong water levels or Jangmi best track")

    near = [point["time"].astimezone(TZ) for point in track
            if distance_km(point["lat"], point["lon"]) <= 900]
    if not near:
        raise ValueError("Jangmi has no best-track fixes within 900 km of Longdong")
    start, end = min(near), max(near) + timedelta(hours=1)
    tide_at, tide_fit = harmonic_tide(
        water_all, years,
        excluded_ranges=[(start - timedelta(days=5), end + timedelta(days=5))],
    )

    features = {}
    for stamp in sorted(water):
        if stamp < start - timedelta(hours=23) or stamp >= end + timedelta(hours=6):
            continue
        cyclone = previous_track(track, stamp.astimezone(UTC))
        if not cyclone or cyclone["wind_m_s"] is None or cyclone["pressure_hpa"] is None:
            continue
        tide_cm, water_cm = tide_at(stamp), water[stamp]
        features[stamp] = np.array([
            water_cm - tide_cm, cyclone["pressure_hpa"], cyclone["wind_m_s"],
            distance_km(cyclone["lat"], cyclone["lon"]),
            cyclone["lon"] - STATION_LON, cyclone["lat"] - STATION_LAT,
            water_cm, tide_cm,
        ], dtype=float)

    results = []
    for lead in (1, 3, 6):
        path = MODEL_DIR / f"BPNN_Longdong_47Raw_Lead{lead:02d}h_Ensemble5.npz"
        with np.load(path, allow_pickle=False) as model:
            if model["feature_names"].tolist() != FEATURES or model["sequence_length"][0] != 24:
                raise ValueError(f"Unexpected model inputs in {path.name}")
            points = []
            for issued in sorted(features):
                if not start <= issued < end:
                    continue
                valid = issued + timedelta(hours=lead)
                sequence = [issued - timedelta(hours=23 - i) for i in range(24)]
                if any(stamp not in features for stamp in sequence) or valid not in water:
                    continue
                predicted_cm = model_predict(np.array([features[t] for t in sequence]), model)
                actual_cm = water[valid] - tide_at(valid)
                cyclone = previous_track(track, issued.astimezone(UTC))
                points.append({
                    "issued_at": issued.isoformat(), "valid_at": valid.isoformat(),
                    "actual_surge_mm": round(actual_cm * 10, 3),
                    "predicted_surge_mm": round(predicted_cm * 10, 3),
                    "distance_km": round(distance_km(cyclone["lat"], cyclone["lon"]), 1),
                    "wind_m_s": round(cyclone["wind_m_s"], 2),
                    "pressure_hpa": cyclone["pressure_hpa"],
                })
                points[-1]["actual_surge_cm"] = actual_cm
                points[-1]["predicted_surge_cm"] = predicted_cm
            if not points:
                raise ValueError(f"No complete 24-hour Jangmi windows for +{lead}h")
            metrics = calculate_metrics(points)
            for point in points:
                point.pop("actual_surge_cm")
                point.pop("predicted_surge_cm")
            results.append({"lead_hours": lead,
                            "weights_sha256": hashlib.sha256(path.read_bytes()).hexdigest(),
                            "metrics": metrics, "points": points})

    payload = {
        "event_id": "200815", "event_name": "2008 薔蜜 Jangmi",
        "station": "C4A02", "station_id": "1226", "units": "mm",
        "mode": "historical-bpnn-reconstruction",
        "validation": "reconstructed-features; original held-out storm, not original test rows",
        "issue_window": {"start": start.isoformat(), "end_exclusive": end.isoformat()},
        "inputs": {"hourly_observation_count": len(water), "track_fix_count": len(track),
                   "harmonic_tide_fit": tide_fit},
        "assumptions": [
            "CWA Longdong hourly observations use the minute-00 reading from the archived six-minute record; source values are converted from mm to cm for model inputs.",
            "Astronomical tide is reconstructed from annual CWA hourly records with a robust ten-constituent harmonic fit; data within five days of the event are excluded from the fit.",
            "NOAA IBTrACS best-track wind, pressure, and position use the latest fix at or before each issue hour, with missing values carried forward for no more than six hours.",
            "Inputs use the exported 24-hour window, saved feature statistics and temporal weights, and five-run BPNN ensemble. This is a historical reconstruction, not a live forecast or exact reproduction of original test rows.",
        ],
        "sources": [
            {"title": "CWA Ocean Data Download - Longdong historical tide observations", "url": "https://ocean.cwa.gov.tw/V2/data_interface/datasets"},
            {"title": "NOAA IBTrACS best-track archive", "url": "https://www.ncei.noaa.gov/products/international-best-track-archive"},
        ],
        "results": results,
    }
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT.write_text(json.dumps(payload, ensure_ascii=False, indent=2, allow_nan=False), encoding="utf-8")
    for result in results:
        print(result["lead_hours"], len(result["points"]), result["metrics"])


if __name__ == "__main__":
    main()
