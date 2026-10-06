"""Rebuild both provided 2CNN-LSTM event-split models from public inputs.

Input archives are intentionally ignored under data/lstm-training. The script
uses the supplied notebooks' architecture, lookback, feature set, fixed event
split and 100-epoch training settings, with NOAA IBTrACS best-track data and
CWA hourly (minute-00) tide observations.
"""
from __future__ import annotations

import csv
import json
import math
import os
import random
import re
import zipfile
from pathlib import Path

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
import pandas as pd
import tensorflow as tf
import utide
from scipy.interpolate import PchipInterpolator
from sklearn.metrics import mean_absolute_error, mean_squared_error, r2_score
from sklearn.preprocessing import MinMaxScaler
from tensorflow.keras import Sequential
from tensorflow.keras.layers import Conv1D, Dense, Dropout, Input, LSTM
from tensorflow.keras.optimizers import Adam

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "data/lstm-training"
ARCHIVE = DATA / "cwa"
IBTRACS = ROOT / "data/bpnn-source/ibtracs.WP.csv"
OUTPUT = ROOT / "public/data/lstm"
MODEL_OUTPUT = ROOT / "models/2cnn-lstm"
LOOKBACK = 24
EPOCHS = 100
# Larger minibatches preserve the full 100 epochs while keeping CPU-only
# execution practical on the local desktop. Original notebook batch size: 8.
BATCH = 128
SEED = 42
STATIONS = {
    "longdong": {
        "station_id": "1226", "station": "C4A02", "lat": 25.0975, "lon": 121.9181,
        "features": ["Residual_Surge", "WaterLevel", "wind_speed", "center_pressure", "Distance_to_Gauge", "Bearing_to_Gauge"],
        "units": {1: 16, 3: 16, 6: 32}, "filters": (32, 64), "dropout": .2, "lr": .001,
        "loss": {1: "mse", 3: "mse", 6: "mse"},
        "tests": ["2005Haitang s", "2008Jangmi s", "2008Sinlaku s"],
        "events": {"haitang": (2005, "HAITANG"), "jangmi": (2008, "JANGMI"), "sinlaku": (2008, "SINLAKU")},
        "name": "龍洞",
    },
    "suao": {
        "station_id": "1246", "station": "C4U01", "lat": 24.5925, "lon": 121.865833,
        "features": ["Residual_Surge", "WaterLevel", "wind_speed", "center_pressure", "Distance_to_Gauge", "Bearing_sin", "Bearing_cos"],
        "units": {1: 32, 3: 32, 6: 64}, "filters": {1: (32, 32), 3: (32, 32), 6: (16, 32)},
        "dropout": {1: .1, 3: .1, 6: .2}, "lr": {1: .003, 3: .003, 6: .001},
        "loss": {1: "huber", 3: "mse", 6: "mse"},
        "tests": ["2005Talim s", "2006Kaemi s", "2013KONG-REY s"],
        "events": {"talim": (2005, "TALIM"), "kaemi": (2006, "KAEMI"), "kong-rey": (2013, "KONG-REY")},
        "name": "蘇澳",
    },
}
MISSING = [-999, -9999, -99999, 999, 9999, 99999]


def read_water(station_id: str) -> tuple[pd.DataFrame, list[int]]:
    parts, years = [], []
    for path in sorted(ARCHIVE.glob(f"{station_id}-*.zip")):
        with zipfile.ZipFile(path) as archive:
            entry = archive.namelist()[0]
            text = archive.read(entry).decode("utf-8-sig", errors="replace")
        lines = text.splitlines()
        header = next((i for i, line in enumerate(lines) if line.startswith("st,yyyymmddhh,")), None)
        if header is None:
            continue
        frame = pd.read_csv(pd.io.common.StringIO("\n".join(lines[header:])), dtype=str, on_bad_lines="skip")
        frame = frame[frame["st"].astype(str) == station_id]
        frame["Time"] = pd.to_datetime(frame["yyyymmddhh"], format="%Y%m%d%H", errors="coerce")
        frame["WaterLevel"] = pd.to_numeric(frame["00"], errors="coerce").replace(MISSING, np.nan)
        frame = frame.dropna(subset=["Time"])[["Time", "WaterLevel"]]
        if not frame.empty:
            parts.append(frame)
            years.append(int(path.stem.split("-")[-1]))
    if not parts:
        raise RuntimeError(f"No CWA hourly tide data for {station_id}")
    water = pd.concat(parts).drop_duplicates("Time").sort_values("Time")
    return water, sorted(set(years))


