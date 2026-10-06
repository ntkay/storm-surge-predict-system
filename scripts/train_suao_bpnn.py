"""Train station-specific Suao BPNN ensembles and test held-out 2005–2013 storms."""
from __future__ import annotations

import json
import hashlib
from pathlib import Path

import numpy as np
import pandas as pd
from sklearn.metrics import mean_absolute_error, mean_squared_error, r2_score
from sklearn.neural_network import MLPRegressor

from train_cnn_lstm import STATIONS, build_event, haversine, read_tracks, read_water, tide_separate

ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "public/data/bpnn"
MODEL_DIR = ROOT / "models/suao-bpnn"
LOOKBACK = 24
EPOCHS = 800
MAX_TRAIN_SAMPLES = 2000
SEED = 42
TEST = [
    (2005, "HAITANG", "haitang"), (2008, "SINLAKU", "sinlaku"),
    (2008, "JANGMI", "jangmi"), (2005, "TALIM", "talim"),
    (2006, "KAEMI", "kaemi"), (2013, "KONG-REY", "kong-rey"),
]
FEATURES = ["surgeC_cm", "pressure_hpa", "wind_m_s", "distance_km",
            "track_dx_deg", "track_dy_deg", "water_cm", "tide_cm"]


def model_features(frame):
    return np.column_stack([
        frame.Residual_Surge.to_numpy(float) / 10,
        frame.center_pressure.to_numpy(float),
        frame.wind_speed.to_numpy(float),
        frame.Distance_to_Gauge.to_numpy(float),
        frame.lon.to_numpy(float) - STATIONS["suao"]["lon"],
        frame.lat.to_numpy(float) - STATIONS["suao"]["lat"],
        frame.WaterLevel.to_numpy(float) / 10,
        frame.Astro_Tide.to_numpy(float) / 10,
    ])


def windows(frame, lead):
    frame = frame.sort_values("Time").reset_index(drop=True)
    values = model_features(frame)
    target = frame.Residual_Surge.to_numpy(float) / 10
    times = pd.to_datetime(frame.Time).to_numpy()
    xs, ys = [], []
    for start in range(max(0, len(frame) - LOOKBACK - lead + 1)):
        end, destination = start + LOOKBACK - 1, start + LOOKBACK - 1 + lead
        if not (np.diff(times[start:end + 1]).astype("timedelta64[h]") == np.timedelta64(1, "h")).all():
            continue
        if times[destination] != times[end] + np.timedelta64(lead, "h"):
            continue
        x, y = values[start:end + 1], target[destination]
        if np.isfinite(x).all() and np.isfinite(y):
            xs.append(x.reshape(-1))
            ys.append(y)
    return xs, ys


