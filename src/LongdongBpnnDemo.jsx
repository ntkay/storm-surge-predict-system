import { useEffect, useState } from 'react';
import { canonicalStationId } from '../shared/tideStations.js';

const panel = { background: '#fff', border: '1px solid #c4b5fd', borderRadius: 12, padding: 20, marginBottom: 20 };
const cell = { padding: 9, borderBottom: '1px solid #e2e8f0', textAlign: 'right', whiteSpace: 'nowrap' };
const formatTaiwan = value => new Intl.DateTimeFormat('zh-TW', {
  timeZone: 'Asia/Taipei', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
}).format(new Date(value));

export default function LongdongBpnnDemo({ stationId, eventName }) {
  const [payload, setPayload] = useState(null);
  const [loadError, setLoadError] = useState('');
  const event = String(eventName || '').toLowerCase();
  const isSinlaku = event.includes('sinlaku') || event.includes('辛樂克');
  const isLongdong = !stationId || canonicalStationId(stationId) === 'C4A02';

  useEffect(() => {
    if (!isSinlaku || !isLongdong) return undefined;
    const controller = new AbortController();
    fetch('/data/bpnn/sinlaku-predictions.json', { signal: controller.signal, cache: 'no-cache' })
      .then(response => {
        if (!response.ok) throw new Error(`曲線資料讀取失敗（${response.status}）`);
        return response.json();
      })
      .then(data => { if (!controller.signal.aborted) { setPayload(data); setLoadError(''); } })
      .catch(error => { if (!controller.signal.aborted) setLoadError(error.message); });
    return () => controller.abort();
  }, [isSinlaku, isLongdong]);

  const results = payload?.results || [];
  if (!isSinlaku || !isLongdong) return null;

  return <section aria-labelledby="bpnn-demo-title" style={panel}>
    <h4 id="bpnn-demo-title" style={{ marginTop: 0 }}>2008 辛樂克（Sinlaku）· 龍洞 BPNN 歷史重建</h4>
    <p>以龍洞站 2008 實測潮位與辛樂克歷史路徑重建 24 小時輸入，再套用匯出的五模型集成權重。顯示 +1、+3、+6 小時預測與對應時刻的增水估算。</p>
    {loadError && <p role="alert" style={{ color: '#b91c1c' }}>{loadError}</p>}
    {!results.length && !loadError && <p role="status">正在載入 BPNN 曲線…</p>}
    {results.length === 3 && <>
      {results.map(result => <LeadForecast key={result.lead_hours} result={result} />)}
      <details style={{ marginTop: 14 }}>
        <summary>資料來源與重建方式</summary>
        <ul>
          <li><a href="https://ocean.cwa.gov.tw/V2/data_interface/datasets" target="_blank" rel="noreferrer">中央氣象署海象資料下載</a>：龍洞站 2008 年逐 6 分鐘實測潮位，模型取每小時整點值。</li>
          <li><a href="https://www.ncei.noaa.gov/products/international-best-track-archive" target="_blank" rel="noreferrer">NOAA IBTrACS</a>：辛樂克歷史路徑、風速與氣壓。</li>
          <li>天文潮由 2001–2016 年官方實測潮位以十個主要分潮進行穩健調和擬合，並為各年分別估計基準；擬合時排除 2008 年 9 月 7 日至 18 日。官方未提供本次使用的 2008 年逐 6 分鐘天文潮檔。</li>
          <li>暴潮增水定義為實測潮位減重建天文潮。這是公開資料的歷史推論重建，並非原始測試集預測，也不是即時預報。</li>
        </ul>
      </details>
    </>}
  </section>;
}

