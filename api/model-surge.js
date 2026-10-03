import { canonicalStationId, surgeStations } from '../shared/tideStations.js';

// Replace only this adapter when MATLAB exports become available.
// Return rows {station, time (ISO with timezone), predicted_surge (metres)}.
export async function loadModelRows() { return []; }

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ success: false, message: 'Method Not Allowed' });
  }
  const params = new URL(req.url || '/', 'http://localhost').searchParams;
  const get = key => req.query?.[key] ?? params.get(key);
  const station = canonicalStationId(get('station'));
  const start = get('start'), end = get('end');
  const iso = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/i;
  const from = Date.parse(start), to = Date.parse(end);
  if (!surgeStations.some(s => s.stationId === station) || !iso.test(start) || !iso.test(end) || !Number.isFinite(from) || !Number.isFinite(to) || to <= from || to-from > 120*86400000) {
    return res.status(400).json({ success: false, message: '請提供龍洞／蘇澳站碼及含時區的有效 start/end（最長 120 天）。' });
  }
  try {
    const rows = await loadModelRows({ station, start, end });
    if (!Array.isArray(rows)) throw Error('MATLAB adapter must return an array');
    const points = rows.filter(row => canonicalStationId(row.station) === station && typeof row.time === 'string' && iso.test(row.time) && Number.isFinite(Date.parse(row.time)) && Date.parse(row.time) >= from && Date.parse(row.time) <= to && typeof row.predicted_surge === 'number' && Number.isFinite(row.predicted_surge))
      .map(row => ({ station, time: new Date(row.time).toISOString(), predicted_surge: row.predicted_surge })).sort((a,b) => Date.parse(a.time)-Date.parse(b.time));
    return res.status(200).json({ success: true, source: 'MATLAB', units: 'm', status: points.length ? 'available' : 'unavailable', message: points.length ? 'MATLAB 模型預測結果' : '尚未接入 MATLAB 預測資料', requested: { station, start, end }, points });
  } catch {
    return res.status(502).json({ success: false, message: 'MATLAB 預測資料讀取失敗' });
  }
}
