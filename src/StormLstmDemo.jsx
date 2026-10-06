import { canonicalStationId } from '../shared/tideStations.js';

const panel = { background: '#fff', border: '1px solid #93c5fd', borderRadius: 12, padding: 20, marginBottom: 20 };
const figures = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 650px), 1fr))', gap: 14 };
const storms = {
  longdong: [
    { key: 'haitang', match: /haitang|海棠/i, name: '海棠（Haitang, 2005）' },
    { key: 'sinlaku', match: /sinlaku|辛樂克/i, name: '辛樂克（Sinlaku, 2008）' },
    { key: 'jangmi', match: /jangmi|薔蜜|薔密/i, name: '薔蜜（Jangmi, 2008）' },
  ],
  suao: [
    { key: 'talim', match: /talim|潭美/i, name: '潭美（Talim, 2005）' },
    { key: 'kaemi', match: /kaemi|凱米/i, name: '凱米（Kaemi, 2006）' },
    { key: 'kong-rey', match: /kong.?rey|康芮/i, name: '康芮（Kong-rey, 2013）' },
  ],
};

export default function StormLstmDemo({ stationId, eventName }) {
  const canonicalId = canonicalStationId(stationId);
  const station = canonicalId === 'C4A02' ? 'longdong' : canonicalId === 'C4U01' ? 'suao' : '';
  const storm = storms[station]?.find((item) => item.match.test(String(eventName || '')));
  if (!storm) return null;

  const title = station === 'longdong' ? '龍洞' : '蘇澳';
  const units = station === 'longdong' ? [16, 16, 32] : [32, 32, 64];
  return <section aria-labelledby="lstm-demo-title" style={panel}>
    <h4 id="lstm-demo-title" style={{ marginTop: 0 }}>{title} · {storm.name} · 2CNN-LSTM 測試曲線</h4>
    <p>以下 +1、+3、+6 小時曲線取自你提供的 Notebook 已執行測試輸出，藍線是實測增水、橘色虛線是模型預測；每張圖標有該測試事件的 RMSE、MAE 與 R²。</p>
    <div style={figures}>
      {[1, 3, 6].map((lead, index) => {
        const src = `/data/lstm/${station}-${storm.key}-${lead}h.png`;
        return <figure key={lead} style={{ margin: 0 }}>
          <figcaption style={{ fontWeight: 700, marginBottom: 6 }}>+{lead} 小時 · LSTM {units[index]} 單元</figcaption>
          <a href={src} target="_blank" rel="noreferrer" aria-label={`開啟 ${title} ${storm.name} +${lead} 小時曲線原圖`}>
            <img src={src} alt={`${title} ${storm.name} +${lead} 小時測試集實測與 2CNN-LSTM 預測曲線`} style={{ width: '100%', height: 'auto', display: 'block', borderRadius: 8, border: '1px solid #e2e8f0' }} />
          </a>
        </figure>;
      })}
    </div>
    <details style={{ marginTop: 12 }}>
      <summary>模型與資料說明</summary>
      <p>模型為兩層 Conv1D 接 LSTM，使用 24 小時輸入視窗並預測指定提前時間。此處是 Notebook 測試集已輸出的歷史評估曲線，不是即時預報；ZIP 內只有 Notebook，沒有另附可部署的模型權重或逐時預測表，因此目前無法對其他颱風重新推論。</p>
    </details>
  </section>;
}