def tide_separate(water: pd.DataFrame, lat: float) -> pd.DataFrame:
    out = []
    for year, group in water.groupby(water.Time.dt.year):
        valid = group.dropna(subset=["WaterLevel"])
        if len(valid) < 100:
            continue
        t = (valid.Time - pd.Timestamp("1970-01-01")).dt.total_seconds().to_numpy() / 86400
        tfull = (group.Time - pd.Timestamp("1970-01-01")).dt.total_seconds().to_numpy() / 86400
        coef = utide.solve(t, valid.WaterLevel.to_numpy(float), lat=lat, epoch="1970-01-01", method="ols", conf_int="linear", verbose=False)
        group = group.copy()
        group["Astro_Tide"] = utide.reconstruct(tfull, coef, epoch="1970-01-01", verbose=False).h
        group["Residual_Surge"] = group.WaterLevel - group.Astro_Tide
        out.append(group)
    if not out:
        raise RuntimeError("UTide did not produce any annual tide fits")
    return pd.concat(out, ignore_index=True).sort_values("Time")


def read_tracks() -> pd.DataFrame:
    use = ["SID", "SEASON", "NAME", "ISO_TIME", "LAT", "LON", "WMO_WIND", "USA_WIND", "WMO_PRES", "USA_PRES"]
    df = pd.read_csv(IBTRACS, skiprows=[1], usecols=use, dtype=str, low_memory=False)
    for key in ["LAT", "LON", "WMO_WIND", "USA_WIND", "WMO_PRES", "USA_PRES"]:
        df[key] = pd.to_numeric(df[key], errors="coerce")
    df["wind"] = df.WMO_WIND.fillna(df.USA_WIND)
    df["pressure"] = df.WMO_PRES.fillna(df.USA_PRES)
    # CWA timestamps and the supplied storm TXT files use Taiwan local time.
    df["Time"] = pd.to_datetime(df.ISO_TIME, errors="coerce", utc=True).dt.tz_convert("Asia/Taipei").dt.tz_localize(None)
    return df.dropna(subset=["Time", "LAT", "LON"])


def haversine(lat1, lon1, lat2, lon2):
    p1, p2 = np.radians(lat1), np.radians(lat2)
    dp, dl = np.radians(lat2 - lat1), np.radians(lon2 - lon1)
    a = np.sin(dp / 2) ** 2 + np.cos(p1) * np.cos(p2) * np.sin(dl / 2) ** 2
    return 6371 * 2 * np.arctan2(np.sqrt(a), np.sqrt(1 - a))


