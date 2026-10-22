"""Convert residual model outputs into total water-level chart series.

The web charts compare observed water level with predicted total water level.
The models predict the residual component. The corresponding astronomical
baseline is recovered from the saved target identity and joined with observed
CWA hourly water levels at the same valid time.
"""
from __future__ import annotations

import json
import math
import zipfile
from datetime import datetime
from io import StringIO
from pathlib import Path

import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
ARCHIVE = ROOT / "data/lstm-training/cwa"
DATA_DIRS = (ROOT / "public/data/bpnn", ROOT / "public/data/lstm")
MISSING = {-999, -9999, -99999, 999, 9999, 99999}
OBSERVED_CACHE: dict[str, dict[datetime, float]] = {}


def read_observed_tide(station_id: str) -> dict[datetime, float]:
    if station_id in OBSERVED_CACHE:
        return OBSERVED_CACHE[station_id]
    observed: dict[datetime, float] = {}
    for archive_path in sorted(ARCHIVE.glob(f"{station_id}-*.zip")):
        with zipfile.ZipFile(archive_path) as archive:
            text = archive.read(archive.namelist()[0]).decode("utf-8-sig", errors="replace")
        lines = text.splitlines()
        header = next((i for i, line in enumerate(lines) if line.startswith("st,yyyymmddhh,")), None)
        if header is None:
            continue
        frame = pd.read_csv(StringIO("\n".join(lines[header:])), dtype=str, on_bad_lines="skip")
        frame = frame[frame["st"].astype(str) == station_id]
        for row in frame[["yyyymmddhh", "00"]].itertuples(index=False, name=None):
            stamp_text, raw_value = row
            try:
                stamp = datetime.strptime(str(stamp_text), "%Y%m%d%H")
                value_mm = float(raw_value)
            except (TypeError, ValueError):
                continue
            if not math.isfinite(value_mm) or value_mm in MISSING:
                continue
            observed[stamp] = value_mm / 10.0  # CWA archive values are mm; use cm in the charts.

    if not observed:
        raise RuntimeError(f"No hourly CWA observations found for station {station_id}")
    OBSERVED_CACHE[station_id] = observed
    return observed


def parse_local_time(value: str) -> datetime:
    return datetime.fromisoformat(value.replace("Z", "+00:00")).replace(tzinfo=None)


def add_fields(payload: dict, station_id: str, model_type: str) -> int:
    observed = read_observed_tide(station_id)
    total = 0
    for result in payload.get("results", []):
        for point in result.get("points", []):
            stamp = parse_local_time(point.get("valid_at") or point.get("time"))
            if stamp not in observed:
                raise RuntimeError(f"Missing CWA observation for {station_id} at {stamp}")
            if model_type == "lstm":
                observed_residual = float(point["actual_cm"])
                predicted_residual = float(point["prediction_cm"])
            else:
                if "actual_surge_mm" in point:
                    observed_residual = float(point["actual_surge_mm"]) / 10
                    predicted_residual = float(point["predicted_surge_mm"]) / 10
                else:
                    unit = payload.get("units", "m")
                    factor = 100 if unit == "m" else 1
                    observed_residual = float(point["actual_surge"]) * factor
                    predicted_residual = float(point["predicted_surge"]) * factor
            # The saved test target is observed water level minus UTide tide.
            # Recover the exact corresponding tide baseline from that identity,
            # then add it to the model's residual prediction for a total-water
            # level curve. This avoids fitting a second, inconsistent tide model.
            astro_cm = observed[stamp] - observed_residual
            point["observed_tide_cm"] = round(observed[stamp], 4)
            point["predicted_tide_cm"] = round(predicted_residual + astro_cm, 4)
            total += 1
    return total


def main() -> None:
    for directory in DATA_DIRS:
        for path in sorted(directory.glob("*.json")):
            payload = json.loads(path.read_text(encoding="utf-8"))
            if directory.name == "bpnn":
                station_id = "1246" if payload.get("station") == "C4U01" else "1226"
                model_type = "bpnn"
            else:
                station_id = "1246" if payload.get("station") == "C4U01" else "1226"
                model_type = "lstm"
            count = add_fields(payload, station_id, model_type)
            path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
            print(f"{path.relative_to(ROOT)}: added water-level curves for {count} points")


if __name__ == "__main__":
    main()
