import { canonicalStationId } from '../shared/tideStations.js';
import { useEffect, useState } from 'react';

const panel = { background: '#fff', border: '1px solid #93c5fd', borderRadius: 12, padding: 20, marginBottom: 20 };
const figures = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 650px), 1fr))', gap: 14 };
const storms = {
  longdong: [
    { key: 'haitang', match: /haitang|海棠/i, name: '海棠（Haitang, 2005）', testId: '2005Haitang s' },
    { key: 'jangmi', match: /jangmi|薔蜜|薔薇/i, name: '薔蜜（Jangmi, 2008）', testId: '2008Jangmi s' },
    { key: 'sinlaku', match: /sinlaku|辛樂克/i, name: '辛樂克（Sinlaku, 2008）', testId: '2008Sinlaku s' },
  ],
  suao: [
    { key: 'talim', match: /talim|潭美/i, name: '潭美（Talim, 2005）', testId: '2005Talim s' },
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
  return <section aria-labelledby="lstm-demo-title" style={panel}>
    <h4 id="lstm-demo-title" style={{ marginTop: 0 }}>{title} · {storm.name} · CNN-LSTM 測試曲線</h4>
    <p>藍線是實測增水，紅色虛線是 CNN-LSTM 預測；訓練使用 CWA 逐時整點潮位、UTide 年度天文潮分離，以及 NOAA IBTrACS 逐時內插颱風路徑。</p>
    {!training && <p>載入 CNN-LSTM 曲線中…</p>}
    <div style={figures}>
      {[1, 3, 6].map((lead, index) => {
        const src = `/data/lstm/${station}-${storm.key}-${lead}h.png`;
        const result = training?.results.find((row) => row.lead_hours === lead);
        const eventPoints = result?.points.filter((point) => point.event === storm.testId) || [];
        const actual = eventPoints.map((point) => point.actual_cm);
        const predicted = eventPoints.map((point) => point.prediction_cm);
        const eventMae = actual.length ? actual.reduce((sum, value, i) => sum + Math.abs(value - predicted[i]), 0) / actual.length : null;
        const eventRmse = actual.length ? Math.sqrt(actual.reduce((sum, value, i) => sum + (value - predicted[i]) ** 2, 0) / actual.length) : null;
        const eventMean = actual.length ? actual.reduce((sum, value) => sum + value, 0) / actual.length : 0;
        const eventDenom = actual.reduce((sum, value) => sum + (value - eventMean) ** 2, 0);
        const eventR2 = eventDenom ? 1 - actual.reduce((sum, value, i) => sum + (predicted[i] - value) ** 2, 0) / eventDenom : null;
        return <figure key={lead} style={{ margin: 0 }}>
          <figcaption style={{ fontWeight: 700, marginBottom: 6 }}>+{lead} 小時 · LSTM {units[index]} 單元{eventRmse !== null ? ` · 本颱風 RMSE ${eventRmse.toFixed(2)} cm / MAE ${eventMae.toFixed(2)} cm / R² ${eventR2?.toFixed(3) ?? '—'}` : ''}</figcaption>
          <a href={src} target="_blank" rel="noreferrer" aria-label={`開啟 ${title} ${storm.name} +${lead} 小時曲線原圖`}>
            <img src={src} alt={`${title} ${storm.name} +${lead} 小時測試集實測與 CNN-LSTM 預測曲線`} style={{ width: '100%', height: 'auto', display: 'block', borderRadius: 8, border: '1px solid #e2e8f0' }} />
          </a>
        </figure>;
      })}
    </div>
    <details style={{ marginTop: 12 }}>
      <summary>模型與資料說明</summary>
      <p>{station === 'suao' && storm.key === 'sinlaku' ? '辛樂克保留原先以該颱風獨立留出所產生的測試曲線。' : '顯示 Notebook 留出測試颱風的歷史逐時結果。'}非即時預報。模型為兩層 Conv1D 接 LSTM，使用 24 小時視窗並分別預測 +1、+3、+6 小時。為在本機 CPU 訓練，batch size 設為 128（原 Notebook 為 8），訓練 100 epochs。</p>
    </details>
  </section>;
}
