// 按需提供颱風暴潮與天文潮配對資料；前端不定時輪詢。
// generatedAt 是回應產生時間，各站 observationTime 才是資料時間。
const OBS_DATA_ID = "O-B0075-001";
const FORECAST_DATA_ID = "F-C0036-001";
const MAX_INTERPOLATION_GAP_MS = 2 * 60 * 60 * 1000;

const STATION_ID_ALIASES = {
  // CWA 即時海象站碼 -> 潮汐預報/歷史潮位站碼
  // 龍洞潮位站：目前海象站碼 C4A02；潮位預報/歷史站碼 1226
  C4A02: "1226",

  // 蘇澳潮位站：目前海象站碼 C4U01；潮位預報/歷史站碼 1246
  C4U01: "1246",
};

function normalizeKey(key) {
  return String(key || "").replace(/[^a-z0-9]/gi, "").toLowerCase();
}

function decodeXml(value) {
  return String(value || "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&");
}

function cleanString(value) {
  if (value == null || typeof value === "object") return "";
  return String(value).trim();
}

function cleanNumber(value) {
  if (value == null || value === "" || typeof value === "object") return null;
  const text = String(value).trim();

  if (
    !text ||
    /^none$/i.test(text) ||
    /^null$/i.test(text) ||
    text === "-" ||
    /^nan$/i.test(text)
  ) {
    return null;
  }

  const number = Number(text);
  return Number.isFinite(number) ? number : null;
}

function normalizeStationName(name) {
  return String(name || "")
    .trim()
    .replace(/\s+/g, "")
    .replace(/臺/g, "台")
    .replace(/潮位觀測站/g, "")
    .replace(/潮位站/g, "")
    .replace(/測站/g, "")
    .replace(/港/g, "")
    .toLowerCase();
}

function timeValue(value) {
  if (!value) return 0;

  const raw = String(value).trim();
  const normalized = raw.includes("T") ? raw : raw.replace(" ", "T");
  const timestamp = Date.parse(/(?:Z|[+-]\d{2}:?\d{2})$/i.test(normalized) ? normalized : `${normalized}+08:00`);

  return Number.isFinite(timestamp) ? timestamp : 0;
}

function directValue(object, names) {
  if (!object || typeof object !== "object" || Array.isArray(object)) {
    return undefined;
  }

  const targets = new Set(names.map(normalizeKey));

  for (const [key, value] of Object.entries(object)) {
    if (targets.has(normalizeKey(key))) return value;
  }

  return undefined;
}

function firstObject(value) {
  if (!value) return null;
  if (Array.isArray(value)) {
    return value.find((item) => item && typeof item === "object") || null;
  }

  return typeof value === "object" ? value : null;
}

function toArray(value) {
  if (value == null) return [];
  return Array.isArray(value) ? value : [value];
}

function collectValuesByKey(root, targetKey) {
  const target = normalizeKey(targetKey);
  const results = [];
  const seen = new Set();

  function walk(value) {
    if (!value || typeof value !== "object") return;
    if (seen.has(value)) return;
    seen.add(value);

    if (Array.isArray(value)) {
      for (const item of value) walk(item);
      return;
    }

    for (const [key, child] of Object.entries(value)) {
      if (normalizeKey(key) === target) {
        results.push(child);
      }

      walk(child);
    }
  }

  walk(root);
  return results;
}

function getNestedDirect(object, names) {
  if (!object || typeof object !== "object") return undefined;

  const direct = directValue(object, names);
  if (direct !== undefined) return direct;

  for (const child of Object.values(object)) {
    if (!child || typeof child !== "object") continue;

    const found = directValue(firstObject(child) || child, names);
    if (found !== undefined) return found;
  }

  return undefined;
}

async function parseJsonResponse(response) {
  const text = await response.text();

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${text.slice(0, 250)}`);
  }

  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`回傳內容不是 JSON：${text.slice(0, 150)}`);
  }
}

async function fetchJsonDataset(dataId, apiKey) {
  const url =
    `https://opendata.cwa.gov.tw/api/v1/rest/datastore/${dataId}` +
    `?Authorization=${encodeURIComponent(apiKey)}&format=JSON`;

  const response = await fetch(url, {
    headers: { Accept: "application/json" },
    cache: "no-store",
    signal: AbortSignal.timeout(12000),
  });

  return parseJsonResponse(response);
}

