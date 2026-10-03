import { useEffect, useState } from 'react';
import { surgeStations } from '../shared/tideStations.js';

const date = time => new Intl.DateTimeFormat('zh-TW', { timeZone: 'Asia/Taipei', dateStyle: 'short', timeStyle: 'short' }).format(new Date(time));
export default function ModelSurgePanel({ stationId, start, end, eventName }) {
  const [result, setResult] = useState(null);
  const key = stationId && start && end ? `${stationId}|${start}|${end}` : '';
  const current = result?.key === key ? result : null;
  useEffect(() => {
    if (!key) return;
    const controller = new AbortController();
    async function load() {
      try {
        const response = await fetch(`/api/model-surge?${new URLSearchParams({ station: stationId, start, end })}`, { signal: controller.signal, cache: 'no-store' });
        if (!(response.headers.get('content-type') || '').includes('application/json')) throw Error('預測 API 尚未就緒，請部署 api/model-surge.js。');
        const payload = await response.json();
        if (!response.ok || !payload.success) throw Error(payload.message || '預測資料讀取失敗');
        if (payload.source !== 'MATLAB' || !Array.isArray(payload.points)) throw Error('預測資料格式不符。');
        if (!controller.signal.aborted) setResult({ key, payload });
      } catch (error) {
        if (!controller.signal.aborted) setResult({ key, error: error.message });
      }
    }
    load();
    return () => controller.abort();
  }, [key, stationId, start, end]);
  const points = current?.payload?.points || [];
  return <>
    <p>MATLAB 模型預測的暴潮增水，與上方實測潮位減天文潮所得的暴潮增水分開呈現。</p>
    <p>使用上方所選颱風、潮位站及事件期間。</p>
    {key && <p>{eventName} · {surgeStations.find(s => s.stationId === stationId)?.stationName}<br />{date(start)} ～ {date(end)}</p>}
    {!key && <p role="status">尚未接入 MATLAB 預測資料。請先於颱風潮位區選擇颱風與潮位站。</p>}
    {key && !current && <p role="status">正在查詢 MATLAB 預測資料…</p>}
    {current?.error && <p role="alert">{current.error}</p>}
    {current?.payload && !points.length && <div role="status" style={{ border: '1px dashed #a78bfa', borderRadius: 12, padding: 24, background: '#fff' }}><strong>尚未接入 MATLAB 預測資料</strong><p>此區不以 CWA 實測暴潮偏差代替模型預測。</p></div>}
    {!!points.length && <div style={{ overflowX: 'auto' }}><p>MATLAB 預測暴潮增水 · 單位 m · 臺灣時間</p><table style={{ width: '100%', textAlign: 'left' }}><thead><tr><th>潮位站</th><th>時間</th><th>預測暴潮增水 (m)</th></tr></thead><tbody>{points.map((p,i) => <tr key={`${p.time}-${i}`}><td>{surgeStations.find(s => s.stationId === p.station)?.stationName}</td><td>{date(p.time)}</td><td>{p.predicted_surge.toFixed(3)}</td></tr>)}</tbody></table></div>}
  </>;
}
