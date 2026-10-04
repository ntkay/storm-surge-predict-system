import summary from '../shared/longdongBpnnSummary.json';
import { canonicalStationId } from '../shared/tideStations.js';

export default function LongdongBpnnDemo({ stationId }) {
  if (stationId && canonicalStationId(stationId) !== 'C4A02') return <p>龍洞 BPNN 示範僅適用龍洞潮位站；蘇澳尚未提供 BPNN 模型。</p>;
  return <section aria-labelledby="bpnn-demo-title" style={{ background: '#fff', border: '1px solid #c4b5fd', borderRadius: 12, padding: 20, marginBottom: 20 }}>
    <h4 id="bpnn-demo-title" style={{ marginTop: 0 }}>龍洞 BPNN 模型示範</h4>
    <p>已載入 2026/10/04 匯出的模型摘要。使用連續 24 小時、每小時 8 個特徵，架構為 192 → 8（ReLU）→ 1，採 5 次訓練的集成預測。</p>
    <p>下表為匯出包的固定測試結果，與上方選取的颱風期間無關。</p>
    <div style={{ overflowX: 'auto' }}><table style={{ width: '100%', textAlign: 'left', borderCollapse: 'collapse' }}>
      <caption style={{ textAlign: 'left', marginBottom: 10 }}>測試事件：{summary.test_events.join('、')}</caption>
      <thead><tr><th scope="col">預報時距</th><th scope="col">測試樣本數</th><th scope="col">RMSE（cm）</th><th scope="col">MAE（cm）</th><th scope="col">R²</th></tr></thead>
      <tbody>{summary.lead_summaries.map(lead => <tr key={lead.lead_hours}>
        <th scope="row" style={{ padding: '10px 0' }}>+{lead.lead_hours} 小時</th><td>{lead.sample_counts.test}</td><td>{lead.metrics.ensemble.rmse.toFixed(2)}</td><td>{lead.metrics.ensemble.mae.toFixed(2)}</td><td>{lead.metrics.ensemble.r2.toFixed(3)}</td>
      </tr>)}</tbody>
    </table></div>
    <p>輸入順序：{summary.lead_summaries[0].feature_columns.join(' → ')}。模型目標 surgeC_cm 的單位為 cm；接入 MATLAB 接口時須換算為 m。</p>
    <p role="status">模型權重已保存，尚缺事件逐時特徵及推論資料，暫無可顯示的 BPNN 預測曲線。</p>
  </section>;
}
