const OBS_DATA_ID = "O-B0075-001";
const FORECAST_DATA_ID = "F-C0036-001";
const MAX_MATCH_DIFF_MS = 90 * 60 * 1000;
const MAX_HISTORY_POINTS = 48;

function normalizeKey(key) {
  return String(key || "").replace(/[^a-z0-9]/gi, "").toLowerCase();
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

function deepValue(value, names, maxDepth = 3, depth = 0) {
  if (value == null || depth > maxDepth) return undefined;

  if (typeof value === "object" && !Array.isArray(value)) {
    const direct = directValue(value, names);
    if (direct !== undefined && direct !== null && direct !== "") {
      return direct;
    }
  }

  if (depth === maxDepth || typeof value !== "object") {
    return undefined;
  }

  const children = Array.isArray(value) ? value : Object.values(value);

  for (const child of children) {
    const found = deepValue(child, names, maxDepth, depth + 1);
    if (found !== undefined && found !== null && found !== "") {
      return found;
    }
  }

  return undefined;
}

function walk(value, visitor, seen = new Set()) {
  if (!value || typeof value !== "object") return;
  if (seen.has(value)) return;
  seen.add(value);

  visitor(value);

  if (Array.isArray(value)) {
    for (const item of value) walk(item, visitor, seen);
    return;
  }

  for (const child of Object.values(value)) {
    walk(child, visitor, seen);
  }
}

function asNumber(value) {
  if (value == null || value === "" || typeof value === "object") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function asString(value) {
  if (value == null || typeof value === "object") return "";
  return String(value).trim();
}

function timeValue(value) {
  if (!value) return 0;
  const raw = String(value).trim();
  const normalized = raw.includes("T") ? raw : raw.replace(" ", "T");
  const timestamp = Date.parse(normalized);
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function getStationId(object) {
  return asString(directValue(object, ["StationID", "StationId", "stationId"]));
}

function getStationName(object) {
  return asString(
    directValue(object, ["StationName", "stationName", "LocationName"])
  );
}

function getLatitude(object) {
  return asNumber(
    deepValue(object, ["Latitude", "StationLatitude", "lat"], 2)
  );
}

function getLongitude(object) {
  return asNumber(
    deepValue(object, ["Longitude", "StationLongitude", "lon", "lng"], 2)
  );
}

function getDirectTime(object) {
  const value = directValue(object, [
    "DateTime",
    "ObsTime",
    "ObservationTime",
    "DataTime",
  ]);

  if (typeof value === "string" || typeof value === "number") {
    return asString(value);
  }

  if (value && typeof value === "object") {
    return asString(
      deepValue(value, ["DateTime", "dateTime", "Time", "time"], 2)
    );
  }

  return "";
}

function countKey(data, targetKey) {
  const target = normalizeKey(targetKey);
  let count = 0;

  walk(data, (object) => {
    if (Array.isArray(object)) return;
    for (const key of Object.keys(object)) {
      if (normalizeKey(key) === target) count += 1;
    }
  });

  return count;
}

function findUrls(data) {
  const urls = [];

  walk(data, (object) => {
    if (Array.isArray(object)) return;
    for (const value of Object.values(object)) {
      if (
        typeof value === "string" &&
        /^https:\/\//i.test(value) &&
        !urls.includes(value)
      ) {
        urls.push(value);
      }
    }
  });

  return urls;
}

async function parseJsonResponse(response) {
  const text = await response.text();

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${text.slice(0, 250)}`);
  }

  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`回傳內容不是 JSON：${text.slice(0, 120)}`);
  }
}

async function fetchCwaDataset(dataId, apiKey, expectedKey) {
  const urls = [
    `https://opendata.cwa.gov.tw/api/v1/rest/datastore/${dataId}?Authorization=${encodeURIComponent(
      apiKey
    )}&format=JSON`,
    `https://opendata.cwa.gov.tw/fileapi/v1/opendataapi/${dataId}?Authorization=${encodeURIComponent(
      apiKey
    )}&format=JSON`,
  ];

  const errors = [];

  for (const url of urls) {
    try {
      const response = await fetch(url, {
        headers: { Accept: "application/json" },
        redirect: "follow",
      });

      const data = await parseJsonResponse(response);

      if (countKey(data, expectedKey) > 0) {
        return data;
      }

      for (const nestedUrl of findUrls(data).slice(0, 3)) {
        try {
          const nestedResponse = await fetch(nestedUrl, {
            headers: { Accept: "application/json" },
            redirect: "follow",
          });
          const nestedData = await parseJsonResponse(nestedResponse);
          if (countKey(nestedData, expectedKey) > 0) {
            return nestedData;
          }
        } catch (error) {
          errors.push(`${dataId} 內部網址：${error.message}`);
        }
      }

      errors.push(`${dataId} 找不到欄位 ${expectedKey}`);
    } catch (error) {
      errors.push(`${dataId}: ${error.message}`);
    }
  }

  throw new Error(errors.join(" | "));
}

function extractObservationStations(data) {
  const byStation = new Map();

  walk(data, (root) => {
    if (Array.isArray(root)) return;

    const stationId = getStationId(root);
    if (!stationId) return;

    const stationName = getStationName(root);
    const latitude = getLatitude(root);
    const longitude = getLongitude(root);
    const records = [];

    walk(root, (node) => {
      if (Array.isArray(node)) return;

      const time = getDirectTime(node);
      if (!time || !timeValue(time)) return;

      const tideHeight = asNumber(deepValue(node, ["TideHeight"], 2));
      if (tideHeight == null || Math.abs(tideHeight) > 20) return;

      records.push({ time, tideHeight });
    });

    if (records.length === 0) return;

    const current = byStation.get(stationId) || {
      stationId,
      stationName: stationName || "",
      latitude,
      longitude,
      records: [],
    };

    if (!current.stationName && stationName) current.stationName = stationName;
    if (current.latitude == null && latitude != null) current.latitude = latitude;
    if (current.longitude == null && longitude != null) current.longitude = longitude;
    current.records.push(...records);
    byStation.set(stationId, current);
  });

  for (const station of byStation.values()) {
    const unique = new Map();
    for (const record of station.records) {
      unique.set(`${record.time}|${record.tideHeight}`, record);
    }
    station.records = [...unique.values()].sort(
      (a, b) => timeValue(a.time) - timeValue(b.time)
    );
  }

  return byStation;
}

function extractForecastStations(data) {
  const byStation = new Map();

  walk(data, (root) => {
    if (Array.isArray(root)) return;

    const stationId = getStationId(root);
    if (!stationId) return;

    const stationName = getStationName(root);
    const latitude = getLatitude(root);
    const longitude = getLongitude(root);
    const records = [];

    walk(root, (node) => {
      if (Array.isArray(node)) return;

      const time = getDirectTime(node);
      if (!time || !timeValue(time)) return;

      const chartDatumCm = asNumber(
        deepValue(node, ["AboveChartDatum"], 2)
      );
      if (chartDatumCm == null || Math.abs(chartDatumCm) > 5000) return;

      records.push({
        time,
        predictedTide: chartDatumCm / 100,
      });
    });

    if (records.length === 0) return;

    const current = byStation.get(stationId) || {
      stationId,
      stationName: stationName || "",
      latitude,
      longitude,
      records: [],
    };

    if (!current.stationName && stationName) current.stationName = stationName;
    if (current.latitude == null && latitude != null) current.latitude = latitude;
    if (current.longitude == null && longitude != null) current.longitude = longitude;
    current.records.push(...records);
    byStation.set(stationId, current);
  });

  for (const station of byStation.values()) {
    const unique = new Map();
    for (const record of station.records) {
      unique.set(`${record.time}|${record.predictedTide}`, record);
    }
    station.records = [...unique.values()].sort(
      (a, b) => timeValue(a.time) - timeValue(b.time)
    );
  }

  return byStation;
}

function nearestForecast(records, targetTime) {
  if (!Array.isArray(records) || records.length === 0) return null;

  let low = 0;
  let high = records.length - 1;

  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    const midTime = timeValue(records[mid].time);

    if (midTime < targetTime) low = mid + 1;
    else high = mid - 1;
  }

  const candidates = [records[low], records[low - 1]].filter(Boolean);

  let best = null;
  let bestDiff = Infinity;

  for (const candidate of candidates) {
    const diff = Math.abs(timeValue(candidate.time) - targetTime);
    if (diff < bestDiff) {
      best = candidate;
      bestDiff = diff;
    }
  }

  return best && bestDiff <= MAX_MATCH_DIFF_MS
    ? { ...best, diffMs: bestDiff }
    : null;
}

function round2(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

function buildStations(observations, forecasts) {
  const stations = [];

  for (const [stationId, obsStation] of observations.entries()) {
    const forecastStation = forecasts.get(stationId);
    if (!forecastStation || forecastStation.records.length === 0) continue;

    const matched = [];

    for (const observation of obsStation.records) {
      const observationTime = timeValue(observation.time);
      const forecast = nearestForecast(forecastStation.records, observationTime);
      if (!forecast) continue;

      matched.push({
        time: observation.time,
        forecastTime: forecast.time,
        observedTide: round2(observation.tideHeight),
        predictedTide: round2(forecast.predictedTide),
        surgeAnomaly: round2(
          observation.tideHeight - forecast.predictedTide
        ),
      });
    }

    if (matched.length === 0) continue;

    matched.sort((a, b) => timeValue(a.time) - timeValue(b.time));
    const history = matched.slice(-MAX_HISTORY_POINTS);
    const latest = history.at(-1);

    stations.push({
      stationId,
      stationName:
        forecastStation.stationName || obsStation.stationName || stationId,
      latitude:
        forecastStation.latitude ?? obsStation.latitude ?? null,
      longitude:
        forecastStation.longitude ?? obsStation.longitude ?? null,
      observationTime: latest.time,
      forecastTime: latest.forecastTime,
      observedTide: latest.observedTide,
      predictedTide: latest.predictedTide,
      surgeAnomaly: latest.surgeAnomaly,
      history,
    });
  }

  return stations.sort((a, b) =>
    String(a.stationName).localeCompare(String(b.stationName), "zh-Hant")
  );
}

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({
      success: false,
      message: "Method Not Allowed",
    });
  }

  const apiKey = process.env.CWA_API_KEY;

  if (!apiKey) {
    return res.status(500).json({
      success: false,
      message: "CWA_API_KEY is not configured on Vercel",
    });
  }

  try {
    const [observationData, forecastData] = await Promise.all([
      fetchCwaDataset(OBS_DATA_ID, apiKey, "TideHeight"),
      fetchCwaDataset(FORECAST_DATA_ID, apiKey, "AboveChartDatum"),
    ]);

    const observations = extractObservationStations(observationData);
    const forecasts = extractForecastStations(forecastData);
    const stations = buildStations(observations, forecasts);

    const positiveStations = stations
      .filter((station) => Number(station.surgeAnomaly) > 0)
      .sort((a, b) => b.surgeAnomaly - a.surgeAnomaly);

    const maxPositive = positiveStations[0] || null;

    res.setHeader(
      "Cache-Control",
      "public, s-maxage=900, stale-while-revalidate=3600"
    );

    return res.status(200).json({
      success: true,
      generatedAt: new Date().toISOString(),
      definition:
        "暴潮偏差 = 實測潮高 - 同測站、相近時間的天文潮高（海圖基準）",
      units: "m",
      sources: {
        observation: OBS_DATA_ID,
        astronomicalTide: FORECAST_DATA_ID,
      },
      summary: {
        stationCount: stations.length,
        maxPositiveStationId: maxPositive?.stationId ?? null,
        maxPositiveStationName: maxPositive?.stationName ?? null,
        maxPositiveSurgeAnomaly: maxPositive?.surgeAnomaly ?? null,
      },
      diagnostics: {
        observationStations: observations.size,
        forecastStations: forecasts.size,
        matchedStations: stations.length,
        maxTimeDifferenceMinutes: MAX_MATCH_DIFF_MS / 60000,
      },
      stations,
    });
  } catch (error) {
    console.error("surge API failed:", error);

    return res.status(502).json({
      success: false,
      message: "Failed to build CWA surge data",
      error: error instanceof Error ? error.message : String(error),
      sources: {
        observation: OBS_DATA_ID,
        astronomicalTide: FORECAST_DATA_ID,
      },
    });
  }
}
