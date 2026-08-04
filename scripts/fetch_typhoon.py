import json
import os
import sys
from datetime import datetime
from pathlib import Path

import requests
import urllib3

urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

API_KEY = "CWA-F1CCC8EC-0DF3-46DB-9A48-5194FCF84C53"

API_URL = (
    "https://opendata.cwa.gov.tw/api/v1/rest/datastore/"
    f"W-C0034-005?Authorization={API_KEY}&format=JSON"
)

# 不管工作排程從哪個資料夾執行，都能正確找到專案
PROJECT_DIR = Path(__file__).resolve().parent.parent
OUTPUT_DIR = PROJECT_DIR / "public" / "data"
OUTPUT_FILE = OUTPUT_DIR / "cwa_typhoon.json"
TEMP_FILE = OUTPUT_DIR / "cwa_typhoon.tmp.json"
LOG_FILE = PROJECT_DIR / "scripts" / "fetch_typhoon.log"


def write_log(message: str) -> None:
    timestamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    text = f"[{timestamp}] {message}"

    print(text)

    with LOG_FILE.open("a", encoding="utf-8") as log:
        log.write(text + "\n")


def main() -> int:
    if not API_KEY or "請換成" in API_KEY:
        write_log("錯誤：尚未設定中央氣象署 API Key")
        return 1

    try:
        OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

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

        # 先寫暫存檔，成功後再覆蓋正式檔案，避免寫到一半中斷
        with TEMP_FILE.open("w", encoding="utf-8") as file:
            json.dump(data, file, ensure_ascii=False, indent=2)

        os.replace(TEMP_FILE, OUTPUT_FILE)

        cyclones = (
            data.get("records", {})
            .get("TropicalCyclones", {})
            .get("TropicalCyclone", [])
        )

        write_log(
            f"更新成功：目前共 {len(cyclones)} 個活動中熱帶氣旋，"
            f"已儲存至 {OUTPUT_FILE}"
        )

        return 0

    except requests.Timeout:
        write_log("更新失敗：中央氣象署 API 連線逾時")
    except requests.RequestException as error:
        write_log(f"更新失敗：網路或 HTTP 錯誤：{error}")
    except (ValueError, json.JSONDecodeError) as error:
        write_log(f"更新失敗：資料格式錯誤：{error}")
    except Exception as error:
        write_log(f"更新失敗：未預期錯誤：{error}")
    finally:
        if TEMP_FILE.exists():
            TEMP_FILE.unlink(missing_ok=True)

    return 1


if __name__ == "__main__":
    sys.exit(main())