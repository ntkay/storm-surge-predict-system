import { canonicalStationId } from '../shared/tideStations.js';
import { useEffect, useState } from 'react';
import { landWarningTimes, parseTaiwanTime, sixHourTicks } from './typhoonWarningTimes.js';

const panel = { background: '#fff', border: '1px solid #93c5fd', borderRadius: 12, padding: 20, marginBottom: 20 };
const figures = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 650px), 1fr))', gap: 14 };
const storms = {
  longdong: [
    { key: 'haitang', match: /haitang|海棠/i, name: '海棠（Haitang, 2005）', testId: '2005Haitang s' },
    { key: 'jangmi', match: /jangmi|薔蜜|薔薇/i, name: '薔蜜（Jangmi, 2008）', testId: '2008Jangmi s' },
    { key: 'sinlaku', match: /sinlaku|辛樂克/i, name: '辛樂克（Sinlaku, 2008）', testId: '2008Sinlaku s' },
  ],
  suao: [
    { key: 'talim', match: /talim|泰利|潭美/i, name: '泰利（Talim, 2005）', testId: '2005Talim s' },
    { key: 'kaemi', match: /kaemi|凱米/i, name: '凱米（Kaemi, 2006）', testId: '2006Kaemi s' },
    { key: 'kong-rey', match: /kong.?rey|康芮/i, name: '康芮（Kong-rey, 2013）', testId: '2013KONG-REY s' },
    { key: 'sinlaku', match: /sinlaku|辛樂克/i, name: '辛樂克（Sinlaku, 2008）', testId: '200813Sinlaku s' },
  ],
};

