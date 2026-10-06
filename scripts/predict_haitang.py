"""Reconstruct Haitang inputs from archived CWA and NOAA data and run exported BPNNs.

This is an exploratory historical reconstruction, not reproduction of the original
47-raw-data test or an operational forecast. See assumptions in the output manifest.
Run using the bundled Python runtime with numpy.
"""
import csv
import hashlib
import io
import json
import math
import zipfile
from datetime import datetime, timedelta, timezone
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / 'data/bpnn-source'
OUTPUT = ROOT / 'public/data/bpnn'
TZ = timezone(timedelta(hours=8))
FEATURES = ['surgeC_cm', 'pressure_hpa', 'wind_m_s', 'distance_km',
            'track_dx_deg', 'track_dy_deg', 'water_cm', 'tide_cm']


def archived_rows(path, prefix, header):
    with zipfile.ZipFile(path) as archive:
        name = next(name for name in archive.namelist() if name.startswith(prefix))
        content = archive.read(name).decode('utf-8-sig').replace('\ufeff', '')
        return list(csv.DictReader(io.StringIO(content[content.index(header):])))


def number(value):
    try:
        result = float(value)
        return result if math.isfinite(result) and abs(result) < 9000 else None
    except (ValueError, TypeError):
        return None


def tide_values(path, prefix, header, column):
    result = {}
    for row in archived_rows(path, prefix, header):
        value = number(row.get(column))
        if value is not None:
            time = datetime.strptime(row['yyyymmddhh'], '%Y%m%d%H').replace(tzinfo=TZ)
            result[time] = value / 10  # Assumed raw millimetres -> model centimetres.
    return result


def distance(lat, lon):
    phi1, phi2 = map(math.radians, [25.0975, lat])
    dphi, dlambda = math.radians(lat - 25.0975), math.radians(lon - 121.9181)
    a = math.sin(dphi / 2)**2 + math.cos(phi1)*math.cos(phi2)*math.sin(dlambda / 2)**2
    return 6371 * 2 * math.atan2(math.sqrt(a), math.sqrt(1-a))


