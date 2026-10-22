import io
import json
import os
import shutil
import tempfile
import zipfile
from collections import defaultdict
from datetime import datetime
from pathlib import Path
from urllib.parse import unquote

import requests
import urllib3
import xml.etree.ElementTree as ET
from dotenv import load_dotenv


# =========================================================
# 基本設定
# =========================================================

PROJECT_DIR = Path(__file__).resolve().parent.parent
OUTPUT_DIR = PROJECT_DIR / "public" / "data"

TILES_DIR = OUTPUT_DIR / "satellite_tiles"
MANIFEST_FILE = OUTPUT_DIR / "satellite_manifest.json"
META_FILE = OUTPUT_DIR / "satellite_meta.json"

DATA_ID = "O-B0033-003"

# 最多選擇多少張衛星切片給 Leaflet
MAX_TILES = 256

CWA_API_URL = (
    f"https://opendata.cwa.gov.tw/"
    f"fileapi/v1/opendataapi/{DATA_ID}"
)


# =========================================================
# API KEY
# =========================================================

load_dotenv(PROJECT_DIR / ".env")

API_KEY = os.getenv("CWA_API_KEY")

if not API_KEY:
    raise RuntimeError(
        "找不到 CWA_API_KEY，請確認專案根目錄的 .env"
    )


# =========================================================
# SSL
# =========================================================

urllib3.disable_warnings(
    urllib3.exceptions.InsecureRequestWarning
)


def download(url, params=None):
    """
    先正常驗證 SSL。
    若 CWA / Python 3.14 發生憑證問題，
    才退回 verify=False。
    """

    try:
        response = requests.get(
            url,
            params=params,
            timeout=90,
            allow_redirects=True,
        )

    except requests.exceptions.SSLError:
        print("SSL 驗證異常，改用相容模式下載...")

        response = requests.get(
            url,
            params=params,
            timeout=90,
            allow_redirects=True,
            verify=False,
        )

    except requests.RequestException as exc:
        raise RuntimeError(
            f"下載失敗：{type(exc).__name__}"
        ) from None

    if response.status_code != 200:
        raise RuntimeError(
            f"CWA 回傳 HTTP {response.status_code}"
        )

    return response


# =========================================================
# XML / KML 工具
# =========================================================

def tag_name(element):
    if not isinstance(element.tag, str):
        return ""

    return element.tag.split("}")[-1]


def find_text(element, target):
    for child in element.iter():

        if tag_name(child) == target:

            if child.text:
                return child.text.strip()

    return None


def get_kml_level(kml_file, extract_dir):
    """
    CWA SuperOverlay 通常：
    0/0/0.kml
    1/0/0.kml
    2/...
    第一層數字可視為 zoom level。
    """

    try:
        relative = kml_file.relative_to(extract_dir)

    except ValueError:
        return None

    for part in relative.parts[:-1]:

        if part.isdigit():
            return int(part)

    return None


# =========================================================
# 解析 GroundOverlay
# =========================================================

def collect_overlays(extract_dir):

    all_files = [
        path
        for path in extract_dir.rglob("*")
        if path.is_file()
    ]

    # 建立檔名索引，處理少數相對路徑找不到的情況
    file_index = defaultdict(list)

    for path in all_files:
        file_index[path.name].append(path)

    kml_files = [
        path
        for path in all_files
        if path.suffix.lower() == ".kml"
    ]

    print(f"KMZ 內共有 {len(kml_files)} 個 KML")

    overlays = []

    parse_errors = 0

    for kml_file in kml_files:

        try:
            tree = ET.parse(kml_file)
            root = tree.getroot()

        except Exception:
            parse_errors += 1
            continue

        level = get_kml_level(
            kml_file,
            extract_dir
        )

        for element in root.iter():

            if tag_name(element) != "GroundOverlay":
                continue

            href = find_text(
                element,
                "href"
            )

            north = find_text(
                element,
                "north"
            )

            south = find_text(
                element,
                "south"
            )

            east = find_text(
                element,
                "east"
            )

            west = find_text(
                element,
                "west"
            )

            if not all([
                href,
                north,
                south,
                east,
                west,
            ]):
                continue

            href = unquote(
                href.replace("\\", "/")
            )

            try:
                north = float(north)
                south = float(south)
                east = float(east)
                west = float(west)

            except ValueError:
                continue

            image_path = (
                kml_file.parent / href
            ).resolve()

            # 如果正常相對路徑找不到
            if not image_path.exists():

                image_name = Path(href).name

                matches = file_index.get(
                    image_name,
                    []
                )

                if not matches:
                    continue

                image_path = matches[0]

            overlays.append({
                "kml": kml_file,
                "image_path": image_path,
                "level": level,

                "north": north,
                "south": south,
                "east": east,
                "west": west,
            })

    if parse_errors:
        print(
            f"有 {parse_errors} 個 KML 無法解析，已略過"
        )

    return overlays