function LeadForecast({ result }) {
  return <section aria-label={`+${result.lead_hours} 小時預測`} style={{ borderTop: '1px solid #e2e8f0', paddingTop: 14, marginTop: 14 }}>
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(130px,1fr))', gap: 10, margin: '12px 0' }}>
      <Metric label="RMSE" value={`${result.metrics.rmse_mm.toFixed(2)} mm`} />
      <Metric label="MAE" value={`${result.metrics.mae_mm.toFixed(2)} mm`} />
      <Metric label="R²" value={result.metrics.r2.toFixed(3)} />
      <Metric label="有效時點" value={`${result.metrics.count}`} />
    </div>
    <ForecastChart result={result} />
    <details style={{ marginTop: 10 }}>
      <summary>查看逐時資料表（{result.points.length} 筆）</summary>
      <div style={{ overflow: 'auto', maxHeight: 420, marginTop: 10 }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead><tr>
            {['預報發布時間（臺灣時間）', '有效時間（臺灣時間）', '實測／重建增水 (mm)', 'BPNN 預測 (mm)'].map(label => <th key={label} style={{ ...cell, position: 'sticky', top: 0, background: '#f8fafc' }}>{label}</th>)}
          </tr></thead>
          <tbody>{result.points.map(point => <tr key={point.issued_at}>
            <td style={{ ...cell, textAlign: 'left' }}>{formatTaiwan(point.issued_at)}</td>
            <td style={{ ...cell, textAlign: 'left' }}>{formatTaiwan(point.valid_at)}</td>
            <td style={cell}>{point.actual_surge_mm.toFixed(1)}</td>
            <td style={cell}>{point.predicted_surge_mm.toFixed(1)}</td>
          </tr>)}</tbody>
        </table>
      </div>
    </details>
  </section>;
}

function Metric({ label, value }) {
  return <div style={{ padding: 12, borderRadius: 8, background: '#f1f5f9' }}><div>{label}</div><strong style={{ display: 'block', marginTop: 5, fontSize: 20 }}>{value}</strong></div>;
}

function ForecastChart({ result }) {
  const points = result.points;
  const values = points.flatMap(point => [point.actual_surge_mm, point.predicted_surge_mm]);
  const lowValue = Math.min(0, ...values), highValue = Math.max(0, ...values);
  const padding = Math.max((highValue - lowValue) * 0.1, 20);
  const low = lowValue - padding, high = highValue + padding;
  const left = 70, right = 920, top = 24, bottom = 290;
  const start = Date.parse(points[0].issued_at), end = Date.parse(points.at(-1).issued_at);
  const x = time => left + (Date.parse(time) - start) / Math.max(end - start, 1) * (right - left);
  const y = value => bottom - (value - low) / (high - low) * (bottom - top);
  const pathFor = key => points.map((point, index) => `${index ? 'L' : 'M'}${x(point.issued_at).toFixed(1)},${y(point[key]).toFixed(1)}`).join(' ');
  const ticks = Array.from({ length: 5 }, (_, i) => low + (high - low) * i / 4);
  const dateTicks = Array.from({ length: 6 }, (_, i) => new Date(start + (end - start) * i / 5).toISOString());
  return <figure style={{ margin: '20px 0' }}>
    <figcaption style={{ fontWeight: 700, marginBottom: 8 }}>Sinlaku | BPNN | 24 小時滑動視窗 | +{result.lead_hours}h | mm</figcaption>
    <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap', marginBottom: 8 }}>
      <span style={{ color: '#1769aa' }}>━━ 實測／重建增水</span><span style={{ color: '#dc2626' }}>┄┄ BPNN 預測</span>
    </div>
    <div style={{ overflowX: 'auto' }}>
      <svg viewBox="0 0 960 350" style={{ width: '100%', minWidth: 720, display: 'block' }} role="img" aria-label={`辛樂克龍洞 +${result.lead_hours} 小時 BPNN 預測與實測增水曲線，單位毫米`}>
        <text x="14" y="18" fontSize="13">暴潮增水 (mm)</text>
        {ticks.map((value, index) => <g key={index}>
          <line x1={left} x2={right} y1={y(value)} y2={y(value)} stroke="#dbe3ec" />
          <text x={left - 9} y={y(value) + 4} textAnchor="end" fontSize="12" fill="#475569">{value.toFixed(0)}</text>
        </g>)}
        <line x1={left} x2={right} y1={y(0)} y2={y(0)} stroke="#64748b" strokeDasharray="4 4" />
        <rect x={left} y={top} width={right - left} height={bottom - top} fill="none" stroke="#94a3b8" />
        {dateTicks.map((time, index) => <text key={index} x={x(time)} y="313" textAnchor="middle" fontSize="11" fill="#475569">{formatTaiwan(time)}</text>)}
        <text x={(left + right) / 2} y="340" textAnchor="middle" fontSize="13" fill="#334155">預報發布時間（臺灣時間）</text>
        <path d={pathFor('actual_surge_mm')} fill="none" stroke="#1769aa" strokeWidth="2.3" />
        <path d={pathFor('predicted_surge_mm')} fill="none" stroke="#dc2626" strokeWidth="2.3" strokeDasharray="8 5" />
      </svg>
    </div>
  </figure>;
}