def build_event(track: pd.DataFrame, water: pd.DataFrame, station: dict, year: int, name: str, event_label: str | None = None) -> pd.DataFrame:
    g = track[(track.SEASON == str(year)) & (track.NAME.str.upper() == name)].copy()
    if g.empty:
        raise RuntimeError(f"NOAA IBTrACS storm missing: {year} {name}")
    g = g.dropna(subset=["Time"]).sort_values("Time").drop_duplicates("Time")
    start, end = g.Time.min().ceil("h"), g.Time.max().floor("h")
    if start > end:
        raise RuntimeError(f"No hourly track span: {year} {name}")
    hours = pd.date_range(start, end, freq="1h")
    raw_x = (g.Time - start).dt.total_seconds().to_numpy() / 3600
    xnew = (hours - start).total_seconds().to_numpy() / 3600
    event = pd.DataFrame({"Time": hours, "lat": 0., "lon": 0., "wind_speed": 0., "center_pressure": 0.})
    for source, dest, scale in [("LAT", "lat", 1), ("LON", "lon", 1), ("wind", "wind_speed", .514444), ("pressure", "center_pressure", 1)]:
        valid = g[["Time", source]].dropna().copy()
        xp = (valid.Time - start).dt.total_seconds().to_numpy() / 3600
        yp = valid[source].to_numpy(float)
        unique = ~pd.Series(xp).duplicated().to_numpy()
        xp, yp = xp[unique], yp[unique]
        if len(xp) < 2:
            event[dest] = np.nan
        else:
            event[dest] = PchipInterpolator(xp, yp, extrapolate=False)(xnew) * scale
    event = event.dropna(subset=["lat", "lon", "wind_speed", "center_pressure"])
    if name == "KONG-REY":
        display_name = "KONG-REY"
    elif name == "SINLAKU":
        display_name = "Sinlaku"
    elif name == "HAITANG":
        display_name = "Haitang"
    elif name == "JANGMI":
        display_name = "Jangmi"
    elif name == "TALIM":
        display_name = "Talim"
    elif name == "KAEMI":
        display_name = "Kaemi"
    else:
        display_name = name.title()
    event["Typhoon_Name"] = event_label or f"{year}{display_name} s"
    event["Distance_to_Gauge"] = haversine(station["lat"], station["lon"], event.lat.to_numpy(), event.lon.to_numpy())
    bearing = np.radians((np.degrees(np.arctan2(
        np.sin(np.radians(station["lon"] - event.lon)) * np.cos(np.radians(station["lat"])),
        np.cos(np.radians(event.lat)) * np.sin(np.radians(station["lat"])) - np.sin(np.radians(event.lat)) * np.cos(np.radians(station["lat"])) * np.cos(np.radians(station["lon"] - event.lon))
    )) + 360) % 360)
    if "Bearing_to_Gauge" in station["features"]:
        event["Bearing_to_Gauge"] = np.degrees(bearing)
    else:
        event["Bearing_sin"], event["Bearing_cos"] = np.sin(bearing), np.cos(bearing)
    event = event.merge(water[["Time", "WaterLevel", "Astro_Tide", "Residual_Surge"]], on="Time", how="left")
    return event.sort_values("Time").reset_index(drop=True)


def build_windows(events: pd.DataFrame, station: dict, horizon: int) -> dict:
    data = {k: [] for k in ["X_train", "Y_train", "train_event", "train_time", "X_test", "Y_test", "test_event", "test_time"]}
    test_set = set(station["tests"])
    for event_name, group in events.groupby("Typhoon_Name"):
        group = group.sort_values("Time").reset_index(drop=True)
        vals = group[station["features"]].to_numpy(float)
        target = group.Residual_Surge.to_numpy(float)
        times = pd.to_datetime(group.Time).to_numpy()
        for start in range(max(0, len(group) - LOOKBACK - horizon + 1)):
            end, dest = start + LOOKBACK - 1, start + LOOKBACK - 1 + horizon
            if not (np.diff(times[start:end + 1]).astype("timedelta64[h]") == np.timedelta64(1, "h")).all():
                continue
            if times[dest] != times[end] + np.timedelta64(horizon, "h"):
                continue
            x, y = vals[start:end + 1], target[dest]
            if not np.isfinite(x).all() or not np.isfinite(y):
                continue
            prefix = "test" if event_name in test_set else "train"
            data[f"X_{prefix}"].append(x)
            data[f"Y_{prefix}"].append(y)
            data[f"{prefix}_event"].append(event_name)
            data[f"{prefix}_time"].append(pd.Timestamp(times[dest]).isoformat())
    for prefix in ["train", "test"]:
        data[f"X_{prefix}"] = np.asarray(data[f"X_{prefix}"], dtype=np.float32)
        data[f"Y_{prefix}"] = np.asarray(data[f"Y_{prefix}"], dtype=np.float32)
    return data