# =========================================================
# 選擇一個合理的解析層級
# =========================================================

def choose_overlay_level(overlays):

    level_groups = defaultdict(list)

    for overlay in overlays:

        level = overlay["level"]

        if level is not None:
            level_groups[level].append(
                overlay
            )

    # CWA 使用標準分層目錄時
    if level_groups:

        print()
        print("可用衛星層級：")

        for level in sorted(level_groups):
            print(
                f"Level {level}: "
                f"{len(level_groups[level])} 張"
            )

        allowed_levels = [
            level
            for level, items
            in level_groups.items()
            if len(items) <= MAX_TILES
        ]

        if allowed_levels:

            selected_level = max(
                allowed_levels
            )

        else:

            selected_level = min(
                level_groups,
                key=lambda level:
                    abs(
                        len(level_groups[level])
                        - MAX_TILES
                    )
            )

        selected = level_groups[
            selected_level
        ]

        print()
        print(
            f"選擇 Level {selected_level}："
            f"{len(selected)} 張"
        )

        return selected, selected_level

    # -----------------------------------------------------
    # 如果目錄不是標準 zoom level，
    # 改以每張圖片涵蓋範圍分組
    # -----------------------------------------------------

    groups = defaultdict(list)

    for overlay in overlays:

        lat_span = round(
            abs(
                overlay["north"]
                - overlay["south"]
            ),
            6
        )

        lon_span = round(
            abs(
                overlay["east"]
                - overlay["west"]
            ),
            6
        )

        groups[
            (lat_span, lon_span)
        ].append(overlay)

    candidates = [
        (size, items)
        for size, items
        in groups.items()
        if len(items) <= MAX_TILES
    ]

    if candidates:

        size, selected = min(
            candidates,
            key=lambda item:
                item[0][0]
                * item[0][1]
        )

    else:

        size, selected = min(
            groups.items(),
            key=lambda item:
                abs(
                    len(item[1])
                    - MAX_TILES
                )
        )

    print(
        f"選擇解析範圍 {size}："
        f"{len(selected)} 張"
    )

    return selected, None


# =========================================================
# 輸出 Leaflet 用切片
# =========================================================

def export_tiles(
    overlays,
    selected_level,
    product_name,
):

    # 每次更新都移除舊切片
    if TILES_DIR.exists():
        shutil.rmtree(
            TILES_DIR
        )

    TILES_DIR.mkdir(
        parents=True,
        exist_ok=True
    )

    tiles = []

    for index, overlay in enumerate(
        overlays,
        start=1
    ):

        source = overlay[
            "image_path"
        ]

        suffix = source.suffix.lower()

        if not suffix:
            suffix = ".jpg"

        filename = (
            f"tile_{index:04d}"
            f"{suffix}"
        )

        destination = (
            TILES_DIR / filename
        )

        shutil.copy2(
            source,
            destination
        )

        tiles.append({
            "url":
                f"data/satellite_tiles/"
                f"{filename}",

            "bounds": {
                "north":
                    overlay["north"],

                "south":
                    overlay["south"],

                "east":
                    overlay["east"],

                "west":
                    overlay["west"],
            }
        })

    if not tiles:
        raise RuntimeError(
            "沒有可輸出的衛星切片"
        )

    overall_bounds = {
        "north": max(
            item["bounds"]["north"]
            for item in tiles
        ),

        "south": min(
            item["bounds"]["south"]
            for item in tiles
        ),

        "east": max(
            item["bounds"]["east"]
            for item in tiles
        ),

        "west": min(
            item["bounds"]["west"]
            for item in tiles
        ),
    }

    updated_at = (
        datetime.now()
        .astimezone()
        .isoformat()
    )

    manifest = {
        "source": "CWA",
        "dataset": DATA_ID,
        "productName": product_name,
        "updatedAt": updated_at,
        "selectedLevel": selected_level,
        "tileCount": len(tiles),
        "overallBounds": overall_bounds,
        "tiles": tiles,
    }

    with MANIFEST_FILE.open(
        "w",
        encoding="utf-8",
    ) as file:

        json.dump(
            manifest,
            file,
            ensure_ascii=False,
            indent=2,
        )

    # 保留一份簡單 metadata
    with META_FILE.open(
        "w",
        encoding="utf-8",
    ) as file:

        json.dump(
            {
                "source": "CWA",
                "dataset": DATA_ID,
                "productName": product_name,
                "updatedAt": updated_at,
                "tileCount": len(tiles),
                "bounds": overall_bounds,
            },
            file,
            ensure_ascii=False,
            indent=2,
        )

    return tiles, overall_bounds


