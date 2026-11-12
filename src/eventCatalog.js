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
    .map((t)=>({...t,nameZh:typhoonNameZh(t),track:(t.track || []).filter((p)=>Number.isFinite(trackTime(p.time,t.source)) && trackTime(p.time,t.source)<=cutoff)}))
    .filter((t)=>t.track.length)
    .sort((a,b)=>latestTrackTime(b)-latestTrackTime(a) || String(a.sid).localeCompare(String(b.sid)));
}

const modelTestStorms = new Set([
  '2005:HAITANG', '2005:TALIM', '2006:KAEMI',
  '2008:SINLAKU', '2008:JANGMI', '2013:KONG-REY',
]);
const modelTestChineseNames = {
  HAITANG: '海棠', TALIM: '泰利', KAEMI: '凱米',
  SINLAKU: '辛樂克', JANGMI: '薔蜜', 'KONG-REY': '康芮',
};

// Chinese names follow CWA's Traditional Chinese typhoon-name translations.
// Older retired names are included because the historical catalog contains them.
const chineseStormNames = {
  AERE: '艾利', AMPIL: '安比', ATSANI: '閃電', BAILU: '白鹿', BANYAN: '榕樹',
  BARIJAT: '百里嘉', BAVI: '巴威', BEBINCA: '貝碧佳', BILIS: '碧利斯',
  BOLAVEN: '布拉萬', BOPHA: '寶霞', BUALOI: '博羅依', BULBUL: '布爾布爾',
  CEMPAKA: '查帕卡', CHABA: '芙蓉', CHAMPI: '薔琵', 'CHAN-HOM': '昌鴻',
  CHANCHU: '珍珠', CHANTHU: '燦都', CHEBI: '奇比', 'CHOI-WAN': '彩雲',
  CIMARON: '西馬隆', 'CO-MAY': '竹節草', CONSON: '康森', DAMREY: '達維',
  DANAS: '丹娜絲', DIANMU: '電母', DOKSURI: '杜蘇芮', DOLPHIN: '白海豚',
  DORA: '多拉', DUJUAN: '杜鵑', ETAU: '艾濤', EWINIAR: '艾維尼',
  FAXAI: '法茜', FENGSHEN: '風神', FITOW: '菲特', FRANCISCO: '范斯高',
  'FUNG-WONG': '鳳凰', GAEMI: '凱米', GONI: '天鵝', GUCHOL: '古超',
  HAGIBIS: '海貝思', HAGUPIT: '哈格比', HAIKUI: '海葵', HAISHEN: '海神',
  HAITANG: '海棠', HALONG: '夏浪', HATO: '天鴿', HECTOR: '赫克特',
  HIGOS: '海高斯', HINNAMNOR: '軒嵐諾', HONE: '霍內', 'IN-FA': '煙花',
  JANGMI: '薔蜜', JEBI: '飛燕', JELAWAT: '杰拉華', JONGDARI: '雲雀',
  'KAI-TAK': '啟德', KAJIKI: '劍魚', KALMAEGI: '海鷗', KAMMURI: '北冕',
  KHANUN: '卡努', KIROGI: '鴻雁', KOGUMA: '小熊', KOINU: '小犬',
  KOMPASU: '圓規', 'KONG-REY': '康芮', KOTO: '天琴', KRATHON: '山陀兒',
  KROSA: '柯羅莎', KROVANH: '科羅旺', KUJIRA: '鯨魚', KULAP: '庫拉',
  LAN: '蘭恩', LEEPI: '麗琵', LEKIMA: '利奇馬', LINFA: '蓮花',
  LINGLING: '玲玲', LIONROCK: '獅子山', LONGWANG: '龍王', LUPIT: '盧碧',
  'MA-ON': '馬鞍', MALAKAS: '米雷', MALIKSI: '馬力斯', MALOU: '瑪瑙',
  'MAN-YI': '萬宜', MANGKHUT: '山竹', MARIA: '瑪莉亞', MATMO: '麥德姆',
  MAWAR: '瑪娃', MAYSAK: '美莎克', MEARI: '米雷', MEGI: '梅姬',
  MEKKHALA: '米克拉', MERBOK: '莫柏', MINDULLE: '蒲公英', MIRINAE: '銀河',
  MITAG: '米塔', MOLAVE: '莫拉菲', MUIFA: '梅花', MULAN: '木蘭', MUN: '木恩',
  NAKRI: '娜克莉', NALGAE: '尼格', NAMTHEUN: '南修', NANGKA: '南卡',
  NANMADOL: '南瑪都', NARI: '百合', NEOGURI: '浣熊', NEPARTAK: '尼伯特',
  NESAT: '納沙', NIDA: '妮妲', NOKAEN: '洛鞍', NONGFA: '藍湖', NORU: '諾盧',
  NOUL: '紅霞', NURI: '鸚鵡', NYATOH: '妮亞圖', OMAIS: '奧麥斯',
  PABUK: '帕布', PAKHAR: '帕卡', PEIPAH: '琵琶', PENHA: '西望洋',
  PHANFONE: '巴蓬', PODUL: '楊柳', PRAPIROON: '巴比侖', PULASAN: '普拉桑',
  RAGASA: '樺加沙', RAI: '雷伊', ROKE: '洛克', RUMBIA: '溫比亞',
  SANBA: '三巴', SANVU: '珊瑚', SAOLA: '蘇拉', SAUDEL: '沙德爾',
  SENYAR: '仙雅', SEPAT: '聖帕', SHANSHAN: '珊珊', SINLAKU: '辛樂克',
  'SON-TINH': '山神', SONCA: '桑卡', SONGDA: '桑達', SOULIK: '蘇力',
  SURIGAE: '舒力基', TALAS: '塔拉斯', TALIM: '泰利', TAPAH: '塔巴',
  TEMBIN: '天秤', TOKAGE: '蝎虎', TORAJI: '桃芝', TRAMI: '潭美',
  TRASES: '翠絲', UNALA: '烏納拉', USAGI: '天兔', VAMCO: '天鵝',
  VICENTE: '韋森特', VONGFONG: '黃蜂', WASHI: '天秤', WIPHA: '薇帕',
  WUKONG: '悟空', WUTIP: '蝴蝶', XANGSANE: '桑美', YAGI: '摩羯',
  YAMANEKO: '山貓', YINXING: '銀杏', 'YUN-YEUNG': '鴛鴦', YUTU: '玉兔',
};

export function typhoonNameZh(event) {
  if (event?.nameZh) return event.nameZh;
  const names = String(event?.name || '').toUpperCase().split(':').map((name) => chineseStormNames[name.trim()]);
  if (names.length && names.every(Boolean)) return names.join('／');
  return event?.name && !/^(UNKNOWN|UNNAMED|NOT_NAMED|\d*)$/i.test(event.name) ? event.name : '未命名颱風';
}

export function modelTestTyphoons(data) {
  return (Array.isArray(data) ? data : [])
    .filter((event) => modelTestStorms.has(`${event.year}:${String(event.name || '').toUpperCase()}`))
    .map((event) => ({ ...event, nameZh: modelTestChineseNames[String(event.name || '').toUpperCase()] || typhoonNameZh(event) }));
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