def build_model(station: dict, horizon: int, n_features: int):
    f1, f2 = station["filters"] if isinstance(station["filters"], tuple) else station["filters"][horizon]
    dropout = station["dropout"] if isinstance(station["dropout"], float) else station["dropout"][horizon]
    lr = station["lr"] if isinstance(station["lr"], float) else station["lr"][horizon]
    model = Sequential([Input((LOOKBACK, n_features)), Conv1D(f1, 3, padding="same", activation="relu"), Conv1D(f2, 5, padding="same", activation="relu"), LSTM(station["units"][horizon]), Dropout(dropout), Dense(1)])
    loss = tf.keras.losses.Huber() if station["loss"][horizon] == "huber" else "mse"
    model.compile(optimizer=Adam(learning_rate=lr), loss=loss)
    return model


def train_one(station_key: str, station: dict, horizon: int, data: dict):
    if len(data["X_train"]) == 0 or len(data["X_test"]) == 0:
        raise RuntimeError(f"{station_key} +{horizon}h has insufficient train/test samples: {len(data['X_train'])}/{len(data['X_test'])}")
    tf.keras.backend.clear_session()
    np.random.seed(SEED); random.seed(SEED); tf.keras.utils.set_random_seed(SEED)
    scaler_x, scaler_y = MinMaxScaler(), MinMaxScaler()
    nfeatures = data["X_train"].shape[2]
    trainx = scaler_x.fit_transform(data["X_train"].reshape(-1, nfeatures)).reshape(data["X_train"].shape)
    testx = scaler_x.transform(data["X_test"].reshape(-1, nfeatures)).reshape(data["X_test"].shape)
    trainy = scaler_y.fit_transform(data["Y_train"].reshape(-1, 1))
    model = build_model(station, horizon, nfeatures)
    model.fit(trainx, trainy, epochs=EPOCHS, batch_size=BATCH, shuffle=True, verbose=0)
    pred = scaler_y.inverse_transform(model.predict(testx, verbose=0)).ravel()
    actual = data["Y_test"]
    denom = float(np.sum((actual - actual.mean()) ** 2))
    metrics = {"mae_cm": float(mean_absolute_error(actual, pred) / 10), "rmse_cm": float(np.sqrt(mean_squared_error(actual, pred)) / 10), "r2": float(r2_score(actual, pred)) if denom else None, "samples": int(len(actual))}
    return pred, actual, metrics, model


