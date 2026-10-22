import { useEffect, useState } from 'react';
import { canonicalStationId } from '../shared/tideStations.js';
import { landWarningTimes, parseTaiwanTime } from './typhoonWarningTimes.js';
import LongdongBpnnDemo from './LongdongBpnnDemo.jsx';
import StormLstmDemo from './StormLstmDemo.jsx';

const modelEvents = {
  haitang: { match: /haitang|海棠/i, testId: '2005Haitang s', bpnn: 'haitang-predictions.json' },
  talim: { match: /talim|泰利|潭美/i, testId: '2005Talim s', bpnn: 'suao-talim-predictions.json' },
  kaemi: { match: /kaemi|凱米/i, testId: '2006Kaemi s', bpnn: 'suao-kaemi-predictions.json' },
  sinlaku: { match: /sinlaku|辛樂克/i, testId: '2008Sinlaku s', bpnn: 'sinlaku-predictions.json' },
  jangmi: { match: /jangmi|薔蜜|薔薇/i, testId: '2008Jangmi s', bpnn: 'jangmi-predictions.json' },
  'kong-rey': { match: /kong.?rey|康芮/i, testId: '2013KONG-REY s', bpnn: 'suao-kong-rey-predictions.json' },
};

export default function ModelSurgePanel({ stationId, eventName }) {
  const station = canonicalStationId(stationId);
  const storm = String(eventName || '');
  const stormKey = Object.keys(modelEvents).find(key => modelEvents[key].match.test(storm));
  const event = modelEvents[stormKey];
  const longdongStorm = ['haitang', 'jangmi', 'sinlaku'].includes(stormKey);
  const suaoStorm = Boolean(event);
  const available = station === 'C4A02' ? longdongStorm : station === 'C4U01' && suaoStorm;
  const stationKey = station === 'C4A02' ? 'longdong' : 'suao';
  const lstmFile = stationKey === 'suao' && stormKey === 'sinlaku' ? 'suao-sinlaku-legacy.json' : `${stationKey}-retrained.json`;
  const bpnnFile = stationKey === 'suao' && stormKey === 'sinlaku' ? 'suao-sinlaku-predictions.json' : event?.bpnn;
  const requestKey = available ? `${stationKey}:${stormKey}` : '';
  const [loaded, setLoaded] = useState(null);

  useEffect(() => {
    if (!requestKey) return undefined;
    const controller = new AbortController();
    Promise.all([
      fetch(`/data/bpnn/${bpnnFile}`, { signal: controller.signal, cache: 'no-cache' }).then(response => {
        if (!response.ok) throw new Error(`BPNN 資料讀取失敗（${response.status}）`);
        return response.json();
      }),
      fetch(`/data/lstm/${lstmFile}`, { signal: controller.signal, cache: 'no-cache' }).then(response => {
        if (!response.ok) throw new Error(`LSTM 資料讀取失敗（${response.status}）`);
        return response.json();
      }),
    ]).then(([bpnn, lstm]) => {
      if (controller.signal.aborted) return;
      const warningStart = Date.parse(landWarningTimes[stormKey]);
      const testId = stationKey === 'suao' && stormKey === 'sinlaku' ? '200813Sinlaku s' : event.testId;
      const sharedIssueTimes = Object.fromEntries([1, 3, 6].map(lead => {
        const bpnnResult = bpnn.results.find(row => row.lead_hours === lead);
        const lstmResult = lstm.results.find(row => row.lead_hours === lead);
        const bpnnTimes = new Set((bpnnResult?.points || [])
          .filter(point => Number.isFinite(point.observed_tide_cm) && Number.isFinite(point.predicted_tide_cm))
          .map(point => parseTaiwanTime(point.issued_at || new Date(parseTaiwanTime(point.valid_at || point.time) - lead * 3600000).toISOString()))
          .filter(time => Number.isFinite(time) && time >= warningStart));
        const lstmTimes = new Set((lstmResult?.points || [])
          .filter(point => point.event === testId && Number.isFinite(point.observed_tide_cm) && Number.isFinite(point.predicted_tide_cm))
          .map(point => parseTaiwanTime(new Date(parseTaiwanTime(point.time) - lead * 3600000).toISOString()))
          .filter(time => Number.isFinite(time) && time >= warningStart));
        const common = [...bpnnTimes].filter(time => lstmTimes.has(time)).sort((a, b) => a - b);
        return [lead, common];
      }));
      setLoaded({ key: requestKey, bpnn, lstm, sharedIssueTimes });
    }).catch(error => {
      if (!controller.signal.aborted) setLoaded({ key: requestKey, error: error.message });
    });
    return () => controller.abort();
  }, [bpnnFile, event, lstmFile, requestKey, stationKey, stormKey]);

  const data = loaded?.key === requestKey ? loaded : null;
  return <section aria-labelledby="model-tide-title" style={{ borderTop: '3px solid #cbd5e1', padding: 24, borderRadius: 16, background: '#f5f3ff', marginTop: 24 }}>
    <h3 id="model-tide-title" style={{ color: '#6d28d9', fontSize: 24, marginTop: 0 }}>實測與模型預測潮位曲線</h3>
    {available ? <>
      {!data && <p role="status">正在同步 BPNN 與 LSTM 的共同預測時段…</p>}
      {data?.error && <p role="alert">{data.error}</p>}
      {data?.sharedIssueTimes && ![1, 3, 6].some(lead => data.sharedIssueTimes[lead].length) && <p role="status">這組事件與測站沒有兩種模型共同的有效預測時點。</p>}
      {data?.bpnn && <>
        <StormLstmDemo stationId={stationId} eventName={eventName} training={data.lstm} sharedIssueTimes={data.sharedIssueTimes} />
        <LongdongBpnnDemo stationId={stationId} eventName={eventName} payload={data.bpnn} sharedIssueTimes={data.sharedIssueTimes} />
      </>}
    </> : <p role="status">目前沒有此颱風與測站組合的 BPNN 或 CNN-LSTM 潮位預測曲線。</p>}
  </section>;
}
