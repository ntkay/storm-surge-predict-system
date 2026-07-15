import json
import requests
import urllib3
from pathlib import Path

urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

API_KEY = "CWA-F1CCC8EC-0DF3-46DB-9A48-5194FCF84C53"

URL = f"https://opendata.cwa.gov.tw/api/v1/rest/datastore/W-C0034-005?Authorization=CWA-F1CCC8EC-0DF3-46DB-9A48-5194FCF84C53&format=JSON"

def main():
    response = requests.get(URL, timeout=20, verify=False)
    response.raise_for_status()

    data = response.json()

    output_dir = Path("public/data")
    output_dir.mkdir(parents=True, exist_ok=True)

    output_file = output_dir / "cwa_typhoon.json"

    with open(output_file, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)

    print("已儲存到：", output_file)

if __name__ == "__main__":
    main()