def main():
    station = STATIONS["suao"]
    tide, years = read_water(station["station_id"])
    water = tide_separate(tide, station["lat"])
    tracks = read_tracks()
    events, test_labels = [], {}
    heldout = {(year, name) for year, name, _ in TEST}
    for year, name, slug in TEST:
        label = f"{year}{name.title()} s"
        test_labels[slug] = label
        events.append(build_event(tracks, water, station, year, name, label))

    candidates = tracks[tracks.SEASON.astype(str).isin({str(y) for y in years})]
    candidates = candidates[candidates.LAT.between(5, 45) & candidates.LON.between(95, 155)]
    for (sid, season, raw_name), group in candidates.groupby(["SID", "SEASON", "NAME"], sort=False):
        year, name = int(season), str(raw_name).strip().upper()
        if not name or name == "UNNAMED" or (year, name) in heldout:
            continue
        if np.nanmin(haversine(station["lat"], station["lon"], group.LAT.to_numpy(float), group.LON.to_numpy(float))) > 900:
            continue
        try:
            event = build_event(tracks, water, station, year, name, f"TRAIN-{sid}-{name}")
        except Exception:
            continue
        if event.WaterLevel.notna().sum() >= LOOKBACK + 6:
            events.append(event)

    event_frames = {str(frame.Typhoon_Name.iloc[0]): frame for frame in events}
    absent = [label for label in test_labels.values() if label not in event_frames]
    if absent:
        raise RuntimeError(f"Held-out Suao storm inputs missing: {absent}")
    train_names = [name for name in event_frames if name not in set(test_labels.values())]
    if not train_names:
        raise RuntimeError("No Suao training events available")
    print(f"Suao BPNN: {len(train_names)} train storms, {len(test_labels)} held-out test storms", flush=True)
    MODEL_DIR.mkdir(parents=True, exist_ok=True)
    OUTPUT.mkdir(parents=True, exist_ok=True)
    storm_payloads = {
        slug: {"event_id": f"{year}{name}", "event_name": f"{year} {name.title()}",
               "station": "C4U01", "station_id": "1246", "units": "mm",
               "mode": "suao-bpnn-retrained-historical-test",
               "validation": "held-out-event; station-specific retraining, not exported Longdong weights",
               "training_samples": None, "training_events": len(train_names), "test_event": label,
               "architecture": {"input_hours": LOOKBACK, "features": FEATURES,
                                "layer_sizes": [LOOKBACK * len(FEATURES), 8, 1],
                                "ensemble_runs": 5, "epochs": EPOCHS,
                                "optimizer": "SGD with momentum 0.9"}, "results": []}
        for year, name, slug in TEST
    }

    for lead in (1, 3, 6):
        train_x, train_y = [], []
        test_data = {slug: ([], []) for slug in test_labels}
        for name, frame in event_frames.items():
            xs, ys = windows(frame, lead)
            if name in train_names:
                train_x.extend(xs); train_y.extend(ys)
            else:
                slug = next(key for key, label in test_labels.items() if label == name)
                test_data[slug] = (xs, ys)
        xtrain = np.asarray(train_x, dtype=np.float64)
        ytrain = np.asarray(train_y, dtype=np.float64)
        if not len(xtrain):
            raise RuntimeError(f"No training windows for Suao +{lead}h")
        if len(xtrain) > MAX_TRAIN_SAMPLES:
            sample_rng = np.random.default_rng(SEED + lead)
            selected = np.sort(sample_rng.choice(len(xtrain), MAX_TRAIN_SAMPLES, replace=False))
            xtrain, ytrain = xtrain[selected], ytrain[selected]
        print(f"Suao BPNN +{lead}h: fitting five runs with {len(xtrain)} windows", flush=True)
        xtrain_sequence = xtrain.reshape(-1, LOOKBACK, len(FEATURES))
        mean = xtrain_sequence.reshape(-1, len(FEATURES)).mean(axis=0)
        std = xtrain_sequence.reshape(-1, len(FEATURES)).std(axis=0)
        std[std < 1e-8] = 1.0
        ymean, ystd = float(ytrain.mean()), float(ytrain.std() or 1)
        xscaled = ((xtrain_sequence - mean) / std).reshape(len(xtrain), -1)
        yscaled = (ytrain - ymean) / ystd
        ensemble = []
        for run in range(5):
            model = MLPRegressor(hidden_layer_sizes=(8,), activation="relu", solver="sgd",
                                 learning_rate="constant", learning_rate_init=.001,
                                 momentum=.9, batch_size=32, max_iter=EPOCHS,
                                 shuffle=True, random_state=SEED + lead * 10 + run,
                                 tol=0, early_stopping=False, n_iter_no_change=EPOCHS + 1)
            model.fit(xscaled, yscaled)
            ensemble.append(model)
        model_file = MODEL_DIR / f"suao-lead{lead:02d}h-ensemble5.npz"
        model_arrays = {
            "feature_names": np.asarray(FEATURES), "sequence_length": np.asarray([LOOKBACK]),
            "mean": mean, "std": std, "target_mean": np.asarray([ymean]),
            "target_std": np.asarray([ystd]), "temporal_weights": np.ones(LOOKBACK),
            "run_count": np.asarray([len(ensemble)]),
            "layer_sizes": np.asarray([LOOKBACK * len(FEATURES), 8, 1]),
        }
        for run, model in enumerate(ensemble):
            model_arrays[f"run{run}_w0"] = model.coefs_[0]
            model_arrays[f"run{run}_b0"] = model.intercepts_[0]
            model_arrays[f"run{run}_w1"] = model.coefs_[1]
            model_arrays[f"run{run}_b1"] = model.intercepts_[1]
        np.savez_compressed(model_file, **model_arrays)
        model_sha256 = hashlib.sha256(model_file.read_bytes()).hexdigest()

        for slug, label in test_labels.items():
            xtest, ytest = test_data[slug]
            if not xtest:
                raise RuntimeError(f"No held-out Suao samples for {label} +{lead}h")
            xtest_scaled = ((np.asarray(xtest).reshape(-1, LOOKBACK, len(FEATURES)) - mean) / std).reshape(len(xtest), -1)
            prediction = np.mean([m.predict(xtest_scaled) * ystd + ymean for m in ensemble], axis=0)
            actual = np.asarray(ytest)
            denom = float(np.sum((actual - actual.mean()) ** 2))
            metrics = {
                "rmse_mm": float(np.sqrt(mean_squared_error(actual, prediction)) * 10),
                "mae_mm": float(mean_absolute_error(actual, prediction) * 10),
                "r2": float(r2_score(actual, prediction)) if denom else None,
                "count": len(actual),
            }
            points = []
            frame = event_frames[label].sort_values("Time").reset_index(drop=True)
            # Recreate every valid issue/target timestamp to align predictions with the measured curve.
            _, _ = windows(frame, lead)
            vals, targets = model_features(frame), frame.Residual_Surge.to_numpy(float) / 10
            stamps = pd.to_datetime(frame.Time).to_numpy()
            pred_index = 0
            for start in range(max(0, len(frame) - LOOKBACK - lead + 1)):
                last, dest = start + LOOKBACK - 1, start + LOOKBACK - 1 + lead
                if not (np.diff(stamps[start:last + 1]).astype("timedelta64[h]") == np.timedelta64(1, "h")).all() or stamps[dest] != stamps[last] + np.timedelta64(lead, "h"):
                    continue
                if not np.isfinite(vals[start:last + 1]).all() or not np.isfinite(targets[dest]):
                    continue
                issue = pd.Timestamp(stamps[last])
                valid = pd.Timestamp(stamps[dest])
                points.append({"issued_at": issue.isoformat(), "valid_at": valid.isoformat(),
                               "actual_surge_mm": round(float(targets[dest] * 10), 3),
                               "predicted_surge_mm": round(float(prediction[pred_index] * 10), 3)})
                pred_index += 1
            storm_payloads[slug]["training_samples"] = len(xtrain)
            storm_payloads[slug]["results"].append({"lead_hours": lead, "model_sha256": model_sha256, "metrics": metrics, "points": points})
            print(f"Suao {slug} +{lead}h: train={len(xtrain)} test={len(points)} {metrics}", flush=True)

    for slug, payload in storm_payloads.items():
        path = OUTPUT / f"suao-{slug}-predictions.json"
        path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")


if __name__ == "__main__":
    main()
