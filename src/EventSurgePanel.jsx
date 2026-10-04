import { useEffect, useMemo, useState } from 'react';

import ModelSurgePanel from './ModelSurgePanel.jsx';
import { surgeStations } from '../shared/tideStations.js';
import { recentTyphoons, trackTime, latestTrackTime } from './eventCatalog.js';
const series = [
  { key: 'observedTide', label: '實測潮位', color: '#0369a1' },
  { key: 'predictedTide', label: '天文潮', color: '#7c3aed' },
  { key: 'surgeAnomaly', label: '暴潮增水', color: '#c2410c' },
];
const box = { background: '#fff', padding: 24, borderRadius: 24, marginBottom: 28, boxShadow: '0 8px 24px #0f172a14' };
const grid = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(210px,1fr))', gap: 16 };
const control = { display: 'block', boxSizing: 'border-box', width: '100%', marginTop: 8, padding: 12, border: '1px solid #cbd5e1', borderRadius: 10, background: '#fff' };
const note = { padding: 14, background: '#f1f5f9', borderRadius: 12, lineHeight: 1.8, marginTop: 16 };
const cell = { padding: 10, textAlign: 'left', whiteSpace: 'nowrap', borderBottom: '1px solid #e2e8f0' };
const hasNumber = (value) => typeof value === 'number' && Number.isFinite(value);
const number = (value) => hasNumber(value) ? `${value > 0 ? '+' : ''}${value.toFixed(3)} m` : '—';
const date = (value) => value ? new Intl.DateTimeFormat('zh-TW', { timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(value)) : '—';
const range = (value) => value ? `${date(value.start)} ～ ${date(value.end)}（${value.count} 筆）` : '無可用資料／來源未取得';

function eventWindow(typhoon, extend) {
  if (!typhoon) return null;
  const times = (typhoon.track || []).map((p) => trackTime(p.time, typhoon.source)).filter(Number.isFinite).sort((a,b) => a-b);
  if (!times.length) return null;
  return { start: new Date(times[0] - extend * 86400000).toISOString(), end: new Date(times.at(-1) + extend * 86400000).toISOString() };
}

export default function EventSurgePanel({ typhoons, historyLoading, historyError, catalogStatus }) {
  const [year, setYear] = useState('');
  const [sid, setSid] = useState('');
  const [stationId, setStationId] = useState('');
  const [extend, setExtend] = useState(true);
  const catalog = surgeStations;
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [retry, setRetry] = useState(0);
  const events = useMemo(() => {
    const recent = recentTyphoons(typhoons);
    const sinlaku = typhoons.find((t) => Number(t.year) === 2008 && String(t.name || '').toLowerCase() === 'sinlaku');
    return sinlaku && !recent.some((t) => t.sid === sinlaku.sid)
      ? [...recent, { ...sinlaku, nameZh: '辛樂克' }].sort((a,b) => latestTrackTime(b)-latestTrackTime(a))
      : recent;
  }, [typhoons]);
  const years = [...new Set(events.map((t) => String(t.year)))];
  const choices = events.filter((t) => !year || String(t.year) === year);
  const selected = events.find((t) => t.sid === sid);
  const window = eventWindow(selected, extend ? 1 : 0);
  const start = window?.start, end = window?.end;
  const key = start && end && stationId ? `${sid}|${start}|${end}|${stationId}|${retry}` : '';
  // Tag responses with their request: stale results never appear under a new event.
  const data = result?.key === key ? result.data : null;

  useEffect(() => {
    if (!key) return;
    const controller = new AbortController();
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError('');
      try {
        const params = new URLSearchParams({ start, end, station: stationId });
        const response = await fetch(`/api/surge?${params}`, { signal: controller.signal, cache: 'no-store' });
        if (!(response.headers.get('content-type') || '').includes('application/json')) throw Error('潮位 API 尚未就緒：回傳內容不是 JSON。');
        const payload = await response.json();
        if (!response.ok || !payload.success) throw Error(payload.message || `潮位資料 HTTP ${response.status}`);
        if (payload.mode !== 'typhoon-event') throw Error('潮位 API 仍是舊版，請一併部署 api/surge.js。');
        if (cancelled) return;
        setResult({ key, data: payload });

      } catch (err) {
        if (!cancelled) { setResult(null); setError(err.message); }
      } finally { if (!cancelled) setLoading(false); }
    }
    load();
    return () => { cancelled = true; controller.abort(); };
  }, [key, start, end, stationId]);

  const points = data?.station?.history || [];
  const paired = points.filter((p) => hasNumber(p.surgeAnomaly));
  const latest = paired.at(-1) || points.filter((p) => hasNumber(p.observedTide)).at(-1) || points.at(-1);
  function clear() { setResult(null); setError(''); setLoading(false); }
  return <section style={box} aria-labelledby="event-surge-title">
    <h2 id="event-surge-title" style={{ color: '#123c66', marginTop: 0 }}>🌊 颱風潮位與暴潮預測</h2>
    <section aria-labelledby="tide-section-title" style={{ padding: '20px 0' }}>
    <h3 id="tide-section-title" style={{ color: '#0369a1', fontSize: 24 }}>颱風潮位</h3>
    <p>先選歷史颱風，再選潮位站，查看該事件期間的實測潮位、天文潮與暴潮增水。所有顯示時間為臺灣時間（UTC+8）。</p>
    {historyLoading && <p role="status">歷史颱風清單讀取中…</p>}
    {historyError && <p role="alert">{historyError}</p>}
    {!historyLoading && !historyError && !events.length && <p>歷史颱風清單沒有資料，請確認 public/data/typhoons.json。</p>}
    <p>僅列含今年在內近 10 年，按路徑時間由新到舊排列。清單最新路徑時間：{events.length ? date(new Date(latestTrackTime(events[0])).toISOString()) : "—"}。僅顯示來源已收錄路徑，不代表完整涵蓋今天。</p>
    <p role="status">{catalogStatus}</p>
    <div style={grid}>
      <label>年份<select style={control} value={year} onChange={(e) => {setYear(e.target.value);setSid('');setStationId('');clear();}}>
        <option value="">近 10 年全部年份</option>{years.map((y) => <option key={y}>{y}</option>)}
      </select></label>
      <label>1. 選擇颱風<select style={control} value={sid} disabled={historyLoading || !events.length} onChange={(e) => {setSid(e.target.value);setStationId('');clear();}}>
        <option value="">請選擇颱風</option>{choices.map((t) => <option key={t.sid} value={t.sid}>{t.year} · {t.nameZh || t.name || '未命名'} · {date(new Date(latestTrackTime(t)).toISOString())}</option>)}
      </select></label>
      <label>2. 選擇潮位站<select style={control} value={stationId} disabled={!window} onChange={(e) => {setStationId(e.target.value);clear();}}>
        <option value="">請選擇潮位站</option>{catalog.map((s) => <option key={s.stationId} value={s.stationId}>{s.stationName}</option>)}
      </select></label>
    </div>
    <p><label><input type="checkbox" checked={extend} onChange={(e) => {setExtend(e.target.checked);clear();}} /> 路徑起訖時間前後各延伸 24 小時</label></p>
    {sid && !window && <p role="alert">此颱風沒有有效路徑時間，無法建立事件期間。</p>}
    {window && <p><strong>事件資料期間：</strong>{date(start)} ～ {date(end)}</p>}
    <div style={note}>歷史路徑有資料，不代表潮位來源也涵蓋同一年代。目前採用來源已發布資料的事件交集；未連接歷史潮位庫時，舊颱風可能完全沒有潮位資料。可至 <a href="https://ocean.cwa.gov.tw/V2/data_interface/datasets" target="_blank" rel="noreferrer">中央氣象署海象資料下載</a> 取得歷史觀測，並另備同期間、同基準的天文潮資料。</div>
    {key && loading && <p role="status">正在查詢所選事件與測站…</p>}
    {key && error && <p role="alert" style={{ color: '#b91c1c' }}>{error}</p>}
    {key && <button type="button" style={{ ...control, width: 'auto' }} disabled={loading} onClick={() => {clear();setRetry((n) => n+1);}}>重新查詢此事件</button>}
    {data && <>
      <div style={note}>
        <strong>{data.station.stationName} · {data.station.datumLabel} · 單位：m</strong><br />
        來源實測可用期間：{range(data.availability.observation)}<br />
        來源天文潮可用期間：{range(data.availability.astronomicalTide)}<br />
        可配對資料期間：{range(data.availability.paired)}<br />
        本事件：實測 {data.counts.observed} 筆／天文潮 {data.counts.astronomical} 筆／配對 {data.counts.paired} 筆。首末時間不代表連續完整涵蓋。
      </div>
      <p role="status">{data.status === 'unavailable' ? '所選事件期間無可用潮位資料；不顯示近期潮位替代。' : data.status === 'unpaired' ? '此期間只有部分數列，缺少同時間配對資料，無法計算暴潮增水。' : '顯示事件時間窗內可取得的資料；請留意缺測與來源涵蓋期間。'}</p>
      {data.warnings.map((warning) => <p key={warning} role="alert">{warning}</p>)}
      <p>指標時間：{date(latest?.time)}（{paired.length ? '事件內最後一筆配對資料' : '事件內可用資料；未配對欄位留空'}）</p>
      <div style={grid}>{series.map((s) => <div key={s.key} style={note}><div>{s.label}</div><strong style={{ color: s.color, fontSize: 28 }}>{number(latest?.[s.key])}</strong></div>)}</div>
      <EventChart points={points} start={start} end={end} />
      <p style={{ lineHeight: 1.8 }}>{data.definition}<br />{data.method}</p>
      <details><summary>檢視事件資料表（{points.length} 個時刻）</summary>
        <div style={{ overflow: 'auto', maxHeight: 420 }}><table style={{ borderCollapse: 'collapse', width: '100%' }}>
          <thead><tr>{['臺灣時間', '實測潮位 (m)', '天文潮 (m)', '暴潮增水 (m)', '天文潮配對'].map((s) => <th style={cell} key={s}>{s}</th>)}</tr></thead>
          <tbody>{points.map((p) => <tr key={p.time}><td style={cell}>{date(p.time)}</td>{series.map((s) => <td style={cell} key={s.key}>{number(p[s.key])}</td>)}<td style={cell}>{p.forecastMethod === 'linearInterpolation' ? '線性內插' : p.forecastMethod === 'exact' ? '原始時刻' : '無配對'}</td></tr>)}</tbody>
        </table></div>
      </details>
    </>}
    </section>
    <section aria-labelledby="model-section-title" style={{ borderTop: '3px solid #cbd5e1', padding: 24, borderRadius: 16, background: '#f5f3ff', marginTop: 24 }}>
      <h3 id="model-section-title" style={{ color: '#6d28d9', fontSize: 24, marginTop: 0 }}>暴潮預測</h3>
      <ModelSurgePanel stationId={stationId} start={start} end={end} eventName={selected?.nameZh || selected?.name} />
    </section>
  </section>;
}

