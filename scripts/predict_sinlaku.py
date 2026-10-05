"""Reconstruct the 2008 Sinlaku test-event BPNN curves from public data.

This is a historical hindcast reconstruction, not the original 47-event test
pipeline. Tide predictions are harmonically reconstructed from the official
Longdong hourly observations after excluding the Sinlaku window; cyclone
meteorology and positions come from NOAA IBTrACS best-track data.
"""
import csv
import hashlib
import io
import json
import math
import zipfile
from datetime import datetime, timedelta, timezone
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "data/bpnn-source"
MODEL_DIR = ROOT / "models/longdong-bpnn/models"
OUTPUT = ROOT / "public/data/bpnn/sinlaku-predictions.json"
TZ = timezone(timedelta(hours=8))
UTC = timezone.utc
STATION_LAT, STATION_LON = 25.0975, 121.9181
FEATURES = [
    "surgeC_cm", "pressure_hpa", "wind_m_s", "distance_km",
    "track_dx_deg", "track_dy_deg", "water_cm", "tide_cm",
]
ISSUE_START = datetime(2008, 9, 12, tzinfo=TZ)
ISSUE_END = datetime(2008, 9, 17, tzinfo=TZ)  # exclusive
TIDE_CONSTITUENTS_DEG_PER_HOUR = [
    28.9841042, 30.0, 28.4397295, 30.0821373,
    15.0410686, 13.9430356, 14.9589314, 13.3986609,
    57.9682084, 58.9841042,
]


def parse_number(value):
    try:
        x = float(value)
        return x if math.isfinite(x) and abs(x) < 9000 else None
    except (TypeError, ValueError):
        return None


def read_longdong_hourly(path):
    with zipfile.ZipFile(path) as archive:
        name = archive.namelist()[0]
        text = archive.read(name).decode("utf-8-sig").replace("\ufeff", "")
    lines = text.splitlines()
    header_index = next(i for i, line in enumerate(lines) if line.startswith("st,yyyymmddhh,"))
    rows = csv.DictReader(io.StringIO("\n".join(lines[header_index:])))
    values = {}
    for row in rows:
        if row.get("st") != "1226":
            continue
        value_mm = parse_number(row.get("00"))
        if value_mm is None:
            continue
        stamp = datetime.strptime(row["yyyymmddhh"], "%Y%m%d%H").replace(tzinfo=TZ)
        values[stamp] = value_mm / 10.0
    return values


def read_tide_archives():
    archives = sorted(SOURCE.glob("cwa-longdong-tide-*.zip"))
    archives.extend([SOURCE / "tide-api-2005.download", SOURCE / "longdong-tide-2008.zip"])
    observed = {}
    for path in archives:
        if not path.exists():
            continue
        observed.update(read_longdong_hourly(path))
    if not observed:
        raise ValueError("No annual CWA Longdong tide archives were found")
    return observed, sorted({stamp.year for stamp in observed})


def harmonic_tide(observed_cm, source_years):
    """Fit shared tidal constituents and year-specific datums outside Sinlaku."""
    epoch = datetime(2008, 1, 1, tzinfo=TZ)
    samples = [(t, v) for t, v in observed_cm.items()
               if not datetime(2008, 9, 7, tzinfo=TZ) <= t < datetime(2008, 9, 19, tzinfo=TZ)]
    hours = np.array([(t - epoch).total_seconds() / 3600 for t, _ in samples], dtype=float)
    values = np.array([v for _, v in samples], dtype=float)
    year_index = {year: index for index, year in enumerate(source_years)}
    year_columns = np.zeros((len(samples), len(year_index)), dtype=float)
    for row_index, (stamp, _) in enumerate(samples):
        year_columns[row_index, year_index[stamp.year]] = 1.0
    columns = [year_columns]
    for speed in TIDE_CONSTITUENTS_DEG_PER_HOUR:
        phase = np.deg2rad(speed) * hours
        columns.extend((np.cos(phase), np.sin(phase)))
    design = np.column_stack(columns)
    weights = np.ones_like(values)
    coefficients = None
    for _ in range(8):
        sqrt_weights = np.sqrt(weights)
        coefficients = np.linalg.lstsq(design * sqrt_weights[:, None], values * sqrt_weights, rcond=None)[0]
        residual = values - design @ coefficients
        median = np.median(residual)
        mad = max(1.4826 * np.median(np.abs(residual - median)), 1.0)
        threshold = 1.5 * mad
        absolute = np.abs(residual - median)
        weights = np.ones_like(absolute)
        outliers = absolute > threshold
        weights[outliers] = threshold / absolute[outliers]
    residuals = values - design @ coefficients
    fit_rmse = float(np.sqrt(np.mean(residuals ** 2)))
    quiet_2008 = np.array([stamp.year == 2008 for stamp, _ in samples])
    fit_rmse_2008 = float(np.sqrt(np.mean(residuals[quiet_2008] ** 2)))

    def predict(stamp):
        hour = (stamp - epoch).total_seconds() / 3600
        if stamp.year not in year_index:
            raise ValueError(f"No fitted annual datum for {stamp.year}")
        vector = [0.0] * len(year_index)
        vector[year_index[stamp.year]] = 1.0
        for speed in TIDE_CONSTITUENTS_DEG_PER_HOUR:
            phase = math.radians(speed) * hour
            vector.extend((math.cos(phase), math.sin(phase)))
        return float(np.dot(vector, coefficients))

    return predict, {"training_samples": len(samples), "fit_rmse_cm_all_years": fit_rmse,
                     "fit_rmse_cm_2008_excluding_event": fit_rmse_2008,
                     "annual_observation_years": source_years,
                     "constituents": ["M2", "S2", "N2", "K2", "K1", "O1", "P1", "Q1", "M4", "MS4"]}