def main():
    OUTPUT.mkdir(parents=True, exist_ok=True)
    MODEL_OUTPUT.mkdir(parents=True, exist_ok=True)
    track = read_tracks()
    for key, station in STATIONS.items():
        print(f"{station['name']}: read public hourly tide data", flush=True)
        hourly, years = read_water(station["station_id"])
        water = tide_separate(hourly, station["lat"])
        events = []
        fixed_test = {}
        for slug, (year, name) in station["events"].items():
            display_name = {"SINLAKU": "Sinlaku", "HAITANG": "Haitang", "JANGMI": "Jangmi", "TALIM": "Talim", "KAEMI": "Kaemi", "KONG-REY": "KONG-REY"}[name]
            label = f"{year}{display_name} s"
            fixed_test[slug] = label
            events.append(build_event(track, water, station, year, name, label))
        # Match the notebooks' rule: every available storm file not listed in
        # the fixed test-event list belongs to training. NOAA is the public
        # best-track substitute for the original private storm TXT directory.
        years_set = set(years)
        candidates = track[track.SEASON.astype(str).isin({str(y) for y in years_set})]
        candidates = candidates[candidates.LAT.between(5, 45) & candidates.LON.between(95, 155)]
        for (sid, season, name), group in candidates.groupby(["SID", "SEASON", "NAME"], sort=False):
            year = int(season)
            name = str(name).strip().upper()
            if not name or name == "UNNAMED" or (year, name) in set(station["events"].values()):
                continue
            close = haversine(station["lat"], station["lon"], group.LAT.to_numpy(float), group.LON.to_numpy(float))
            if np.nanmin(close) > 900:
                continue
            label = f"TRAIN-{sid}-{name}"
            try:
                storm = build_event(track, water, station, year, name, label)
            except Exception:
                continue
            # Ignore storms without enough directly observed station hours.
            if storm.WaterLevel.notna().sum() >= LOOKBACK + 6:
                events.append(storm)
        master = pd.concat(events, ignore_index=True)
        test_names = list(fixed_test.values())
        all_names = master.Typhoon_Name.unique().tolist()
        missing = sorted(set(test_names) - set(all_names))
        if missing:
            raise RuntimeError(f"Expected test storms absent after data merge: {missing}")
        # Only events represented by observed station water are allowed into training.
        print(f"{station['name']}: {len(master)} hourly track rows; CWA tide years={len(years)} ({min(years)}-{max(years)})", flush=True)
        outputs = []
        for horizon in [1, 3, 6]:
            window = build_windows(master, station, horizon)
            print(f"{station['name']} +{horizon}h: train={len(window['X_train'])}, test={len(window['X_test'])}", flush=True)
            pred, actual, metrics, model = train_one(key, station, horizon, window)
            model_path = MODEL_OUTPUT / f"{key}-{horizon}h.keras"
            model.save(model_path)
            points = []
            for i, (event, stamp, a, p) in enumerate(zip(window["test_event"], window["test_time"], actual, pred)):
                points.append({"event": event, "time": stamp, "actual_cm": round(float(a / 10), 4), "prediction_cm": round(float(p / 10), 4)})
            # Matched-time line plot for individual event values is handled in component;
            # save bundled records so all test events remain independently inspectable.
            for event in test_names:
                subset = [p for p in points if p["event"] == event]
                if not subset:
                    continue
                df = pd.DataFrame(subset)
                plt.figure(figsize=(11, 4.2))
                plt.plot(df.time, df.actual_cm, color="#1d70b7", lw=1.8, label="Actual")
                plt.plot(df.time, df.prediction_cm, color="#df4d33", lw=1.8, ls="--", label="2CNN-LSTM prediction")
                plt.title(f"{station['name']} | {event} | +{horizon}h 2CNN-LSTM")
                plt.ylabel("Residual surge (cm)"); plt.xlabel("Evaluation time (Taiwan time)")
                plt.grid(True, alpha=.28); plt.legend(); plt.xticks(rotation=25); plt.tight_layout()
                filename = f"{key}-{event[:6]}-{event.split(' ', 1)[0][6:].lower()}-{horizon}h-retrained.png".replace("--", "-")
                # Explicit slugs keep old image naming stable for front-end selection.
                slug = next(slug for slug, label in fixed_test.items() if event == label)
                filename = f"{key}-{slug}-{horizon}h.png"
                plt.savefig(OUTPUT / filename, dpi=160)
                plt.close()
            outputs.append({"lead_hours": horizon, "metrics": metrics, "test_events": test_names, "points": points,
                            "training_samples": int(len(window["X_train"])), "architecture": {"conv1_filters": station["filters"] if isinstance(station["filters"], tuple) else station["filters"][horizon][0], "conv2_filters": station["filters"] if isinstance(station["filters"], tuple) else station["filters"][horizon][1], "lstm_units": station["units"][horizon], "lookback_hours": LOOKBACK, "epochs": EPOCHS, "batch_size": BATCH, "notebook_batch_size": 8}})
            print(f"{station['name']} +{horizon}h metrics: {metrics}", flush=True)
        payload = {"station": station["station"], "station_name": station["name"], "units": "cm", "model": "2CNN-LSTM", "training_status": "retrained", "data_sources": {"tide": "CWA historical station archives (minute-00 hourly records)", "track": "NOAA IBTrACS best-track, interpolated hourly with PCHIP"}, "tide_method": "UTide annual harmonic separation fitted to each calendar year; output is observed water level minus astronomical tide.", "split_method": "Held-out storm-event split matching the supplied notebook; no event appears in both train and test.", "tide_years": years, "results": outputs}
        (OUTPUT / f"{key}-retrained.json").write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    print("TRAINING_COMPLETE", flush=True)


if __name__ == "__main__":
    main()