function EventChart({ points, start, end }) {
  const values = points.flatMap((p) => series.map((s) => p[s.key])).filter(hasNumber);
  const min = Math.min(0, ...values), max = Math.max(0, ...values);
  const pad = Math.max((max-min)*0.1,0.1), low = min-pad, high = max+pad;
  const t0 = Date.parse(start), t1 = Date.parse(end);
  const x = (time) => 75 + (Date.parse(time)-t0)/Math.max(t1-t0,1)*800;
  const y = (value) => 265 - (value-low)/(high-low)*230;
  return <div style={{ ...note, background: '#f8fbff' }}>
    <h3>事件期間潮位曲線</h3>
    <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap' }}>{series.map((s,i) => <span key={s.key} style={{ color: s.color }}><strong>{['━━','┄┄','····'][i]} {s.label}</strong>（m）</span>)}</div>
    {!values.length ? <p>此事件沒有可繪製資料。</p> : <div style={{ overflowX: 'auto' }}>
      <svg viewBox="0 0 960 340" style={{ width: '100%', minWidth: 650 }} role="img" aria-label="實測潮位、天文潮與暴潮增水；橫軸臺灣時間，縱軸公尺">
        <text x="10" y="18" fontSize="13">潮位 (m)</text>
        {[0,1,2,3,4].map((i) => { const v=low+(high-low)*i/4;return <g key={i}><line x1="75" x2="875" y1={y(v)} y2={y(v)} stroke="#cbd5e1" /><text x="65" y={y(v)+4} textAnchor="end" fontSize="12">{v.toFixed(2)}</text></g>; })}
        <line x1="75" x2="875" y1={y(0)} y2={y(0)} stroke="#64748b" strokeDasharray="3 4" />
        {[0,1,2,3,4].map((i) => {const time=new Date(t0+(t1-t0)*i/4).toISOString();return <text key={i} x={x(time)} y="290" textAnchor="middle" fontSize="11">{date(time)}</text>;})}
        <text x="475" y="325" textAnchor="middle" fontSize="13">事件時間（UTC+8）；超過 2 小時的資料間隔斷線</text>
        {series.map((s,index) => {
          const valid = points.filter((p) => hasNumber(p[s.key]));
          let previous = null;
          const path = valid.map((p) => {
            const gap = previous == null || Date.parse(p.time)-Date.parse(previous.time)>7200000;
            previous=p;
            return `${gap ? 'M' : 'L'}${x(p.time)},${y(p[s.key])}`;
          }).join(' ');
          return <g key={s.key}><path d={path} fill="none" stroke={s.color} strokeWidth="2.5" strokeDasharray={['','8 4','3 4'][index]} />{valid.map((p) => <circle key={p.time} cx={x(p.time)} cy={y(p[s.key])} r="2.5" fill={s.color}><title>{date(p.time)} · {s.label} {number(p[s.key])}</title></circle>)}</g>;
        })}
      </svg>
    </div>}
  </div>;
}
