const OBS_DATA_ID = "O-B0075-001";
const FORECAST_DATA_ID = "F-C0036-001";
const MAX_HISTORY_POINTS = 72;
const MAX_INTERPOLATION_GAP_MS = 2 * 60 * 60 * 1000;
const MAX_NEAREST_DIFF_MS = 45 * 60 * 1000;

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
  const timestamp = Date.parse(normalized);

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

  if (bestName && bestNameScore >= 80) {
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

  let nearest = null;
  let nearestDistance = Infinity;

  for (const station of forecasts.values()) {
    const distance = distanceKm(
      obsStation.latitude,
      obsStation.longitude,
      station.latitude,
      station.longitude
    );

    if (distance < nearestDistance) {
      nearest = station;
      nearestDistance = distance;
    }
  }

  if (nearest && nearestDistance <= 5) {
    return {
      station: nearest,
      matchedBy: "coordinates",
      distanceKm: nearestDistance,
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
      targetTime - t1 <= MAX_INTERPOLATION_GAP_MS &&
      t2 - targetTime <= MAX_INTERPOLATION_GAP_MS &&
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

  const candidates = [before, after].filter(Boolean);
  let nearest = null;
  let nearestDiff = Infinity;

  for (const candidate of candidates) {
    const value = recordValue(candidate, datumKey);
    if (value == null) continue;

    const diff = Math.abs(timeValue(candidate.time) - targetTime);

    if (diff < nearestDiff) {
      nearest = { candidate, value };
      nearestDiff = diff;
    }
  }

  if (nearest && nearestDiff <= MAX_NEAREST_DIFF_MS) {
    return {
      value: nearest.value,
      time: nearest.candidate.time,
      method: "nearest",
      diffMs: nearestDiff,
    };
  }

  return null;
}

function round3(value) {
  return Math.round((Number(value) + Number.EPSILON) * 1000) / 1000;
}

function buildStations(observations, forecasts) {
  const stations = [];
  const unmatchedObservations = [];

  for (const obsStation of observations.values()) {
    const match = findForecastStation(obsStation, forecasts);

    if (!match) {
      unmatchedObservations.push({
        stationId: obsStation.stationId,
        stationName: obsStation.stationName,
      });
      continue;
    }

    const datum = datumForStation(obsStation);
    const forecastStation = match.station;
    const matched = [];

    for (const observation of obsStation.records) {
      const observationTime = timeValue(observation.time);
      if (!observationTime) continue;

      let prediction = forecastAtTime(
        forecastStation.records,
        observationTime,
        datum.key
      );

      // 少數站可能缺 TWVD；若有此情況，退回 Local MSL，但把實際使用基準標出。
      let effectiveDatum = datum;

      if (!prediction && datum.key === "aboveTWVD") {
        prediction = forecastAtTime(
          forecastStation.records,
          observationTime,
          "aboveLocalMSL"
        );

        if (prediction) {
          effectiveDatum = {
            key: "aboveLocalMSL",
            code: "LOCAL_MSL_FALLBACK",
            label: "當地平均海平面（Local MSL，TWVD 缺值時退回）",
          };
        }
      }

      if (!prediction) continue;

      matched.push({
        time: observation.time,
        forecastTime: prediction.time,
        forecastSourceTimes: prediction.sourceTimes || null,
        forecastMethod: prediction.method,
        observedTide: round3(observation.tideHeight),
        predictedTide: round3(prediction.value),
        surgeAnomaly: round3(
          observation.tideHeight - prediction.value
        ),
        datum: effectiveDatum.code,
        datumLabel: effectiveDatum.label,
      });
    }

    if (matched.length === 0) continue;

    matched.sort((a, b) => timeValue(a.time) - timeValue(b.time));
    const history = matched.slice(-MAX_HISTORY_POINTS);
    const latest = history.at(-1);

    stations.push({
      stationId: obsStation.stationId,
      forecastStationId: forecastStation.stationId,
      stationName:
        forecastStation.stationName ||
        obsStation.stationName ||
        obsStation.stationId,
      latitude:
        forecastStation.latitude ?? obsStation.latitude ?? null,
      longitude:
        forecastStation.longitude ?? obsStation.longitude ?? null,
      matchedBy: match.matchedBy,
      matchDistanceKm:
        Number.isFinite(match.distanceKm)
          ? round3(match.distanceKm)
          : null,
      datum: latest.datum,
      datumLabel: latest.datumLabel,
      observationTime: latest.time,
      forecastTime: latest.forecastTime,
      observedTide: latest.observedTide,
      predictedTide: latest.predictedTide,
      surgeAnomaly: latest.surgeAnomaly,
      history,
    });
  }

  return {
    stations: stations.sort((a, b) =>
      String(a.stationName).localeCompare(
        String(b.stationName),
        "zh-Hant"
      )
    ),
    unmatchedObservations,
  };
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
    const [observationResult, forecastResult] = await Promise.all([
      loadObservationStations(apiKey),
      loadForecastStations(apiKey),
    ]);

    const observations = observationResult.stations;
    const forecasts = forecastResult.stations;

    const { stations, unmatchedObservations } = buildStations(
      observations,
      forecasts
    );

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
        "暴潮偏差 = 實測潮高 - 同測站、同潮位基準的天文潮高",
      method:
        "逐時天文潮先線性內插到實測時間；本島優先 TWVD，離島優先 Local MSL。",
      units: "m",
      sources: {
        observation: OBS_DATA_ID,
        astronomicalTide: FORECAST_DATA_ID,
      },
      summary: {
        stationCount: stations.length,
        maxPositiveStationId: maxPositive?.stationId ?? null,
        maxPositiveStationName: maxPositive?.stationName ?? null,
        maxPositiveSurgeAnomaly:
          maxPositive?.surgeAnomaly ?? null,
      },
      diagnostics: {
        observationStations: observations.size,
        forecastStations: forecasts.size,
        matchedStations: stations.length,
        observationLoader: observationResult.diagnostics,
        forecastLoader: forecastResult.diagnostics,
        unmatchedObservationCount: unmatchedObservations.length,
        unmatchedObservations: unmatchedObservations.slice(0, 20),
      },
      stations,
    });
  } catch (error) {
    console.error("surge API failed:", error);

    return res.status(502).json({
      success: false,
      message: "Failed to build CWA surge data",
      error:
        error instanceof Error
          ? error.message
          : String(error),
      sources: {
        observation: OBS_DATA_ID,
        astronomicalTide: FORECAST_DATA_ID,
      },
    });
  }
}