function extractUrlsFromText(text) {
  const decoded = decodeXml(text);
  const matches = decoded.match(/https:\/\/[^\s<>"']+/gi) || [];

  return [...new Set(matches.map((url) => url.replace(/[),.;]+$/, "")))];
}

async function fetchText(url) {
  const response = await fetch(url, {
    headers: { Accept: "application/xml,text/xml,text/plain,*/*" },
    redirect: "follow",
    cache: "no-store",
    signal: AbortSignal.timeout(12000),
  });

  const text = await response.text();

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${text.slice(0, 250)}`);
  }

  return text;
}

async function fetchXmlDataset(dataId, apiKey, expectedTag) {
  const attempts = [
    `https://opendata.cwa.gov.tw/fileapi/v1/opendataapi/${dataId}?Authorization=${encodeURIComponent(
      apiKey
    )}`,
    `https://opendata.cwa.gov.tw/fileapi/v1/opendataapi/${dataId}?Authorization=${encodeURIComponent(
      apiKey
    )}&format=XML`,
  ];

  const errors = [];

  for (const url of attempts) {
    try {
      const text = await fetchText(url);

      if (
        new RegExp(`<(?:\\w+:)?${expectedTag}(?:\\s|>)`, "i").test(text)
      ) {
        return text;
      }

      for (const nestedUrl of extractUrlsFromText(text).slice(0, 8)) {
        try {
          const nestedText = await fetchText(nestedUrl);

          if (
            new RegExp(`<(?:\\w+:)?${expectedTag}(?:\\s|>)`, "i").test(
              nestedText
            )
          ) {
            return nestedText;
          }
        } catch (error) {
          errors.push(`${nestedUrl}: ${error.message}`);
        }
      }
    } catch (error) {
      errors.push(`${url}: ${error.message}`);
    }
  }

  throw new Error(
    `找不到 ${dataId} 的 XML ${expectedTag} 資料。${errors
      .slice(0, 3)
      .join(" | ")}`
  );
}

function xmlTag(block, tag) {
  const pattern = new RegExp(
    `<(?:\\w+:)?${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/(?:\\w+:)?${tag}>`,
    "i"
  );

  const match = pattern.exec(block);
  return match ? decodeXml(match[1].replace(/<[^>]+>/g, "").trim()) : "";
}

function xmlBlocks(text, tag) {
  const pattern = new RegExp(
    `<(?:\\w+:)?${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/(?:\\w+:)?${tag}>`,
    "gi"
  );

  const results = [];
  let match;

  while ((match = pattern.exec(text))) {
    results.push(match[1]);
  }

  return results;
}

function parseObservationXml(xml) {
  const stations = new Map();

  for (const locationBlock of xmlBlocks(xml, "Location")) {
    const stationBlock = xmlBlocks(locationBlock, "Station")[0] || "";
    const stationId = xmlTag(stationBlock, "StationID");
    if (!stationId) continue;

    const stationName = xmlTag(stationBlock, "StationName");
    const longitude = cleanNumber(xmlTag(stationBlock, "StationLongitude"));
    const latitude = cleanNumber(xmlTag(stationBlock, "StationLatitude"));
    const countyName = xmlTag(stationBlock, "CountyName");
    const stationAttribute = xmlTag(stationBlock, "StationAttribute");

    const records = [];

    for (const obsBlock of xmlBlocks(locationBlock, "StationObsTime")) {
      const time = xmlTag(obsBlock, "DataTime") || xmlTag(obsBlock, "DateTime");
      const tideHeight = cleanNumber(xmlTag(obsBlock, "TideHeight"));

      if (
        !time ||
        !timeValue(time) ||
        tideHeight == null ||
        tideHeight <= -90 ||
        Math.abs(tideHeight) > 20
      ) {
        continue;
      }

      records.push({ time, tideHeight });
    }

    if (records.length === 0) continue;

    const unique = new Map();

    for (const record of records) {
      unique.set(`${record.time}|${record.tideHeight}`, record);
    }

    stations.set(stationId, {
      stationId,
      stationName,
      latitude,
      longitude,
      countyName,
      stationAttribute,
      records: [...unique.values()].sort(
        (a, b) => timeValue(a.time) - timeValue(b.time)
      ),
    });
  }

  return stations;
}

function extractObservationStationsJson(data) {
  const stations = new Map();
  const locationValues = collectValuesByKey(data, "Location");

  for (const locationValue of locationValues) {
    for (const location of toArray(locationValue)) {
      if (!location || typeof location !== "object") continue;

      const stationValue = directValue(location, ["Station"]);
      const station = firstObject(stationValue) || location;

      const stationId = cleanString(
        directValue(station, ["StationID", "StationId", "stationId"])
      );

      if (!stationId) continue;

      const stationName = cleanString(
        directValue(station, ["StationName", "stationName"])
      );

      const longitude = cleanNumber(
        directValue(station, ["StationLongitude", "Longitude", "lon"])
      );

      const latitude = cleanNumber(
        directValue(station, ["StationLatitude", "Latitude", "lat"])
      );

      const countyValue = directValue(station, ["County"]);
      const countyObject = firstObject(countyValue);
      const countyName = cleanString(
        countyObject
          ? directValue(countyObject, ["CountyName"])
          : directValue(station, ["CountyName"])
      );

      const stationAttribute = cleanString(
        directValue(station, ["StationAttribute"])
      );

      const records = [];
      const obsValues = collectValuesByKey(location, "StationObsTime");

      for (const obsValue of obsValues) {
        for (const obs of toArray(obsValue)) {
          if (!obs || typeof obs !== "object") continue;

          const time = cleanString(
            directValue(obs, ["DataTime", "DateTime", "ObservationTime"])
          );

          const weather =
            firstObject(directValue(obs, ["WeatherElements"])) || obs;

          const tideHeight = cleanNumber(
            getNestedDirect(weather, ["TideHeight", "tideHeight"])
          );

          if (
            !time ||
            !timeValue(time) ||
            tideHeight == null ||
            tideHeight <= -90 ||
            Math.abs(tideHeight) > 20
          ) {
            continue;
          }

          records.push({ time, tideHeight });
        }
      }

      if (records.length === 0) continue;

      const unique = new Map();
      for (const record of records) {
        unique.set(`${record.time}|${record.tideHeight}`, record);
      }

      stations.set(stationId, {
        stationId,
        stationName,
        latitude,
        longitude,
        countyName,
        stationAttribute,
        records: [...unique.values()].sort(
          (a, b) => timeValue(a.time) - timeValue(b.time)
        ),
      });
    }
  }

  return stations;
}

function extractForecastStations(data) {
  const stations = new Map();
  const locationValues = collectValuesByKey(data, "Location");

  for (const locationValue of locationValues) {
    for (const location of toArray(locationValue)) {
      if (!location || typeof location !== "object") continue;

      const stationId = cleanString(
        directValue(location, ["StationID", "StationId", "stationId"])
      );

      if (!stationId) continue;

      const stationName = cleanString(
        directValue(location, ["StationName", "stationName"])
      );

      const latitude = cleanNumber(
        directValue(location, ["Latitude", "StationLatitude", "lat"])
      );

      const longitude = cleanNumber(
        directValue(location, ["Longitude", "StationLongitude", "lon"])
      );

      const records = [];
      const timeValues = collectValuesByKey(location, "Time");

      for (const timeValueContainer of timeValues) {
        for (const item of toArray(timeValueContainer)) {
          if (!item || typeof item !== "object") continue;

          const time = cleanString(
            directValue(item, ["DateTime", "DataTime"])
          );

          if (!time || !timeValue(time)) continue;

          const tideHeights =
            firstObject(directValue(item, ["TideHeights"])) || item;

          const aboveTWVDCm = cleanNumber(
            directValue(tideHeights, ["AboveTWVD"])
          );
          const aboveLocalMSLCm = cleanNumber(
            directValue(tideHeights, ["AboveLocalMSL"])
          );
          const aboveChartDatumCm = cleanNumber(
            directValue(tideHeights, ["AboveChartDatum"])
          );

          if (
            aboveTWVDCm == null &&
            aboveLocalMSLCm == null &&
            aboveChartDatumCm == null
          ) {
            continue;
          }

          records.push({
            time,
            aboveTWVD:
              aboveTWVDCm == null ? null : aboveTWVDCm / 100,
            aboveLocalMSL:
              aboveLocalMSLCm == null ? null : aboveLocalMSLCm / 100,
            aboveChartDatum:
              aboveChartDatumCm == null ? null : aboveChartDatumCm / 100,
          });
        }
      }

      if (records.length === 0) continue;

      const unique = new Map();
      for (const record of records) {
        unique.set(record.time, record);
      }

      stations.set(stationId, {
        stationId,
        stationName,
        latitude,
        longitude,
        records: [...unique.values()].sort(
          (a, b) => timeValue(a.time) - timeValue(b.time)
        ),
      });
    }
  }

  return stations;
}

function parseForecastXml(xml) {
  const stations = new Map();

  for (const locationBlock of xmlBlocks(xml, "Location")) {
    const stationId = xmlTag(locationBlock, "StationID");
    if (!stationId) continue;

    const stationName = xmlTag(locationBlock, "StationName");
    const latitude = cleanNumber(xmlTag(locationBlock, "Latitude"));
    const longitude = cleanNumber(xmlTag(locationBlock, "Longitude"));

    const records = [];

    for (const timeBlock of xmlBlocks(locationBlock, "Time")) {
      const time = xmlTag(timeBlock, "DateTime");
      if (!time || !timeValue(time)) continue;

      const aboveTWVDCm = cleanNumber(xmlTag(timeBlock, "AboveTWVD"));
      const aboveLocalMSLCm = cleanNumber(
        xmlTag(timeBlock, "AboveLocalMSL")
      );
      const aboveChartDatumCm = cleanNumber(
        xmlTag(timeBlock, "AboveChartDatum")
      );

      if (
        aboveTWVDCm == null &&
        aboveLocalMSLCm == null &&
        aboveChartDatumCm == null
      ) {
        continue;
      }

      records.push({
        time,
        aboveTWVD: aboveTWVDCm == null ? null : aboveTWVDCm / 100,
        aboveLocalMSL:
          aboveLocalMSLCm == null ? null : aboveLocalMSLCm / 100,
        aboveChartDatum:
          aboveChartDatumCm == null ? null : aboveChartDatumCm / 100,
      });
    }

    if (records.length === 0) continue;

    stations.set(stationId, {
      stationId,
      stationName,
      latitude,
      longitude,
      records: records.sort(
        (a, b) => timeValue(a.time) - timeValue(b.time)
      ),
    });
  }

  return stations;
}

function distanceKm(lat1, lon1, lat2, lon2) {
  if (![lat1, lon1, lat2, lon2].every(Number.isFinite)) return Infinity;

  const toRad = (value) => (value * Math.PI) / 180;
  const earthRadiusKm = 6371;

  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);

  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) *
      Math.cos(toRad(lat2)) *
      Math.sin(dLon / 2) ** 2;

  return 2 * earthRadiusKm * Math.asin(Math.sqrt(a));
}

function stationNameScore(a, b) {
  const left = normalizeStationName(a);
  const right = normalizeStationName(b);

  if (!left || !right) return 0;
  if (left === right) return 100;
  if (left.includes(right) || right.includes(left)) return 80;

  return 0;
}

function findForecastStation(obsStation, forecasts) {
  const exactId = forecasts.get(obsStation.stationId);

  if (exactId) {
    return {
      station: exactId,
      matchedBy: "stationId",
      distanceKm: distanceKm(
        obsStation.latitude,
        obsStation.longitude,
        exactId.latitude,
        exactId.longitude
      ),
    };
  }

  // 部分 CWA 即時海象站碼與潮汐預報站碼不同。
  // 對已確認的潮位站先使用明確對照，避免因名稱格式差異而漏站。
  const aliasForecastId = STATION_ID_ALIASES[obsStation.stationId];

  if (aliasForecastId) {
    const aliasedStation = forecasts.get(aliasForecastId);

    if (aliasedStation) {
      return {
        station: aliasedStation,
        matchedBy: "stationIdAlias",
        distanceKm: distanceKm(
          obsStation.latitude,
          obsStation.longitude,
          aliasedStation.latitude,
          aliasedStation.longitude
        ),
      };
    }
  }

  let bestName = null;
  let bestNameScore = 0;

  for (const station of forecasts.values()) {
    const score = stationNameScore(
      obsStation.stationName,
      station.stationName
    );

    if (score > bestNameScore) {
      bestName = station;
      bestNameScore = score;
    }
  }

  if (bestName && bestNameScore === 100) {
    return {
      station: bestName,
      matchedBy: "stationName",
      distanceKm: distanceKm(
        obsStation.latitude,
        obsStation.longitude,
        bestName.latitude,
        bestName.longitude
      ),
    };
  }

  return null;
}

const OFFSHORE_NAME_KEYWORDS = [
  "澎湖",
  "馬公",
  "東吉",
  "七美",
  "金門",
  "水頭",
  "料羅",
  "馬祖",
  "南竿",
  "北竿",
  "東引",
  "蘭嶼",
  "綠島",
];

function datumForStation(obsStation) {
  const name = String(obsStation.stationName || "");
  const county = String(obsStation.countyName || "");

  const offshore =
    OFFSHORE_NAME_KEYWORDS.some(
      (keyword) => name.includes(keyword) || county.includes(keyword)
    ) ||
    (Number.isFinite(obsStation.longitude) &&
      obsStation.longitude < 120.0);

  if (offshore) {
    return {
      key: "aboveLocalMSL",
      code: "LOCAL_MSL",
      label: "當地平均海平面（Local MSL）",
    };
  }

  return {
    key: "aboveTWVD",
    code: "TWVD",
    label: "臺灣高程基準（TWVD）",
  };
}

function recordValue(record, datumKey) {
  const value = cleanNumber(record?.[datumKey]);
  return value == null ? null : value;
}

function forecastAtTime(records, targetTime, datumKey) {
  if (!Array.isArray(records) || records.length === 0) return null;

  let low = 0;
  let high = records.length - 1;

  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    const midTime = timeValue(records[mid].time);

    if (midTime < targetTime) low = mid + 1;
    else if (midTime > targetTime) high = mid - 1;
    else {
      const exactValue = recordValue(records[mid], datumKey);

      if (exactValue != null) {
        return {
          value: exactValue,
          time: records[mid].time,
          method: "exact",
        };
      }

      break;
    }
  }

  const before = records[low - 1] || null;
  const after = records[low] || null;

  if (before && after) {
    const t1 = timeValue(before.time);
    const t2 = timeValue(after.time);
    const v1 = recordValue(before, datumKey);
    const v2 = recordValue(after, datumKey);

    if (
      v1 != null &&
      v2 != null &&
      t1 <= targetTime &&
      targetTime <= t2 &&
      t2 - t1 <= MAX_INTERPOLATION_GAP_MS &&
      t2 > t1
    ) {
      const ratio = (targetTime - t1) / (t2 - t1);

      return {
        value: v1 + (v2 - v1) * ratio,
        time: new Date(targetTime).toISOString(),
        sourceTimes: [before.time, after.time],
        method: "linearInterpolation",
      };
    }
  }

  return null;
}

function round3(value) {
  return Math.round((Number(value) + Number.EPSILON) * 1000) / 1000;
}

async function loadObservationStations(apiKey) {
  const diagnostics = {
    jsonStations: 0,
    xmlFallbackUsed: false,
  };

  try {
    const json = await fetchJsonDataset(OBS_DATA_ID, apiKey);
    const stations = extractObservationStationsJson(json);
    diagnostics.jsonStations = stations.size;

    if (stations.size > 0) {
      return { stations, diagnostics };
    }
  } catch (error) {
    diagnostics.jsonError = error.message;
  }

  const xml = await fetchXmlDataset(
    OBS_DATA_ID,
    apiKey,
    "StationObsTime"
  );
  const stations = parseObservationXml(xml);

  diagnostics.xmlFallbackUsed = true;
  diagnostics.xmlStations = stations.size;

  return { stations, diagnostics };
}

async function loadForecastStations(apiKey) {
  const diagnostics = {
    jsonStations: 0,
    xmlFallbackUsed: false,
  };

  try {
    const json = await fetchJsonDataset(FORECAST_DATA_ID, apiKey);
    const stations = extractForecastStations(json);
    diagnostics.jsonStations = stations.size;

    if (stations.size > 0) {
      return { stations, diagnostics };
    }
  } catch (error) {
    diagnostics.jsonError = error.message;
  }

  const xml = await fetchXmlDataset(
    FORECAST_DATA_ID,
    apiKey,
    "TideForecasts"
  );
  const stations = parseForecastXml(xml);

  diagnostics.xmlFallbackUsed = true;
  diagnostics.xmlStations = stations.size;

  return { stations, diagnostics };
}

function rangeOf(records) {
  const times = records.map((r) => timeValue(r.time)).filter(Boolean).sort((a,b) => a-b);
  return times.length ? { start: new Date(times[0]).toISOString(), end: new Date(times.at(-1)).toISOString(), count: times.length } : null;
}

function parseQuery(req) {
  const params = new URL(req.url || '/', 'http://localhost').searchParams;
  const get = (name) => req.query?.[name] ?? params.get(name);
  const start = get('start'), end = get('end'), station = get('station');
  const explicitTime = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/i;
  if (typeof start !== 'string' || typeof end !== 'string' || !explicitTime.test(start) || !explicitTime.test(end)) {
    throw Error('start/end 必須是含時區的 ISO 時間，例如 2023-07-24T00:00:00+08:00。');
  }
  const from = Date.parse(start), to = Date.parse(end);
  if (!Number.isFinite(from) || !Number.isFinite(to) || to <= from || to-from > 120*86400000) {
    throw Error('日期區間無效；end 必須晚於 start，最長 120 天。');
  }
  if (typeof station !== 'string' || !/^[A-Za-z0-9_-]{1,24}$/.test(station)) throw Error('請提供有效的 station 站碼。');
  const stationId = Object.keys(STATION_ID_ALIASES).find((id) => STATION_ID_ALIASES[id] === station) || station;
  return { from, to, stationId, start: new Date(from).toISOString(), end: new Date(to).toISOString() };
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'GET') {
    res.setHeader('Allow','GET');
    return res.status(405).json({ success:false, message:'Method Not Allowed' });
  }
  let query;
  try { query = parseQuery(req); }
  catch (error) { return res.status(400).json({ success:false, message:error.message }); }
  const apiKey = process.env.CWA_API_KEY;
  if (!apiKey) return res.status(503).json({ success:false, message:'伺服器尚未設定 CWA_API_KEY；無法確認來源資料可用期間。' });
  try {
    // These endpoints supply their currently published snapshot. Query dates filter
    // that snapshot; they do not turn it into a historical archive.
    const results = await Promise.allSettled([loadObservationStations(apiKey),loadForecastStations(apiKey)]);
    const observations = results[0].status === 'fulfilled' ? results[0].value.stations : new Map();
    const forecasts = results[1].status === 'fulfilled' ? results[1].value.stations : new Map();
    const warnings = [];
    if (results[0].status === 'rejected') warnings.push('實測潮位來源暫時讀取失敗；可用期間未知。');
    if (results[1].status === 'rejected') warnings.push('天文潮來源暫時讀取失敗；可用期間未知。');
    if (results.every((r) => r.status === 'rejected')) return res.status(502).json({success:false,message:'CWA 潮位來源暫時無法讀取，請稍後重試。'});

    const catalog = new Map([
      ['C4A02',{stationId:'C4A02',forecastStationId:'1226',stationName:'龍洞'}],
      ['C4U01',{stationId:'C4U01',forecastStationId:'1246',stationName:'蘇澳'}],
    ]);
    for (const obs of observations.values()) {
      const match = findForecastStation(obs,forecasts);
      catalog.set(obs.stationId,{stationId:obs.stationId,stationName:obs.stationName || obs.stationId,forecastStationId:match?.station.stationId || STATION_ID_ALIASES[obs.stationId] || null});
    }
    for (const forecast of forecasts.values()) {
      if (![...catalog.values()].some((s) => s.forecastStationId === forecast.stationId)) {
        catalog.set(forecast.stationId,{stationId:forecast.stationId,forecastStationId:forecast.stationId,stationName:forecast.stationName || forecast.stationId});
      }
    }
    const selected = catalog.get(query.stationId);
    const stations = [...catalog.values()].sort((a,b) => a.stationName.localeCompare(b.stationName,'zh-Hant'));
    if (!selected) return res.status(404).json({success:false,message:'找不到指定測站，請重新選擇。',stations});
    const obs = observations.get(selected.stationId);
    const forecast = forecasts.get(selected.forecastStationId);
    const datum = datumForStation(obs || forecast || selected);
    const obsRecords = obs?.records || [];
    const forecastRecords = (forecast?.records || []).filter((r) => recordValue(r,datum.key) != null);
    const inWindow = (r) => timeValue(r.time) >= query.from && timeValue(r.time) <= query.to;
    const points = new Map();
    for (const r of forecastRecords.filter(inWindow)) {
      const t = timeValue(r.time);
      points.set(t,{time:new Date(t).toISOString(),observedTide:null,predictedTide:round3(recordValue(r,datum.key)),surgeAnomaly:null,forecastMethod:'exact'});
    }
    for (const r of obsRecords.filter(inWindow)) {
      const t = timeValue(r.time);
      const prediction = forecastAtTime(forecastRecords,t,datum.key);
      points.set(t,{
        time:new Date(t).toISOString(), observedTide:round3(r.tideHeight),
        predictedTide:prediction ? round3(prediction.value) : null,
        surgeAnomaly:prediction ? round3(r.tideHeight-prediction.value) : null,
        forecastMethod:prediction?.method || null,
        forecastSourceTimes:prediction?.sourceTimes || (prediction ? [prediction.time] : null),
      });
    }
    const history = [...points.values()].sort((a,b) => timeValue(a.time)-timeValue(b.time));
    const paired = history.filter((r) => r.surgeAnomaly != null);
    const allPaired = obsRecords.filter((r) => forecastAtTime(forecastRecords,timeValue(r.time),datum.key));
    const observationRange = rangeOf(obsRecords);
    const predictionRange = rangeOf(forecastRecords);
    const status = !history.length ? 'unavailable' : !paired.length ? 'unpaired' : 'available_subset';
    return res.status(200).json({
      success:true,generatedAt:new Date().toISOString(),mode:'typhoon-event',
      requested:{start:query.start,end:query.end,station:query.stationId},
      status, units:'m', stations,
      station:{...selected,datum:datum.code,datumLabel:datum.label,history},
      availability:{observation:observationRange,astronomicalTide:predictionRange,paired:rangeOf(allPaired)},
      counts:{observed:history.filter((r)=>r.observedTide!=null).length,astronomical:history.filter((r)=>r.predictedTide!=null).length,paired:paired.length},
      fallback:{type:'published-snapshot-only',historicalArchiveConnected:false,
        message:'目前僅連接 CWA 已發布的潮位觀測與天文潮預報資料，未接歷史潮位庫；只顯示與所選事件重疊的資料。缺少資料時保留空值，不用近期資料替代歷史事件。',
        historicalDataUrl:'https://ocean.cwa.gov.tw/V2/data_interface/datasets'},
      method:'同測站、同基準相減；天文潮以原始時刻或跨度不超過 2 小時的線性內插配對，不外插、不跨基準退回。可用期間為資料首末時間，不保證其中每一時刻都有資料。',
      definition:'暴潮增水 = 實測潮位 − 天文潮；此殘差也可能包含非颱風因素。',
      sources:{observation:OBS_DATA_ID,astronomicalTide:FORECAST_DATA_ID},warnings,
    });
  } catch {
    return res.status(502).json({success:false,message:'潮位資料處理失敗，請稍後重試。'});
  }
}