def read_sinlaku_track(path):
    track = []
    with path.open(encoding="utf-8-sig", newline="") as stream:
        for row in csv.DictReader(stream):
            if row.get("SEASON", "").strip() != "2008" or row.get("NAME", "").strip().upper() != "SINLAKU":
                continue
            lat, lon = parse_number(row.get("LAT")), parse_number(row.get("LON"))
            if lat is None or lon is None:
                continue
            wind = parse_number(row.get("WMO_WIND")) or parse_number(row.get("USA_WIND"))
            pressure = parse_number(row.get("WMO_PRES")) or parse_number(row.get("USA_PRES"))
            utc = datetime.strptime(row["ISO_TIME"].strip(), "%Y-%m-%d %H:%M:%S").replace(tzinfo=UTC)
            track.append({"time": utc.astimezone(TZ), "lat": lat, "lon": lon,
                          "wind_m_s": wind * 0.514444 if wind is not None else None,
                          "pressure_hpa": pressure})
    track.sort(key=lambda point: point["time"])
    return track


def distance_km(lat, lon):
    phi1, phi2 = math.radians(STATION_LAT), math.radians(lat)
    dphi = math.radians(lat - STATION_LAT)
    dlambda = math.radians(lon - STATION_LON)
    a = math.sin(dphi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(dlambda / 2) ** 2
    return 6371.0 * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))


def previous_track(track, stamp):
    candidates = [point for point in track if point["time"] <= stamp]
    if not candidates:
        return None
    latest = candidates[-1]
    if stamp - latest["time"] > timedelta(hours=6):
        return None
    # If pressure or wind is missing at the latest fix, carry the last value
    # from an earlier fix only while it remains within the same six-hour bound.
    for key in ("wind_m_s", "pressure_hpa"):
        if latest[key] is None:
            earlier = next((p for p in reversed(candidates) if p[key] is not None), None)
            if earlier is None or stamp - earlier["time"] > timedelta(hours=6):
                return None
            latest[key] = earlier[key]
    return latest


def model_predict(window, model):
    normalized = ((window - model["mean"]) / model["std"]) * model["temporal_weights"][:, None]
    normalized = normalized.reshape(1, -1)
    values = []
    for run in range(int(model["run_count"][0])):
        hidden = np.maximum(0, normalized @ model[f"run{run}_w0"] + model[f"run{run}_b0"])
        raw = hidden @ model[f"run{run}_w1"] + model[f"run{run}_b1"]
        values.append(float((raw * model["target_std"] + model["target_mean"]).item()))
    return float(np.mean(values))


def calculate_metrics(points):
    actual = np.array([p["actual_surge_cm"] for p in points], dtype=float)
    predicted = np.array([p["predicted_surge_cm"] for p in points], dtype=float)
    denominator = float(np.sum((actual - actual.mean()) ** 2))
    return {
        "count": len(points),
        "rmse_mm": float(np.sqrt(np.mean((predicted - actual) ** 2)) * 10),
        "mae_mm": float(np.mean(np.abs(predicted - actual)) * 10),
        "r2": 1 - float(np.sum((predicted - actual) ** 2)) / denominator if denominator else None,
    }


