import summary from '../shared/longdongBpnnSummary.json';
import { canonicalStationId } from '../shared/tideStations.js';

const leads = summary.lead_summaries;
const plot = { left: 52, right: 550, top: 38, bottom: 230 };
const x = index => 135 + index * 165;
function MetricChart({ score = false }) {
  const maximum = score ? 1 : Math.ceil(Math.max(...leads.map(lead => lead.metrics.ensemble.rmse)) / 10) * 10;
  const y = value => plot.bottom - value / maximum * (plot.bottom - plot.top);
  const metrics = score ? [{ key: 'r2', label: 'R²', color: '#7c3aed' }] : [
    { key: 'rmse', label: 'RMSE', color: '#0284c7' },
    { key: 'mae', label: 'MAE', color: '#ea580c' },
  ];
  const title = score ? '模型擬合程度（R²）' : '預測誤差（cm）';
  return <figure style={{ margin: 0, minWidth: 0 }}>
    <figcaption style={{ fontWeight: 700, marginBottom: 8 }}>{title}</figcaption>
    <svg viewBox="0 0 600 305" role="img" aria-label={`${title}：${leads.map(lead => `加 ${lead.lead_hours} 小時，${metrics.map(metric => `${metric.label} ${lead.metrics.ensemble[metric.key].toFixed(score ? 3 : 2)}`).join('，')}`).join('；')}`} style={{ width: '100%', display: 'block', fontFamily: 'inherit' }}>
      {Array.from({ length: 6 }, (_, index) => maximum * index / 5).map(value => <g key={value}>
        <line x1={plot.left} x2={plot.right} y1={y(value)} y2={y(value)} stroke="#e2e8f0" />
        <text x={plot.left - 10} y={y(value) + 4} textAnchor="end" fontSize="12" fill="#475569">{score ? value.toFixed(1) : value}</text>
      </g>)}
      {leads.map((lead, index) => <g key={lead.lead_hours}>
        {metrics.map((metric, metricIndex) => {
          const value = lead.metrics.ensemble[metric.key];
          const center = x(index) + (score ? 0 : metricIndex === 0 ? -24 : 24);
          return <g key={metric.key}>
            <rect x={center - 18} y={y(value)} width="36" height={plot.bottom - y(value)} rx="4" fill={metric.color}><title>+{lead.lead_hours} 小時 · {metric.label}：{value.toFixed(score ? 3 : 2)}{score ? '' : ' cm'}</title></rect>
            <text x={center} y={y(value) - 8} textAnchor="middle" fontSize="13" fill={metric.color}>{value.toFixed(score ? 3 : 2)}</text>
          </g>;
        })}
        <text x={x(index)} y="252" textAnchor="middle" fontSize="14" fill="#334155">+{lead.lead_hours} 小時</text>
        <text x={x(index)} y="271" textAnchor="middle" fontSize="12" fill="#64748b">n = {lead.sample_counts.test}</text>
      </g>)}
      {metrics.map((metric, index) => <g key={metric.key} transform={`translate(${220 + index * 100}, 290)`}>
        <rect width="12" height="12" rx="2" fill={metric.color} /><text x="18" y="11" fontSize="12" fill="#334155">{metric.label}</text>
      </g>)}
    </svg>
  </figure>;
}

export default function LongdongBpnnDemo({ stationId }) {
  if (stationId && canonicalStationId(stationId) !== 'C4A02') return <p>龍洞 BPNN 示範僅適用龍洞潮位站；蘇澳尚未提供 BPNN 模型。</p>;
  return <section aria-labelledby="bpnn-demo-title" style={{ background: '#fff', border: '1px solid #c4b5fd', borderRadius: 12, padding: 20, marginBottom: 20 }}>
    <h4 id="bpnn-demo-title" style={{ marginTop: 0 }}>龍洞 BPNN 模型示範</h4>
    <p>已載入 2026/10/04 匯出的模型摘要。使用連續 24 小時、每小時 8 個特徵，架構為 192 → 8（ReLU）→ 1，採 5 次訓練的集成預測。</p>
    <p>下方圖表為匯出包的固定測試結果，與上方選取的颱風期間無關。測試事件：{summary.test_events.join('、')}。</p>
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 360px), 1fr))', gap: 24 }}>
      <MetricChart /><MetricChart score />
    </div>
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
    <p role="status">模型權重已保存，尚缺事件逐時特徵及推論資料，暫無可顯示的 BPNN 預測曲線。</p>
  </section>;
}
