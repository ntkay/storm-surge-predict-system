import summary from '../shared/longdongBpnnSummary.json';
import { canonicalStationId } from '../shared/tideStations.js';

const leads = summary.lead_summaries;
export default function LongdongBpnnDemo({ stationId }) {
  if (stationId && canonicalStationId(stationId) !== 'C4A02') return <p>龍洞 BPNN 示範僅適用龍洞潮位站；蘇澳尚未提供 BPNN 模型。</p>;
  return <section aria-labelledby="bpnn-demo-title" style={{ background: '#fff', border: '1px solid #c4b5fd', borderRadius: 12, padding: 20, marginBottom: 20 }}>
    <h4 id="bpnn-demo-title" style={{ marginTop: 0 }}>龍洞 BPNN 模型示範</h4>
    <p>已載入 2026/10/04 匯出的模型摘要。使用連續 24 小時、每小時 8 個特徵，架構為 192 → 8（ReLU）→ 1，採 5 次訓練的集成預測。</p>
    <figure style={{ margin: '20px 0' }}>
      <figcaption style={{ fontWeight: 700, marginBottom: 10 }}>龍洞 +6 小時：實測與 BPNN 預測時間序列</figcaption>
      <p>藍色實線為實測，紅色虛線為 BPNN 預測；橫軸為時間，縱軸為暴潮增水（mm）。三個測試事件為海棠、辛樂克與薔蜜。</p>
      <a href="/data/bpnn/longdong-lead6h.jpg" target="_blank" rel="noreferrer" aria-label="開啟龍洞 BPNN +6 小時曲線原圖">
        <img src="/data/bpnn/longdong-lead6h.jpg" alt="龍洞 BPNN 24 小時滑動視窗、+6 小時預報，海棠（200505）、辛樂克（200813）、薔蜜（200815）的實測與預測暴潮增水時間序列" style={{ display: 'block', width: '100%', height: 'auto', border: '1px solid #e2e8f0', borderRadius: 8 }} />
      </a>
      <p style={{ color: '#475569' }}>來源：提供的 BPNN 6.jpg，點圖可開啟原尺寸。此圖為固定測試示範，不隨上方颱風選項更新。圖中的各事件指標與下表的匯出包集成統計分別呈現。</p>
    </figure>
    <p>下表為匯出包的固定集成測試結果，單位 cm；測試事件：{summary.test_events.join('、')}。</p>
    <div style={{ overflowX: 'auto', marginTop: 20 }}>
      <table style={{ width: '100%', textAlign: 'left', borderCollapse: 'collapse', whiteSpace: 'nowrap' }}>
        <caption style={{ textAlign: 'left', fontWeight: 700, marginBottom: 10 }}>BPNN 集成測試結果明細</caption>
        <thead><tr>{['預報時距', '測試樣本數', 'RMSE（cm）', 'MAE（cm）', 'R²'].map(label => <th key={label} scope="col" style={{ padding: 10, borderBottom: '2px solid #c4b5fd' }}>{label}</th>)}</tr></thead>
        <tbody>{leads.map(lead => <tr key={lead.lead_hours}>
          <th scope="row" style={{ padding: 10, borderBottom: '1px solid #e2e8f0' }}>+{lead.lead_hours} 小時</th>
          {[lead.sample_counts.test, lead.metrics.ensemble.rmse.toFixed(2), lead.metrics.ensemble.mae.toFixed(2), lead.metrics.ensemble.r2.toFixed(3)].map((value, index) => <td key={index} style={{ padding: 10, borderBottom: '1px solid #e2e8f0' }}>{value}</td>)}
        </tr>)}</tbody>
      </table>
    </div>
    <p>輸入順序：{summary.lead_summaries[0].feature_columns.join(' → ')}。模型目標 surgeC_cm 的單位為 cm；接入 MATLAB 接口時須換算為 m。</p>
    <p role="status">目前顯示提供的測試曲線圖片；尚缺事件逐時特徵及推論資料，選取事件的預測仍待接入 MATLAB 接口。</p>
  </section>;
}
