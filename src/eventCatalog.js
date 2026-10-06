export function trackTime(value, source) {
  if (!value || typeof value !== 'string') return NaN;
  const text=value.trim().replace(' ','T');
  return Date.parse(/(?:Z|[+-]\d{2}:?\d{2})$/i.test(text) ? text : `${text}${source==='CWA-live' ? '+08:00' : 'Z'}`);
}
export function latestTrackTime(event) {
  return (event.track || []).reduce((last,p)=>Math.max(last,trackTime(p.time,event.source)||0),0);
}
export function recentTyphoons(data, currentYear = Number(new Intl.DateTimeFormat('en', {timeZone:'Asia/Taipei',year:'numeric'}).format(new Date())), cutoff = Date.now()) {
  return (Array.isArray(data) ? data : []).filter((t)=>Number(t.year)>=currentYear-9 && Number(t.year)<=currentYear)
    .map((t)=>({...t,track:(t.track || []).filter((p)=>Number.isFinite(trackTime(p.time,t.source)) && trackTime(p.time,t.source)<=cutoff)}))
    .filter((t)=>t.track.length)
    .sort((a,b)=>latestTrackTime(b)-latestTrackTime(a) || String(a.sid).localeCompare(String(b.sid)));
}

const modelTestStorms = new Set([
  '2005:HAITANG', '2005:TALIM', '2006:KAEMI',
  '2008:SINLAKU', '2008:JANGMI', '2013:KONG-REY',
]);
const modelTestChineseNames = {
  HAITANG: '海棠', TALIM: '潭美', KAEMI: '凱米',
  SINLAKU: '辛樂克', JANGMI: '薔蜜', 'KONG-REY': '康芮',
};

export function modelTestTyphoons(data) {
  return (Array.isArray(data) ? data : [])
    .filter((event) => modelTestStorms.has(`${event.year}:${String(event.name || '').toUpperCase()}`))
    .map((event) => ({ ...event, nameZh: modelTestChineseNames[String(event.name || '').toUpperCase()] }));
}

export function mergeTyphoons(...lists) {
  const merged = new Map();
  for (const event of lists.flat()) {
    if (!event?.sid) continue;
    const name=String(event.name || '').toUpperCase();
    // Named storms have one identity per season; unnamed depressions retain SID.
    const key=/^(UNKNOWN|UNNAMED|NOT_NAMED|未命名|\d*)$/.test(name) ? event.sid : `${event.year}:${name}`;
    const old=merged.get(key);
    if (!old) { merged.set(key,{...event,track:[...(event.track || [])]});continue; }
    // Keep one unit system per event (NOAA kt, CWA m/s); only dates/positions
    // are shared across sources, so convert CWA wind before merging into NOAA.
    const unit=(old.source==='CWA-live' ? 'm/s' : 'kt');
    const incomingUnit=(event.source==='CWA-live' ? 'm/s' : 'kt');
    const points=new Map(old.track.map((p)=>[trackTime(p.time,old.source),p]));
    for (const p of event.track || []) {
      const time=trackTime(p.time,event.source);
      if(!Number.isFinite(time)) continue;
      let wind=p.wind;
      if (wind!=null && unit!==incomingUnit) wind=Number(wind)*(unit==='kt' ? 1.943844492 : 0.514444444);
      points.set(time,{...p,time:new Date(time).toISOString(),wind});
    }
    merged.set(key,{...old,nameZh:event.nameZh || old.nameZh,windUnit:unit,track:[...points.entries()].sort((a,b)=>a[0]-b[0]).map(([,p])=>p)});
  }
  const allEvents = [...merged.values()];
  const recent = recentTyphoons(allEvents);
  const selected = new Map([...recent, ...modelTestTyphoons(allEvents)].map((event) => [event.sid, event]));
  return [...selected.values()].sort((a, b) => latestTrackTime(b) - latestTrackTime(a));
}

export function cwaEvents(payload) {
  const raw=payload?.records?.TropicalCyclones?.TropicalCyclone;
  const systems=Array.isArray(raw) ? raw : raw ? [raw] : [];
  return systems.map((t)=>{
    const rawFix=t.AnalysisData?.Fix;
    const track=(Array.isArray(rawFix)?rawFix:rawFix?[rawFix]:[]).map((p)=>({time:p.DateTime,lat:Number(p.CoordinateLatitude),lon:Number(p.CoordinateLongitude),wind:p.MaxWindSpeed==null?null:Number(p.MaxWindSpeed),pressure:p.Pressure==null?null:Number(p.Pressure)})).filter((p)=>Number.isFinite(trackTime(p.time,'CWA-live')) && Number.isFinite(p.lat) && Number.isFinite(p.lon));
    const year=Number(t.Year) || new Date(trackTime(track.at(-1)?.time,'CWA-live')).getUTCFullYear();
    return {sid:`CWA-${year}-${t.CwaTyNo || t.CwaTdNo || t.TyphoonName}`,year,name:t.TyphoonName || t.CwaTyphoonName || 'UNKNOWN',nameZh:t.CwaTyphoonName,source:'CWA-live',windUnit:'m/s',track};
  }).filter((t)=>t.track.length && Number.isFinite(t.year));
}
