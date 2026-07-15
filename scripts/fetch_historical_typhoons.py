import csv
import json
import requests
from pathlib import Path
from collections import defaultdict
from datetime import datetime

URL = "https://www.ncei.noaa.gov/data/international-best-track-archive-for-climate-stewardship-ibtracs/v04r01/access/csv/ibtracs.WP.list.v04r01.csv"

START_YEAR = 2000
CURRENT_YEAR = datetime.now().year

def to_float(value):
    try:
        if value is None or value.strip() == "":
            return None
        return float(value)
    except:
        return None

def to_int(value):
    try:
        if value is None or value.strip() == "":
            return None
        return int(float(value))
    except:
        return None

def main():
    print("下載 IBTrACS 西北太平洋颱風資料中...")

    response = requests.get(URL, timeout=60)
    response.raise_for_status()

    text = response.text.splitlines()
    reader = csv.DictReader(text)

    typhoons = defaultdict(lambda: {
        "sid": "",
        "year": "",
        "name": "",
        "basin": "WP",
        "track": []
    })

    for row in reader:
        season = row.get("SEASON", "").strip()

        if not season.isdigit():
            continue

        year = int(season)

        if year < START_YEAR or year > CURRENT_YEAR:
            continue

        sid = row.get("SID", "").strip()
        name = row.get("NAME", "").strip()
        iso_time = row.get("ISO_TIME", "").strip()

        lat = to_float(row.get("LAT"))
        lon = to_float(row.get("LON"))

        if not sid or lat is None or lon is None:
            continue

        wind = to_int(row.get("WMO_WIND")) or to_int(row.get("USA_WIND"))
        pressure = to_int(row.get("WMO_PRES")) or to_int(row.get("USA_PRES"))

        typhoons[sid]["sid"] = sid
        typhoons[sid]["year"] = year
        typhoons[sid]["name"] = name if name else "未命名"
        typhoons[sid]["track"].append({
            "time": iso_time,
            "lat": lat,
            "lon": lon,
            "wind": wind,
            "pressure": pressure
        })

    result = list(typhoons.values())

    result.sort(key=lambda x: (x["year"], x["name"]))

    output_dir = Path("public/data")
    output_dir.mkdir(parents=True, exist_ok=True)

    output_file = output_dir / "typhoons.json"

    with open(output_file, "w", encoding="utf-8") as f:
        json.dump(result, f, ensure_ascii=False, indent=2)

    print(f"完成，共整理 {len(result)} 個颱風")
    print(f"已儲存到：{output_file}")

if __name__ == "__main__":
    main()