def main():
    water = tide_values(SOURCE / 'tide-api-2005.download', '2005_1226', 'st,yyyymmddhh,', '00')
    # Pick the 6-minute forecast, not the high/low forecast file.
    with zipfile.ZipFile(SOURCE / 'astronomical-200507.download') as archive:
        name = next(n for n in archive.namelist() if n.startswith('1226_') and n.endswith('_tide6ha.csv'))
        text = archive.read(name).decode('utf-8-sig').replace('\ufeff', '')
    tide = {}
    for row in csv.DictReader(io.StringIO(text[text.index('stid,yyyymmddhh,min0'):])):
        value = number(row['min0'])
        if value is not None:
            tide[datetime.strptime(row['yyyymmddhh'], '%Y%m%d%H').replace(tzinfo=TZ)] = value / 10
    tracks = []
    with (SOURCE / 'ibtracs.WP.csv').open(encoding='utf-8-sig', newline='') as stream:
        for row in csv.DictReader(stream):
            if row['SID'].strip() != '2005192N22155':
                continue
            values = [number(row[k]) for k in ['LAT', 'LON', 'WMO_WIND', 'WMO_PRES']]
            if all(value is not None for value in values):
                time = datetime.strptime(row['ISO_TIME'].strip(), '%Y-%m-%d %H:%M:%S').replace(tzinfo=timezone.utc)
                tracks.append((time, values))
    tracks.sort()
    if not tracks:
        raise ValueError('No Haitang WMO observations found')
    start = datetime(2005, 7, 16, tzinfo=TZ)
    end = datetime(2005, 7, 21, tzinfo=TZ)
    features, input_rows = {}, []
    for time in sorted(water.keys() & tide.keys()):
        if not start - timedelta(hours=23) <= time <= end:
            continue
        previous = [track for track in tracks if track[0] <= time]
        if not previous or time - previous[-1][0] > timedelta(hours=6):
            continue
        track_time, (lat, lon, wind, pressure) = previous[-1]
        vector = [water[time]-tide[time], pressure, wind*0.514444,
                  distance(lat, lon), lon-121.9181, lat-25.0975, water[time], tide[time]]
        features[time] = vector
        input_rows.append({'time': time.isoformat(), 'track_time': track_time.isoformat(),
                           **dict(zip(FEATURES, vector))})
    OUTPUT.mkdir(parents=True, exist_ok=True)
    results = []
    for lead in [1, 3, 6]:
        path = ROOT / f'models/longdong-bpnn/models/BPNN_Longdong_47Raw_Lead{lead:02d}h_Ensemble5.npz'
        with np.load(path, allow_pickle=False) as model:
            assert model['feature_names'].tolist() == FEATURES
            assert model['sequence_length'][0] == 24
            assert model['layer_sizes'].tolist() == [192, 8, 1]
            points = []
            for issued in sorted(features):
                target = issued + timedelta(hours=lead)
                if issued < start or target > end:
                    continue
                times = [issued - timedelta(hours=23-index) for index in range(24)]
                if any(time not in features for time in times):
                    continue
                window = np.array([features[time] for time in times], dtype=float)
                inputs = (((window-model['mean'])/model['std']) * model['temporal_weights'][:, None]).reshape(1, -1)
                predictions = []
                for run in range(int(model['run_count'][0])):
                    hidden = np.maximum(0, inputs @ model[f'run{run}_w0'] + model[f'run{run}_b0'])
                    value = hidden @ model[f'run{run}_w1'] + model[f'run{run}_b1']
                    predictions.append(float((value*model['target_std']+model['target_mean']).item())/100)
                predicted = float(np.mean(predictions))
                assert math.isfinite(predicted)
                actual = (water[target]-tide[target])/100 if target in water and target in tide else None
                points.append({'station': 'C4A02', 'issued_at': issued.isoformat(), 'time': target.isoformat(),
                               'predicted_surge': predicted, 'actual_surge': actual})
            if not points:
                raise ValueError(f'No complete windows for lead {lead}')
            paired = [p for p in points if p['actual_surge'] is not None]
            actual = np.array([p['actual_surge'] for p in paired])
            predicted = np.array([p['predicted_surge'] for p in paired])
            denominator = float(np.sum((actual-actual.mean())**2))
            metrics = {'count': len(paired), 'rmse_m': float(np.sqrt(np.mean((predicted-actual)**2))),
                       'mae_m': float(np.mean(np.abs(predicted-actual))),
                       'r2': 1-float(np.sum((predicted-actual)**2))/denominator if denominator else None}
            results.append({'lead_hours': lead, 'model_sha256': hashlib.sha256(path.read_bytes()).hexdigest(),
                            'metrics': metrics, 'points': points})
    payload = {
        'event_id': '200505', 'event_name': '2005 海棠 Haitang', 'station': 'C4A02', 'units': 'm',
        'mode': 'exploratory-historical-reconstruction', 'validation': 'unverified-feature-definitions',
        'assumptions': [
            '官方潮位／天文潮原始數字暫按 mm 處理，轉 cm 輸入模型；天文潮檔頭標示 cm，單位待來源確認。',
            '取每小時整點潮位與天文潮之差為 surgeC_cm；未套用原始訓練資料可能的校正或重採樣。',
            '氣壓與風速使用 NOAA WMO 颱風中心數據，風速 knots 轉 m/s；是否與原模型的機構及平均時段一致待確認。',
            '缺逐時路徑時使用此前最近的 WMO 記錄，最多 6 小時；不使用未來路徑插值。與匯出摘要不前填設定不同。',
            'track_dx_deg / track_dy_deg 暫定為颱風中心經度／緯度減龍洞站位置；原始定義待確認。',
            '24 小時資料按舊至新展平，使用 NPZ mean/std、temporal_weights 與五模型平均輸出。',
            '此為歷史最佳路徑重建推論，並非即時預報或原始測試重現；結果不代表已驗證準確度。'
        ],
        'sources': [
            {'title': '中央氣象署海象資料下載（2005 龍洞潮位、2005/07 天文潮）', 'url': 'https://ocean.cwa.gov.tw/V2/data_interface/datasets'},
            {'title': 'NOAA IBTrACS v04r01 最佳路徑', 'url': 'https://www.ncei.noaa.gov/products/international-best-track-archive'}
        ],
        'results': results,
    }
    (OUTPUT / 'haitang-predictions.json').write_text(json.dumps(payload, ensure_ascii=False, indent=2, allow_nan=False), encoding='utf-8')
    with (SOURCE / 'haitang-inputs.csv').open('w', encoding='utf-8', newline='') as stream:
        writer = csv.DictWriter(stream, fieldnames=['time', 'track_time'] + FEATURES)
        writer.writeheader()
        writer.writerows(input_rows)
    for result in results:
        print(result['lead_hours'], len(result['points']), result['metrics'])


if __name__ == '__main__':
    main()
