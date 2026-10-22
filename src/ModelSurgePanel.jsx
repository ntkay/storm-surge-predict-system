import { canonicalStationId } from '../shared/tideStations.js';
import LongdongBpnnDemo from './LongdongBpnnDemo.jsx';
import StormLstmDemo from './StormLstmDemo.jsx';

export default function ModelSurgePanel({ stationId, eventName }) {
  const station = canonicalStationId(stationId);
  const storm = String(eventName || '');
  const longdongStorm = /haitang|海棠|jangmi|薔蜜|薔薇|sinlaku|辛樂克/i.test(storm);
  const suaoStorm = /haitang|海棠|jangmi|薔蜜|薔薇|sinlaku|辛樂克|talim|泰利|潭美|kaemi|凱米|kong.?rey|康芮/i.test(storm);
  const available = station === 'C4A02' ? longdongStorm : station === 'C4U01' && suaoStorm;
  return <section aria-labelledby="model-tide-title" style={{ borderTop: '3px solid #cbd5e1', padding: 24, borderRadius: 16, background: '#f5f3ff', marginTop: 24 }}>
    <h3 id="model-tide-title" style={{ color: '#6d28d9', fontSize: 24, marginTop: 0 }}>實測與模型預測潮位曲線</h3>
    {available ? <>
      <StormLstmDemo stationId={stationId} eventName={eventName} />
      <LongdongBpnnDemo stationId={stationId} eventName={eventName} />
    </> : <p role="status">目前沒有此颱風與測站組合的 BPNN 或 CNN-LSTM 潮位預測曲線。</p>}
  </section>;
}
