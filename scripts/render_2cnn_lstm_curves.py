"""Render the saved retrained 2CNN-LSTM test predictions as readable figures."""
from __future__ import annotations

import json
from pathlib import Path

import matplotlib
matplotlib.use("Agg")
import matplotlib.dates as mdates
import matplotlib.pyplot as plt
import numpy as np
import pandas as pd
from sklearn.metrics import mean_absolute_error, mean_squared_error, r2_score

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "public/data/lstm"
SLUGS = {
    "longdong": {"200505Haitang s": "haitang", "200813Sinlaku s": "sinlaku", "200815Jangmi s": "jangmi"},
    "suao": {"200513Talim s": "talim", "200605Kaemi s": "kaemi", "201315KONG-REY s": "kong-rey"},
}
NAMES = {"longdong": "Longdong", "suao": "Suao"}


def main():
    for station, mapping in SLUGS.items():
        payload = json.loads((OUT / f"{station}-retrained.json").read_text(encoding="utf-8"))
        for result in payload["results"]:
            for event, slug in mapping.items():
                points = [p for p in result["points"] if p["event"] == event]
                if not points:
                    raise ValueError(f"No predictions for {station} {event} +{result['lead_hours']}h")
                frame = pd.DataFrame(points)
                frame["time"] = pd.to_datetime(frame["time"])
                actual = frame.actual_cm.to_numpy(float)
                prediction = frame.prediction_cm.to_numpy(float)
                mae = float(mean_absolute_error(actual, prediction))
                rmse = float(np.sqrt(mean_squared_error(actual, prediction)))
                r2 = float(r2_score(actual, prediction)) if np.var(actual) else float("nan")

                fig, ax = plt.subplots(figsize=(11, 4.2))
                ax.plot(frame.time, actual, color="#1d70b7", lw=1.8, label="Actual")
                ax.plot(frame.time, prediction, color="#df4d33", lw=1.8, ls="--", label="2CNN-LSTM prediction")
                short_event = event.split(" ")[0]
                ax.set_title(f"{NAMES[station]} | {short_event} TEST | +{result['lead_hours']}h | RMSE={rmse:.2f} cm | MAE={mae:.2f} cm | R²={r2:.3f}")
                ax.set_ylabel("Residual surge (cm)")
                ax.set_xlabel("Evaluation time (Taiwan time)")
                ax.xaxis.set_major_locator(mdates.AutoDateLocator(minticks=5, maxticks=9))
                ax.xaxis.set_major_formatter(mdates.DateFormatter("%m-%d %H:%M"))
                ax.grid(True, alpha=.28)
                ax.legend()
                fig.autofmt_xdate(rotation=25)
                fig.tight_layout()
                fig.savefig(OUT / f"{station}-{slug}-{result['lead_hours']}h.png", dpi=160)
                plt.close(fig)
    print("Rendered 18 retrained test curves")


if __name__ == "__main__":
    main()
