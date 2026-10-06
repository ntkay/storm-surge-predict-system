import { useEffect, useState } from 'react';
import { canonicalStationId } from '../shared/tideStations.js';

const panel = { background: '#fff', border: '1px solid #c4b5fd', borderRadius: 12, padding: 20, marginBottom: 20 };
const cell = { padding: 9, borderBottom: '1px solid #e2e8f0', textAlign: 'right', whiteSpace: 'nowrap' };
const formatTaiwan = value => new Intl.DateTimeFormat('zh-TW', {
  timeZone: 'Asia/Taipei', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
}).format(new Date(value));

export default function LongdongBpnnDemo({ stationId, eventName }) {
  const [loaded, setLoaded] = useState(null);
  const event = String(eventName || '').toLowerCase();
  const selectedStation = !stationId || canonicalStationId(stationId) === 'C4A02' ? 'longdong' : canonicalStationId(stationId) === 'C4U01' ? 'suao' : '';
  const storm = [
    { key: 'sinlaku', match: /sinlaku|辛樂克/i, name: '2008 辛樂克（Sinlaku）' },
    { key: 'haitang', match: /haitang|海棠/i, name: '2005 海棠（Haitang）' },
    { key: 'jangmi', match: /jangmi|薔蜜|薔薇/i, name: '2008 薔蜜（Jangmi）' },
    { key: 'talim', match: /talim|潭美/i, name: '2005 潭美（Talim）', suaoOnly: true },
    { key: 'kaemi', match: /kaemi|凱米/i, name: '2006 凱米（Kaemi）', suaoOnly: true },
    { key: 'kong-rey', match: /kong.?rey|康芮/i, name: '2013 康芮（Kong-rey）', suaoOnly: true },
  ].find(item => item.match.test(event) && (item.suaoOnly ? selectedStation === 'suao' : true));
  const isLongdong = selectedStation === 'longdong';
  const file = selectedStation === 'suao' ? `suao-${storm?.key}-predictions.json` : `${storm?.key}-predictions.json`;
  const requestKey = storm && selectedStation ? `${selectedStation}:${storm.key}` : '';
  const payload = loaded?.key === requestKey ? loaded.data : null;
  const loadError = loaded?.key === requestKey ? loaded.error || '' : '';

  useEffect(() => {
    if (!requestKey || !selectedStation) return undefined;
    const controller = new AbortController();
    fetch(`/data/bpnn/${file}`, { signal: controller.signal, cache: 'no-cache' })
      .then(response => {
        if (!response.ok) throw new Error(`曲線資料讀取失敗（${response.status}）`);
        return response.json();
      })
      .then(data => { if (!controller.signal.aborted) setLoaded({ key: requestKey, data }); })
      .catch(error => { if (!controller.signal.aborted) setLoaded({ key: requestKey, error: error.message }); });
    return () => controller.abort();
  }, [file, requestKey, selectedStation]);

  const results = payload?.results || [];
  if (!storm || !selectedStation) return null;

  const normalizedResults = (payload?.results || []).map(result => {
    if (payload.units === 'mm' && result.points[0]?.actual_surge_mm != null) return result;
    if (payload.units === 'm') return {
      ...result,
      metrics: { rmse_mm: result.metrics.rmse_m * 1000, mae_mm: result.metrics.mae_m * 1000, r2: result.metrics.r2, count: result.metrics.count },
      points: result.points.filter(point => point.actual_surge != null && point.predicted_surge != null).map(point => ({
        issued_at: point.issued_at,
        valid_at: point.time,
        actual_surge_mm: point.actual_surge * 1000,
        predicted_surge_mm: point.predicted_surge * 1000,
      })),
    };
    return result;
  });

  return <section aria-labelledby="bpnn-demo-title" style={panel}>
    <h4 id="bpnn-demo-title" style={{ marginTop: 0 }}>{storm.name} · {isLongdong ? '龍洞' : '蘇澳'} BPNN 逐時測試</h4>
    <p>{isLongdong ? '以龍洞逐時潮位和颱風歷史路徑重建 24 小時輸入，再套用匯出的五模型集成權重。' : '以蘇澳逐時資料按同一個 24 小時、192→8→1 BPNN 架構重新訓練五模型集成，整個測試颱風未納入訓練。'} 顯示 +1、+3、+6 小時預測與對應時刻的增水估算。</p>
    {loadError && <p role="alert" style={{ color: '#b91c1c' }}>{loadError}</p>}
    {!results.length && !loadError && <p role="status">正在載入 BPNN 曲線…</p>}
    {normalizedResults.length === 3 && <>
      {normalizedResults.map(result => <LeadForecast key={result.lead_hours} result={result} />)}
      <details style={{ marginTop: 14 }}>
        <summary>模型與資料說明</summary>
        <p>{payload?.validation === 'held-out-event; station-specific retraining, not exported Longdong weights' ? `蘇澳模型以 ${payload.training_events} 個其他颱風事件訓練，保留本次颱風作為獨立測試；訓練窗數：${payload.training_samples}。` : '龍洞使用匯出的五模型集成權重；輸入依可取得的 CWA 小時潮位和 NOAA 路徑歷史重建。'}</p>
        <p>曲線是歷史逐時測試重建，不是即時預報；增水為實測潮位減天文潮，單位 mm。</p>
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