# =========================================================
# MAIN
# =========================================================

def main():

    OUTPUT_DIR.mkdir(
        parents=True,
        exist_ok=True
    )

    print(
        "下載 CWA 東亞衛星資料描述..."
    )

    response = download(
        CWA_API_URL,
        params={
            "Authorization": API_KEY
        },
    )

    print(
        "HTTP 狀態：",
        response.status_code
    )

    # -----------------------------------------------------
    # 解析 CWA XML
    # -----------------------------------------------------

    try:
        xml_root = ET.fromstring(
            response.content
        )

    except ET.ParseError:
        raise RuntimeError(
            "CWA 回傳資料不是有效 XML"
        )

    product_urls = []

    for element in xml_root.iter():

        if (
            tag_name(element)
            == "ProductURL"
            and element.text
        ):

            product_urls.append(
                element.text.strip()
            )

    if not product_urls:
        raise RuntimeError(
            "CWA XML 裡找不到 ProductURL"
        )

    # 優先選真正 KMZ
    product_url = next(
        (
            url
            for url in product_urls
            if url.lower().endswith(".kmz")
        ),
        product_urls[0],
    )

    print("找到衛星產品：")
    print(product_url)

    # -----------------------------------------------------
    # 下載 KMZ
    # -----------------------------------------------------

    print("下載 KMZ...")

    kmz_response = download(
        product_url
    )

    print(
        "KMZ 下載成功："
        f"{len(kmz_response.content) / 1024 / 1024:.2f} MB"
    )

    # -----------------------------------------------------
    # 解壓 KMZ
    # -----------------------------------------------------

    with tempfile.TemporaryDirectory() as temp:

        temp_dir = Path(temp)

        extract_dir = (
            temp_dir / "extracted"
        )

        extract_dir.mkdir()

        try:

            with zipfile.ZipFile(
                io.BytesIO(
                    kmz_response.content
                )
            ) as kmz:

                kmz.extractall(
                    extract_dir
                )

        except zipfile.BadZipFile:

            raise RuntimeError(
                "CWA 回傳的檔案不是有效 KMZ"
            )

        # -------------------------------------------------
        # 找產品名稱
        # -------------------------------------------------

        product_name = ""

        doc_kml = (
            extract_dir / "doc.kml"
        )

        if doc_kml.exists():

            try:

                doc_root = ET.parse(
                    doc_kml
                ).getroot()

                for element in doc_root.iter():

                    if (
                        tag_name(element)
                        == "name"
                        and element.text
                    ):

                        product_name = (
                            element.text.strip()
                        )

                        break

            except Exception:
                pass

        print(
            "產品名稱：",
            product_name or "(未知)"
        )

        # -------------------------------------------------
        # 掃描所有 GroundOverlay
        # -------------------------------------------------

        print(
            "掃描 KMZ 內所有衛星切片..."
        )

        overlays = collect_overlays(
            extract_dir
        )

        print(
            f"共找到 "
            f"{len(overlays)} 個 "
            f"GroundOverlay"
        )

        if not overlays:

            raise RuntimeError(
                "KMZ 中沒有找到任何可用衛星影像"
            )

        # -------------------------------------------------
        # 選擇解析層級
        # -------------------------------------------------

        selected, selected_level = (
            choose_overlay_level(
                overlays
            )
        )

        # -------------------------------------------------
        # 輸出
        # -------------------------------------------------

        tiles, bounds = export_tiles(
            selected,
            selected_level,
            product_name,
        )

    print()
    print(
        "================================"
    )

    print(
        "CWA 衛星雲圖處理完成"
    )

    print(
        "================================"
    )

    print(
        f"產品：{product_name}"
    )

    print(
        f"輸出切片：{len(tiles)} 張"
    )

    print(
        "Manifest：",
        MANIFEST_FILE
    )

    print(
        "衛星範圍："
    )

    print(
        "North =",
        bounds["north"]
    )

    print(
        "South =",
        bounds["south"]
    )

    print(
        "East  =",
        bounds["east"]
    )

    print(
        "West  =",
        bounds["west"]
    )


if __name__ == "__main__":
    main()