export default function StormLstmDemo({ stationId, eventName }) {
  const canonicalId = canonicalStationId(stationId);
  const station = canonicalId === 'C4A02' ? 'longdong' : canonicalId === 'C4U01' ? 'suao' : '';
  const storm = storms[station]?.find((item) => item.match.test(String(eventName || '')));
  const [training, setTraining] = useState(null);
  const dataFile = station === 'suao' && storm?.key === 'sinlaku' ? 'suao-sinlaku-legacy.json' : `${station}-retrained.json`;
  useEffect(() => {
    if (!station) return undefined;
    const controller = new AbortController();
    fetch(`/data/lstm/${dataFile}`, { signal: controller.signal })
      .then((response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.json();
      })
      .then(setTraining)
      .catch((error) => {
        if (error.name !== 'AbortError') setTraining(null);
      });
    return () => controller.abort();
  }, [dataFile, station]);
  if (!storm) return null;

  const title = station === 'longdong' ? '龍洞' : '蘇澳';
  const units = station === 'longdong' ? [16, 16, 32] : [32, 32, 64];
  const warningStart = Date.parse(landWarningTimes[storm.key]);
  const warningLabel = new Intl.DateTimeFormat('zh-TW', { timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(warningStart);
  return <section aria-labelledby="lstm-demo-title" style={panel}>
    <h4 id="lstm-demo-title" style={{ marginTop: 0 }}>{title} · {storm.name} · CNN-LSTM 測試曲線</h4>
    <p>藍線是實測增水，紅色虛線是 CNN-LSTM 預測；訓練使用 CWA 逐時整點潮位、UTide 年度天文潮分離，以及 NOAA IBTrACS 逐時內插颱風路徑。本颱風曲線及誤差統計僅納入陸上颱風警報發布後、以該時刻起報的預測（{warningLabel}，臺灣時間）；橫軸每 6 小時標示，預測資料仍為逐時。</p>
    {!training && <p>載入 CNN-LSTM 曲線中…</p>}
    <div style={figures}>
      {[1, 3, 6].map((lead, index) => {
        const result = training?.results.find((row) => row.lead_hours === lead);
        const fullEventPoints = result?.points.filter((point) => point.event === storm.testId) || [];
        const eventPoints = fullEventPoints
          .map(point => ({
            ...point,
            forecast_issue_at: new Date(parseTaiwanTime(point.time) - lead * 60 * 60 * 1000).toISOString(),
          }))
          .filter(point => parseTaiwanTime(point.forecast_issue_at) >= warningStart);
        const actual = eventPoints.map((point) => point.actual_cm);
        const predicted = eventPoints.map((point) => point.prediction_cm);
        const eventMae = actual.length ? actual.reduce((sum, value, i) => sum + Math.abs(value - predicted[i]), 0) / actual.length : null;
        const eventRmse = actual.length ? Math.sqrt(actual.reduce((sum, value, i) => sum + (value - predicted[i]) ** 2, 0) / actual.length) : null;
        const eventMean = actual.length ? actual.reduce((sum, value) => sum + value, 0) / actual.length : 0;
        const eventDenom = actual.reduce((sum, value) => sum + (value - eventMean) ** 2, 0);
        const eventR2 = eventDenom ? 1 - actual.reduce((sum, value, i) => sum + (predicted[i] - value) ** 2, 0) / eventDenom : null;
        return <figure key={lead} style={{ margin: 0 }}>
          <figcaption style={{ fontWeight: 700, marginBottom: 6 }}>+{lead} 小時 · LSTM {units[index]} 單元{eventRmse !== null ? ` · 本颱風 RMSE ${eventRmse.toFixed(2)} cm / MAE ${eventMae.toFixed(2)} cm / R² ${eventR2?.toFixed(3) ?? '—'}` : ''}</figcaption>
          <ForecastChart points={eventPoints} station={title} storm={storm.name} lead={lead} warningStart={warningStart} />
        </figure>;
      })}
    </div>
    <details style={{ marginTop: 12 }}>
      <summary>模型與資料說明</summary>
      <p>{station === 'suao' && storm.key === 'sinlaku' ? '辛樂克保留原先以該颱風獨立留出所產生的測試曲線。' : '顯示 Notebook 留出測試颱風的歷史逐時結果。'}非即時預報。模型為兩層 Conv1D 接 LSTM，使用 24 小時視窗並分別預測 +1、+3、+6 小時。為在本機 CPU 訓練，batch size 設為 128（原 Notebook 為 8），訓練 100 epochs。圖中以有效時間減去預測時距還原起報時間，只保留陸警發布後的起報樣本。</p>
    </details>
  </section>;
}

function ForecastChart({ points, station, storm, lead, warningStart }) {
  if (!points.length) return <p>陸上警報發布後沒有可繪製的測試點。</p>;
  const left = 55, top = 18, bottom = 245;
  const min = Math.min(0, ...points.flatMap(point => [point.actual_cm, point.prediction_cm]));
  const max = Math.max(0, ...points.flatMap(point => [point.actual_cm, point.prediction_cm]));
  const pad = Math.max((max - min) * 0.1, 1), low = min - pad, high = max + pad;
  const start = warningStart, end = Math.max(parseTaiwanTime(points.at(-1).forecast_issue_at), start + 3600000);
  const sixHours = 6 * 60 * 60 * 1000;
  const intervalCount = Math.max(1, Math.ceil((end - start) / sixHours));
  const right = left + intervalCount * 82, svgWidth = right + 24;
  const x = value => left + (parseTaiwanTime(value) - start) / (end - start) * (right - left);
  const y = value => bottom - (value - low) / (high - low) * (bottom - top);
  const path = key => points.map((point, index) => `${index ? 'L' : 'M'}${x(point.forecast_issue_at).toFixed(1)},${y(point[key]).toFixed(1)}`).join(' ');
  const ticks = Array.from({ length: 5 }, (_, index) => low + (high - low) * index / 4);
  const times = sixHourTicks(start, end);
  const formatTime = value => new Intl.DateTimeFormat('zh-TW', { timeZone: 'Asia/Taipei', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(value));
  return <div style={{ overflowX: 'auto', border: '1px solid #e2e8f0', borderRadius: 8 }}>
    <svg viewBox={`0 0 ${svgWidth} 305`} style={{ width: `${svgWidth}px`, maxWidth: 'none', display: 'block' }} role="img" aria-label={`${station} ${storm} +${lead} 小時 CNN-LSTM 預測曲線，自陸上警報發布時間開始，時間軸每六小時標示`}>
      <text x="12" y="15" fontSize="12">暴潮增水 (cm)</text>
      {ticks.map((value, index) => <g key={index}><line x1={left} x2={right} y1={y(value)} y2={y(value)} stroke="#dbe3ec" /><text x={left - 8} y={y(value) + 4} textAnchor="end" fontSize="11" fill="#475569">{value.toFixed(1)}</text></g>)}
      <line x1={left} x2={right} y1={y(0)} y2={y(0)} stroke="#64748b" strokeDasharray="4 4" />
      <rect x={left} y={top} width={right - left} height={bottom - top} fill="none" stroke="#94a3b8" />
      {times.map((time, index) => <g key={index}><line x1={x(time)} x2={x(time)} y1={top} y2={bottom} stroke="#edf1f5" /><text x={x(time)} y="267" textAnchor="middle" fontSize="10" fill="#475569">{formatTime(time)}</text></g>)}
      <text x={(left + right) / 2} y="296" textAnchor="middle" fontSize="12" fill="#334155">預測起報時間（臺灣時間；自陸上警報發布起；每 6 小時標示）</text>
      <path d={path('actual_cm')} fill="none" stroke="#1769aa" strokeWidth="2.2" />
      <path d={path('prediction_cm')} fill="none" stroke="#dc2626" strokeWidth="2.2" strokeDasharray="7 4" />
      <g transform={`translate(${left + 8},${top + 12})`}><line x1="0" x2="24" y1="0" y2="0" stroke="#1769aa" strokeWidth="2.2" /><text x="30" y="4" fontSize="11">實測增水</text><line x1="125" x2="149" y1="0" y2="0" stroke="#dc2626" strokeWidth="2.2" strokeDasharray="7 4" /><text x="155" y="4" fontSize="11">CNN-LSTM 預測</text></g>
    </svg>
  </div>;
}