def main():
    all_water, tide_years = read_tide_archives()
    water = {stamp: value for stamp, value in all_water.items() if stamp.year == 2008}
    tide_at, tide_fit = harmonic_tide(all_water, tide_years)
    track = read_sinlaku_track(SOURCE / "sinlaku-ibtracs.csv")
    features = {}
    for stamp in sorted(water):
        if stamp < ISSUE_START - timedelta(hours=23) or stamp >= ISSUE_END + timedelta(hours=6):
            continue
        cyclone = previous_track(track, stamp.astimezone(UTC))
        if not cyclone or cyclone["wind_m_s"] is None or cyclone["pressure_hpa"] is None:
            continue
        tide_cm = tide_at(stamp)
        water_cm = water[stamp]
        features[stamp] = np.array([
            water_cm - tide_cm,
            cyclone["pressure_hpa"],
            cyclone["wind_m_s"],
            distance_km(cyclone["lat"], cyclone["lon"]),
            cyclone["lon"] - STATION_LON,
            cyclone["lat"] - STATION_LAT,
            water_cm,
            tide_cm,
        ], dtype=float)

    results = []
    for lead in (1, 3, 6):
        model_path = MODEL_DIR / f"BPNN_Longdong_47Raw_Lead{lead:02d}h_Ensemble5.npz"
        with np.load(model_path, allow_pickle=False) as model:
            if model["feature_names"].tolist() != FEATURES or model["sequence_length"][0] != 24:
                raise ValueError(f"Unexpected model inputs in {model_path.name}")
            points = []
            for issue in sorted(features):
                if not ISSUE_START <= issue < ISSUE_END:
                    continue
                valid = issue + timedelta(hours=lead)
                sequence = [issue - timedelta(hours=23 - i) for i in range(24)]
                if any(stamp not in features for stamp in sequence) or valid not in water:
                    continue
                prediction_cm = model_predict(np.array([features[t] for t in sequence]), model)
                actual_cm = water[valid] - tide_at(valid)
                cyclone = previous_track(track, issue.astimezone(UTC))
                points.append({
                    "issued_at": issue.isoformat(),
                    "valid_at": valid.isoformat(),
                    "actual_surge_mm": round(actual_cm * 10, 3),
                    "predicted_surge_mm": round(prediction_cm * 10, 3),
                    "distance_km": round(distance_km(cyclone["lat"], cyclone["lon"]), 1),
                    "wind_m_s": round(cyclone["wind_m_s"], 2),
                    "pressure_hpa": cyclone["pressure_hpa"],
                })
                points[-1]["actual_surge_cm"] = actual_cm
                points[-1]["predicted_surge_cm"] = prediction_cm
            if not points:
                raise ValueError(f"No complete 24-hour windows for +{lead}h")
            metrics = calculate_metrics(points)
            for point in points:
                point.pop("actual_surge_cm")
                point.pop("predicted_surge_cm")
            results.append({
                "lead_hours": lead,
                "weights_sha256": hashlib.sha256(model_path.read_bytes()).hexdigest(),
                "metrics": metrics,
                "points": points,
            })

    payload = {
        "event_id": "200813",
        "event_name": "2008 辛樂克 Sinlaku",
        "station": "C4A02",
        "station_id": "1226",
        "units": "mm",
        "mode": "historical-bpnn-reconstruction",
        "validation": "reconstructed-features; not-original-held-out-predictions",
        "issue_window": {"start": ISSUE_START.isoformat(), "end_exclusive": ISSUE_END.isoformat()},
        "inputs": {"hourly_observation_count": len(water), "track_fix_count": len(track),
                   "harmonic_tide_fit": tide_fit},
        "assumptions": [
            "Longdong water level comes from the CWA 2008 station 1226 six-minute archive; hourly observations use the minute-00 value.",
            "Astronomical tide is reconstructed by a robust least-squares fit of ten dominant constituents to CWA Longdong hourly observations from the available 2001-2016 annual archives, with year-specific datums and 2008-09-07 through 2008-09-18 excluded. It is not an archived official six-minute tide prediction.",
            "Typhoon position, wind, and pressure use the latest available NOAA IBTrACS best-track fix at or before each issue hour; winds are converted from knots to m/s. Missing fix properties are carried forward for no more than six hours.",
            "Distance and track offsets are recomputed from the Longdong station coordinates. Surge is observed water level minus reconstructed astronomical tide.",
            "Each prediction uses the exported five-run ensemble, its saved feature statistics and temporal weights, and the preceding 24 hourly feature vectors. Historical best-track values make this a reconstruction, not an operational forecast or exact reproduction of the original test pipeline.",
        ],
        "sources": [
            {"title": "CWA Ocean Data Download - Longdong historical tide observations", "url": "https://ocean.cwa.gov.tw/V2/data_interface/datasets"},
            {"title": "CWA Longdong station metadata", "url": "https://oceanapi.cwa.gov.tw/restapi/v2/static/station/station_info.html"},
            {"title": "NOAA IBTrACS best-track archive", "url": "https://www.ncei.noaa.gov/products/international-best-track-archive"},
        ],
        "results": results,
    }
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT.write_text(json.dumps(payload, ensure_ascii=False, indent=2, allow_nan=False), encoding="utf-8")
    for result in results:
        print(result["lead_hours"], result["metrics"])


if __name__ == "__main__":
    main()
