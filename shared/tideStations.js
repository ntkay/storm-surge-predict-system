// CWA tide-station table (2025-06-28). Includes discontinued historical gauges.
// https://oceanapi.cwa.gov.tw/restapi/v2/static/station/station_info.html
const rows = [
  ['C4A01','1102','淡水'], ['C4A02','1226','龍洞'], ['C4A03','1206','麟山鼻'],
  ['C4A04','1306','臺北港'], ['C4A05','1826','福隆'], ['C4A06','11006','淡海'],
  ['C4B01','1516','基隆'], ['C4B02','1315','彭佳嶼'], ['C4B03','12191','長潭里'],
  ['C4C01','1116','竹圍'], ['C4D01','112','新竹'], ['C4E01','113','外埔'],
  ['C4F01','1436','臺中港'], ['C4G01','1146','鹿港'], ['C4J01','1156','萡子寮'],
  ['C4L01','1366','塭港'], ['C4L02','1166','東石'], ['C4N01','1176','將軍'],
  ['C4P01','1486','高雄'], ['C4P02','198','東沙島'], ['C4Q01','1386','小琉球'],
  ['C4Q02','1186','東港'], ['C4Q03','1196','後壁湖'], ['C4S01','1396','蘭嶼'],
  ['C4S02','1276','成功'], ['C4T01','1256','花蓮'], ['C4U01','1246','蘇澳'],
  ['C4U02','1236','烏石'], ['C4W01','1926','馬祖'], ['C4W02','1356','馬公'],
  ['C4W03','13606','七美'], ['C4W04','13406','吉貝'], ['C4W05','C4W05','東吉島'],
];
export const tideStations = rows.map(([stationId,forecastStationId,stationName]) => ({stationId,forecastStationId,stationName}));
export const stationAliases = Object.fromEntries(rows.map(([id,old])=>[id,old]));
export function canonicalStationId(id) {
  return rows.find(([current,old])=>id===current || id===old)?.[0] || id;
}
export function chineseStationName(id, ...names) {
  const known = rows.find(([current,old])=>id===current || id===old);
  if (known) return known[2];
  const candidates = names.flatMap((n) => n && typeof n === 'object' ? Object.values(n) : [n]);
  const chinese = candidates.find((n) => typeof n === 'string' && /[\u3400-\u9fff]/.test(n));
  return chinese?.replace(/潮位觀測站|潮位站/g,'').trim() || '';
}
export function chineseCatalog(stations) {
  const merged = new Map(tideStations.map((s)=>[s.stationId,s]));
  for (const s of stations || []) {
    const stationId=canonicalStationId(s.stationId);
    const stationName=chineseStationName(stationId,s.stationName);
    if (stationName) merged.set(stationId,{...s,stationId,stationName});
  }
  return [...merged.values()].sort((a,b)=>a.stationName.localeCompare(b.stationName,'zh-Hant'));
}

// Analysis and model interfaces support these two gauges only.
export const surgeStations = tideStations.filter(s => ['C4A02','C4U01'].includes(s.stationId)).map(s => ({...s, stationName: s.stationName+'潮位站'}));
