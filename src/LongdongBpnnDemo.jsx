import { useState } from 'react';
import { canonicalStationId } from '../shared/tideStations.js';

const leadResults = [
  { lead: 1, rmse: '8.19', mae: '6.17', r2: '0.724' },
  { lead: 3, rmse: '15.31', mae: '12.40', r2: '0.052' },
  { lead: 6, rmse: '22.56', mae: '19.54', r2: '-0.997' },
];
const cell = { padding: 10, borderBottom: '1px solid #e2e8f0' };
export default function LongdongBpnnDemo({ stationId, eventName }) {
  const [leadHours, setLeadHours] = useState(6);
  if (stationId && canonicalStationId(stationId) !== 'C4A02') return null;
  const event = String(eventName || '').toLowerCase();
  if (event.includes('sinlaku') || event.includes('辛樂克')) return <section aria-labelledby="bpnn-demo-title" style={{ background: '#fff', border: '1px solid #c4b5fd', borderRadius: 12, padding: 20, marginBottom: 20 }}>
    <h4 id="bpnn-demo-title" style={{ marginTop: 0 }}>2008 辛樂克（Sinlaku）· 龍洞 BPNN</h4>
    <p>測試事件 200813 · 24 小時滑動視窗。實測與 BPNN 預測曲線及測試指標如下。</p>
    <figure style={{ margin: '20px 0' }}>
      <figcaption style={{ fontWeight: 700, marginBottom: 10 }}>辛樂克 +1、+3、+6 小時預測曲線</figcaption>
      <p>藍色實線：實測；橘色虛線：BPNN 預測。縱軸為暴潮增水（cm）。</p>
      <a href="/data/bpnn/longdong-sinlaku-leads.jpg" target="_blank" rel="noreferrer" aria-label="開啟辛樂克 BPNN 三種預報時距曲線原圖">
        <img src="/data/bpnn/longdong-sinlaku-leads.jpg" alt="辛樂克（200813）龍洞 BPNN +1、+3、+6 小時的實測與預測曲線" style={{ display: 'block', width: '100%', height: 'auto', border: '1px solid #e2e8f0', borderRadius: 8 }} />
      </a>
      <p style={{ color: '#475569' }}>來源：提供的 sinlaku.jpg，點圖可開啟原尺寸。</p>
    </figure>
    <label style={{ display: 'block', margin: '16px 0' }}>查看時距
      <select value={leadHours} onChange={e => setLeadHours(Number(e.target.value))} style={{ marginLeft: 12, padding: 8, borderRadius: 8, border: '1px solid #c4b5fd', background: '#fff' }}>
        {leadResults.map(result => <option key={result.lead} value={result.lead}>+{result.lead} 小時</option>)}
      </select>
    </label>
    <div style={{ overflowX: 'auto' }}><table style={{ width: '100%', textAlign: 'left', borderCollapse: 'collapse', whiteSpace: 'nowrap' }}>
      <caption style={{ textAlign: 'left', fontWeight: 700, marginBottom: 10 }}>辛樂克測試指標</caption>
      <thead><tr>{['預報時距', 'RMSE（cm）', 'MAE（cm）', 'R²'].map(label => <th key={label} scope="col" style={cell}>{label}</th>)}</tr></thead>
      <tbody>{leadResults.map(result => <tr key={result.lead} style={{ background: result.lead === leadHours ? '#f5f3ff' : '#fff' }}><th scope="row" style={cell}>+{result.lead} 小時</th>{[result.rmse, result.mae, result.r2].map((value, index) => <td key={index} style={cell}>{value}</td>)}</tr>)}</tbody>
    </table></div>
  </section>;
  if (event.includes('haitang') || event.includes('海棠')) return <HaitangDemo leadHours={leadHours} setLeadHours={setLeadHours} />;
  return null;
}

function HaitangDemo({ leadHours, setLeadHours }) {
  const leads = [1, 3, 6];
  const cell = { padding: 10, borderBottom: '1px solid #e2e8f0' };
  return <section aria-labelledby="bpnn-demo-title" style={{ background: '#fff', border: '1px solid #c4b5fd', borderRadius: 12, padding: 20, marginBottom: 20 }}>
    <h4 id="bpnn-demo-title" style={{ marginTop: 0 }}>2005 海棠（Haitang）· 龍洞 BPNN</h4>
    <p>測試事件 200505 · 24 小時滑動視窗。此區固定顯示海棠的測試示範。</p>
    <label style={{ display: 'block', margin: '16px 0' }}>預報時距
      <select value={leadHours} onChange={event => setLeadHours(Number(event.target.value))} style={{ marginLeft: 12, padding: 8, borderRadius: 8, border: '1px solid #c4b5fd', background: '#fff' }}>
        {leads.map(lead => <option key={lead} value={lead}>+{lead} 小時</option>)}
      </select>
    </label>
    {leadHours === 6 ? <figure style={{ margin: '20px 0' }}>
      <figcaption style={{ fontWeight: 700, marginBottom: 10 }}>海棠 +6 小時：實測與 BPNN 預測曲線</figcaption>
      <p>藍色實線：實測；紅色虛線：BPNN 預測。縱軸為暴潮增水（mm）。</p>
      <div style={{ overflowX: 'auto' }}><div style={{ minWidth: 760, aspectRatio: '1900 / 540', overflow: 'hidden', border: '1px solid #e2e8f0', borderRadius: 8 }}><img src="/data/bpnn/longdong-lead6h.jpg" alt="海棠（200505）龍洞 +6 小時實測與預測曲線" style={{ display: 'block', width: '100%', height: 'auto' }} /></div></div>
    </figure> : <p role="status">海棠 +{leadHours} 小時曲線資料待補。</p>}
    <table style={{ width: '100%', textAlign: 'left', borderCollapse: 'collapse', whiteSpace: 'nowrap' }}><caption style={{ textAlign: 'left', fontWeight: 700, marginBottom: 10 }}>海棠測試結果（依提供的曲線圖）</caption><thead><tr>{['預報時距', 'RMSE（mm）', 'R²', 'R'].map(label => <th key={label} style={cell}>{label}</th>)}</tr></thead><tbody>{leads.map(lead => <tr key={lead}><th style={cell}>+{lead} 小時</th>{(lead === 6 ? ['261.57', '0.42', '0.72'] : ['待提供', '待提供', '待提供']).map((value, index) => <td key={index} style={cell}>{value}</td>)}</tr>)}</tbody></table>
    <p>MATLAB 預測接口保留。</p>
  </section>;
}
