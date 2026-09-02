import json
import os
import sys
from datetime import datetime
from pathlib import Path

import requests
import urllib3
from dotenv import load_dotenv

urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)


PROJECT_DIR = Path(__file__).resolve().parent.parent

load_dotenv(PROJECT_DIR / ".env")

API_KEY = os.getenv("CWA_API_KEY")

if not API_KEY:
    raise RuntimeError("找不到 CWA_API_KEY，請確認 .env")

API_URL = (
    "https://opendata.cwa.gov.tw/api/v1/rest/datastore/"
    f"W-C0034-005?Authorization={API_KEY}&format=JSON"
)

DATA_DIR = PROJECT_DIR / "public" / "data"

LIVE_FILE = DATA_DIR / "cwa_typhoon.json"
HISTORY_FILE = DATA_DIR / "typhoons.json"

TEMP_LIVE_FILE = DATA_DIR / "cwa_typhoon.tmp.json"
TEMP_HISTORY_FILE = DATA_DIR / "typhoons.tmp.json"

LOG_FILE = PROJECT_DIR / "scripts" / "fetch_typhoon.log"


def write_log(message):
    timestamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S")

    text = f"[{timestamp}] {message}"

    print(text)

    with LOG_FILE.open("a", encoding="utf-8") as log:
        log.write(text + "\n")


def safe_float(value):
    try:
        if value is None or value == "":
            return None

        return float(value)

    except Exception:
        return None


def safe_int(value):
    try:
        if value is None or value == "":
            return None

        return int(float(value))

    except Exception:
        return None


def load_history():
    if not HISTORY_FILE.exists():
        return []

    try:
        with HISTORY_FILE.open("r", encoding="utf-8") as file:
            data = json.load(file)

        if isinstance(data, list):
            return data

    except Exception as error:
        write_log(f"讀取歷史資料失敗：{error}")

    return []


def build_sid(cyclone):
    year = cyclone.get("Year") or datetime.now().year

    ty_no = (
        cyclone.get("CwaTyNo")
        or cyclone.get("CwaTdNo")
        or cyclone.get("TyphoonName")
        or "UNKNOWN"
    )

    return f"CWA-{year}-{ty_no}"


def convert_cwa_cyclone(cyclone):
    sid = build_sid(cyclone)

    year = safe_int(cyclone.get("Year")) or datetime.now().year

    name = (
        cyclone.get("TyphoonName")
        or cyclone.get("CwaTyphoonName")
        or "UNKNOWN"
    )

    fixes = cyclone.get("AnalysisData", {}).get("Fix", [])

    track = []

    for fix in fixes:
        lat = safe_float(fix.get("CoordinateLatitude"))
        lon = safe_float(fix.get("CoordinateLongitude"))

        if lat is None or lon is None:
            continue

        track.append({
            "time": fix.get("DateTime"),
            "lat": lat,
            "lon": lon,
            "wind": safe_int(fix.get("MaxWindSpeed")),
            "pressure": safe_int(fix.get("Pressure")),
        })

    return {
        "sid": sid,
        "year": year,
        "name": name,
        "basin": "WP",
        "source": "CWA-live",
        "track": track,
    }


def merge_tracks(old_track, new_track):
    points = {}

    for point in old_track:
        key = point.get("time")

        if key:
            points[key] = point

    for point in new_track:
        key = point.get("time")

        if key:
            points[key] = point

    merged = list(points.values())

    merged.sort(key=lambda item: item.get("time") or "")

    return merged


def update_history(cyclones):
    history = load_history()

    history_map = {
        item.get("sid"): item
        for item in history
        if item.get("sid")
    }

    changed = False

    for cyclone in cyclones:
        live_item = convert_cwa_cyclone(cyclone)

        sid = live_item["sid"]

        if sid in history_map:
            old = history_map[sid]

            old["name"] = live_item["name"]
            old["year"] = live_item["year"]
            old["source"] = "CWA-live"

            old["track"] = merge_tracks(
                old.get("track", []),
                live_item["track"]
            )

        else:
            history.append(live_item)
            history_map[sid] = live_item

        changed = True

    if not changed:
        return

    history.sort(
        key=lambda item: (
            item.get("year", 0),
            item.get("name", "")
        )
    )

    with TEMP_HISTORY_FILE.open(
        "w",
        encoding="utf-8"
    ) as file:
        json.dump(
            history,
            file,
            ensure_ascii=False,
            indent=2
        )

    os.replace(
        TEMP_HISTORY_FILE,
        HISTORY_FILE
    )

    write_log(
        f"歷史資料已同步，目前共 {len(history)} 個颱風"
    )


def main():
    try:
        DATA_DIR.mkdir(
            parents=True,
            exist_ok=True
        )

        response = requests.get(
            API_URL,
            timeout=30,
            verify=False,
            headers={
                "User-Agent": "StormSurgePredictSystem/1.0",
                "Accept": "application/json",
            },
        )

        response.raise_for_status()

        data = response.json()

        if str(data.get("success", "")).lower() != "true":
            raise ValueError("中央氣象署回傳 success 不是 true")

        with TEMP_LIVE_FILE.open(
            "w",
            encoding="utf-8"
        ) as file:
            json.dump(
                data,
                file,
                ensure_ascii=False,
                indent=2
            )

        os.replace(
            TEMP_LIVE_FILE,
            LIVE_FILE
        )

        cyclones = (
            data.get("records", {})
            .get("TropicalCyclones", {})
            .get("TropicalCyclone", [])
        )

        write_log(
            f"即時資料更新成功：目前共 {len(cyclones)} 個活動中熱帶氣旋"
        )

        update_history(cyclones)

        return 0

    except Exception as error:
        write_log(
            f"更新失敗：{error}"
        )

        return 1

    finally:
        if TEMP_LIVE_FILE.exists():
            TEMP_LIVE_FILE.unlink(missing_ok=True)

        if TEMP_HISTORY_FILE.exists():
            TEMP_HISTORY_FILE.unlink(missing_ok=True)


if __name__ == "__main__":
    sys.exit(main())