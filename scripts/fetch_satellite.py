from pathlib import Path
from datetime import datetime
import requests

PROJECT_DIR = Path(__file__).resolve().parent.parent

OUTPUT_DIR = PROJECT_DIR / "public" / "data"
OUTPUT_FILE = OUTPUT_DIR / "satellite.jpg"

SATELLITE_URL = (
    "https://cwaopendata.s3.ap-northeast-1.amazonaws.com/"
    "Observation/O-C0042-002.jpg"
)


def main():
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    response = requests.get(
        SATELLITE_URL,
        timeout=30
    )

    response.raise_for_status()

    with OUTPUT_FILE.open("wb") as file:
        file.write(response.content)

    print(
        f"[{datetime.now():%Y-%m-%d %H:%M:%S}] "
        f"衛星雲圖更新成功：{OUTPUT_FILE}"
    )


if __name__ == "__main__":
    main()