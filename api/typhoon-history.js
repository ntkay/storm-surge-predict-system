// Latest three years supplement the project's local ten-year archive.
const SOURCE = 'https://www.ncei.noaa.gov/data/international-best-track-archive-for-climate-stewardship-ibtracs/v04r01/access/csv/ibtracs.last3years.list.v04r01.csv';
let cached;

export function parseCsv(text, now = Date.now()) {
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/);
  const split = (line) => {
    const cells = []; let cell = '', quoted = false;
    for (let i=0;i<line.length;i++) {
      const char=line[i];
      if (char==='"') { if (quoted && line[i+1]==='"') {cell+='"';i++;} else quoted=!quoted; }
      else if(char===',' && !quoted) {cells.push(cell.trim());cell='';} else cell+=char;
    }
    cells.push(cell.trim()); return cells;
  };
  const headers = split(lines.shift() || '');
  const index = Object.fromEntries(headers.map((key,i)=>[key,i]));
  if (!['SID','SEASON','NAME','BASIN','ISO_TIME','LAT','LON'].every((key)=>key in index)) throw Error('Unexpected NOAA CSV schema');
  const number = (value) => value && Number.isFinite(Number(value)) && Number(value)>-900 ? Number(value) : null;
  const storms = new Map();
  for (const line of lines) {
    if (!line.trim()) continue;
    const cells=split(line), get=(key)=>cells[index[key]] || '';
    if (get('BASIN')!=='WP' || !/^\d{4}$/.test(get('SEASON'))) continue;
    const sid=get('SID'), time=Date.parse(get('ISO_TIME').replace(' ','T')+'Z');
    const lat=number(get('LAT')), lon=number(get('LON'));
    if (!sid || !Number.isFinite(time) || time>now || lat==null || lon==null) continue;
    if (!storms.has(sid)) storms.set(sid,{sid,year:Number(get('SEASON')),name:get('NAME') || 'UNNAMED',basin:'WP',source:'IBTrACS',windUnit:'kt',track:[]});
    storms.get(sid).track.push({time:new Date(time).toISOString(),lat,lon,wind:number(get('WMO_WIND')) ?? number(get('USA_WIND')),pressure:number(get('WMO_PRES')) ?? number(get('USA_PRES'))});
  }
  for (const storm of storms.values()) storm.track.sort((a,b)=>Date.parse(a.time)-Date.parse(b.time));
  return [...storms.values()];
}

export default async function handler(req,res) {
  if (req.method!=='GET') {res.setHeader('Allow','GET');return res.status(405).json({success:false,message:'Method Not Allowed'});}
  try {
    if (!cached || Date.now()-cached.savedAt>3600000) {
      const response=await fetch(SOURCE,{signal:AbortSignal.timeout(25000),headers:{Accept:'text/csv'}});
      if(!response.ok) throw Error('NOAA unavailable');
      const typhoons=parseCsv(await response.text());
      if (!typhoons.length) throw Error('NOAA returned no usable tracks');
      const latestTime=Math.max(...typhoons.map((t)=>Date.parse(t.track.at(-1).time)));
      cached={savedAt:Date.now(),payload:{success:true,source:'NOAA IBTrACS',sourceUrl:SOURCE,sourceModifiedAt:response.headers.get('last-modified'),fetchedAt:new Date().toISOString(),latestTrackAt:new Date(latestTime).toISOString(),typhoons}};
    }
    res.setHeader('Cache-Control','public, s-maxage=3600, stale-while-revalidate=3600');
    return res.status(200).json(cached.payload);
  } catch {
    res.setHeader('Cache-Control','no-store');
    return res.status(502).json({success:false,message:'最新 NOAA 颱風資料暫時無法取得；使用原有檔案及 CWA 已取得路徑，不能保證清單已完整更新至今天。'});
  }
}
