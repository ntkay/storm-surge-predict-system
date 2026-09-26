import { useEffect, useMemo, useState } from "react";
import {
  MapContainer,
  Pane,
  WMSTileLayer,
  Marker,
  Polyline,
  Popup,
  Tooltip,
} from "react-leaflet";
import L from "leaflet";

delete L.Icon.Default.prototype._getIconUrl;

L.Icon.Default.mergeOptions({
  iconRetinaUrl:
    "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
  iconUrl:
    "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
  shadowUrl:
    "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
});

const BASE_URL = import.meta.env.BASE_URL;
const LIVE_POLL_MS = 15 * 60 * 1000;

const MAP_LABELS = [
  { name: "台灣", position: [23.7, 121.0] },
  { name: "沖繩", position: [26.2124, 127.6792] },
  { name: "日本", position: [34.8, 139.3] },
  { name: "菲律賓", position: [14.6, 121.0] },
  { name: "關島", position: [13.44, 144.79] },
];

// 固定平面視角：用 center + zoom 鎖定畫面，而不是 fitBounds。
// 這樣寬螢幕不會因為 bounds 長寬比不同而在右側露出衛星圖外的深藍空白。
// 範圍主要保留：台灣、沖繩、菲律賓、關島與目前颱風路徑。
const FIXED_MAP_CENTER = [20.5, 134.2];
const FIXED_MAP_ZOOM = 5.2;

// 改用 NASA GIBS 的 Himawari AHI 地球同步衛星 WMS。
// 它不是單張固定範圍 JPG，因此縮到 5.2 時不會因為超出圖片邊界而露出深藍空白。
const HIMAWARI_WMS_URL =
  "https://gibs.earthdata.nasa.gov/wms/epsg3857/best/wms.cgi";

function normalizePacificLongitude(value) {
  const lon = Number(value);
  if (!Number.isFinite(lon)) return lon;
  return lon < 0 ? lon + 360 : lon;
}

function getCwaTimeValue(value) {
  if (!value) return 0;

  const normalized = String(value).trim().replace(" ", "T");
  const timestamp = Date.parse(normalized);

  return Number.isFinite(timestamp) ? timestamp : 0;
}

function getLiveSystemDisplayName(cyclone) {
  if (!cyclone) return "未命名熱帶系統";

  const name =
    cyclone.CwaTyphoonName ||
    cyclone.TyphoonName ||
    "未命名";

  if (cyclone.CwaTyNo) {
    return `${name}颱風`;
  }

  if (cyclone.CwaTdNo) {
    return `${name}（熱帶性低氣壓）`;
  }

  return `${name}（熱帶系統）`;
}

function App() {
  const [now, setNow] = useState(new Date());

  const [cwaTyphoon, setCwaTyphoon] = useState(null);
  const [cwaLoading, setCwaLoading] = useState(true);
  const [cwaError, setCwaError] = useState("");
  const [selectedLiveKey, setSelectedLiveKey] = useState("");
  const [liveSelectionMode, setLiveSelectionMode] = useState("auto");
  const [lastCwaFetchAt, setLastCwaFetchAt] = useState(null);

  const [surgeData, setSurgeData] = useState(null);
  const [surgeLoading, setSurgeLoading] = useState(true);
  const [surgeError, setSurgeError] = useState("");
  const [selectedSurgeStationId, setSelectedSurgeStationId] = useState("");
  const [lastSurgeFetchAt, setLastSurgeFetchAt] = useState(null);

  const [historyTyphoons, setHistoryTyphoons] = useState([]);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [historyError, setHistoryError] = useState("");

  const [historySearch, setHistorySearch] = useState("");
  const [historyYear, setHistoryYear] = useState("全部");
  const [selectedSid, setSelectedSid] = useState("");

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    let cancelled = false;

    const fetchCwaData = async () => {
      try {
        const liveUrl = `/api/typhoon?t=${Date.now()}`;
        const response = await fetch(liveUrl, { cache: "no-store" });

        if (!response.ok) {
          throw new Error(`即時資料 HTTP ${response.status}`);
        }

        const contentType = response.headers.get("content-type") || "";

        if (!contentType.includes("application/json")) {
          const rawText = await response.text();
          throw new Error(
            `即時資料不是 JSON：${rawText.slice(0, 100)}`
          );
        }

        const data = await response.json();

        if (cancelled) return;

        setCwaTyphoon(data);
        setCwaError("");
        setLastCwaFetchAt(new Date());
      } catch (error) {
        if (cancelled) return;

        console.error("讀取中央氣象署資料失敗：", error);
        setCwaError("讀取中央氣象署即時資料失敗");
      } finally {
        if (!cancelled) {
          setCwaLoading(false);
        }
      }
    };

    // 開啟網站立即檢查一次。
    fetchCwaData();

    // CWA 原始觀測大約每 6 小時更新；網站每 15 分鐘檢查一次即可。
    // 一旦 CWA 發布新資料，最晚約下一次輪詢就會抓到。
    const timer = window.setInterval(fetchCwaData, LIVE_POLL_MS);

    // 使用者切回分頁時再立即檢查一次，避免長時間背景分頁顯示舊資料。
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        fetchCwaData();
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
      document.removeEventListener(
        "visibilitychange",
        handleVisibilityChange
      );
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    const fetchSurgeData = async () => {
      try {
        const response = await fetch("/api/surge", { cache: "no-store" });

        if (!response.ok) {
          throw new Error(`暴潮資料 HTTP ${response.status}`);
        }

        const contentType = response.headers.get("content-type") || "";

        if (!contentType.includes("application/json")) {
          const rawText = await response.text();
          throw new Error(
            `暴潮資料不是 JSON：${rawText.slice(0, 100)}`
          );
        }

        const data = await response.json();

        if (cancelled) return;

        if (data?.success === false) {
          throw new Error(data?.message || "中央氣象署暴潮資料處理失敗");
        }

        setSurgeData(data);
        setSurgeError("");
        setLastSurgeFetchAt(new Date());
      } catch (error) {
        if (cancelled) return;

        console.error("讀取暴潮／潮位資料失敗：", error);
        setSurgeError(
          error instanceof Error
            ? error.message
            : "讀取中央氣象署暴潮資料失敗"
        );
      } finally {
        if (!cancelled) {
          setSurgeLoading(false);
        }
      }
    };

    fetchSurgeData();

    const timer = window.setInterval(fetchSurgeData, LIVE_POLL_MS);

    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        fetchSurgeData();
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
      document.removeEventListener(
        "visibilitychange",
        handleVisibilityChange
      );
    };
  }, []);

  useEffect(() => {
    fetch(`${BASE_URL}data/typhoons.json?t=${Date.now()}`)
      .then((response) => {
        if (!response.ok) {
          throw new Error(`歷史資料 HTTP ${response.status}`);
        }
        return response.json();
      })
      .then((data) => {
        const validData = Array.isArray(data) ? data : [];
        setHistoryTyphoons(validData);
        setSelectedSid("");
        setHistoryLoading(false);
      })
      .catch((error) => {
        console.error("讀取歷史颱風資料失敗：", error);
        setHistoryError("讀取歷史颱風資料失敗");
        setHistoryLoading(false);
      });
  }, []);

  const liveCyclones = useMemo(() => {
    const raw =
      cwaTyphoon?.records?.TropicalCyclones?.TropicalCyclone;

    const cyclones = Array.isArray(raw)
      ? raw
      : raw
        ? [raw]
        : [];

    return cyclones
      .map((cyclone, index) => {
        const rawFixes = cyclone?.AnalysisData?.Fix;

        const fixes = Array.isArray(rawFixes)
          ? rawFixes
          : rawFixes
            ? [rawFixes]
            : [];

        const sortedFixes = [...fixes].sort(
          (a, b) =>
            getCwaTimeValue(a?.DateTime) -
            getCwaTimeValue(b?.DateTime)
        );

        const latestFix = sortedFixes.at(-1) ?? null;
        const latestTime = getCwaTimeValue(latestFix?.DateTime);

        const identity =
          cyclone?.CwaTyNo ||
          cyclone?.CwaTdNo ||
          cyclone?.TyphoonName ||
          cyclone?.CwaTyphoonName ||
          `system-${index}`;

        return {
          key: `${identity}-${index}`,
          cyclone,
          fixes: sortedFixes,
          latestFix,
          latestTime,
        };
      })
      .filter((item) => item.latestFix)
      .sort((a, b) => {
        if (b.latestTime !== a.latestTime) {
          return b.latestTime - a.latestTime;
        }

        return a.key.localeCompare(b.key);
      });
  }, [cwaTyphoon]);

  useEffect(() => {
    if (liveCyclones.length === 0) {
      setSelectedLiveKey("");
      setLiveSelectionMode("auto");
      return;
    }

    const selectedStillExists =
      selectedLiveKey &&
      liveCyclones.some((item) => item.key === selectedLiveKey);

    if (liveSelectionMode === "auto") {
      setSelectedLiveKey(liveCyclones[0].key);
      return;
    }

    if (!selectedStillExists) {
      setLiveSelectionMode("auto");
      setSelectedLiveKey(liveCyclones[0].key);
    }
  }, [liveCyclones, selectedLiveKey, liveSelectionMode]);

  const selectedLive =
    liveCyclones.find((item) => item.key === selectedLiveKey) ??
    liveCyclones[0] ??
    null;

  const liveCyclone = selectedLive?.cyclone ?? null;
  const liveFixes = selectedLive?.fixes ?? [];
  const latestLiveFix = selectedLive?.latestFix ?? null;

  const livePath = useMemo(
    () =>
      liveFixes
        .map((fix) => [
          Number(fix.CoordinateLatitude),
          normalizePacificLongitude(fix.CoordinateLongitude),
        ])
        .filter(([lat, lon]) => Number.isFinite(lat) && Number.isFinite(lon)),
    [liveFixes]
  );

  const liveTrackPoints = useMemo(
    () =>
      liveFixes
        .map((fix) => ({
          position: [
            Number(fix.CoordinateLatitude),
            normalizePacificLongitude(fix.CoordinateLongitude),
          ],
          time: fix.DateTime ?? "—",
          wind: fix.MaxWindSpeed ?? null,
          pressure: fix.Pressure ?? null,
        }))
        .filter(
          (point) =>
            Number.isFinite(point.position[0]) &&
            Number.isFinite(point.position[1])
        ),
    [liveFixes]
  );

  const historyYears = useMemo(
    () => [
      "全部",
      ...[...new Set(historyTyphoons.map((item) => item.year))]
        .filter(Boolean)
        .sort((a, b) => b - a),
    ],
    [historyTyphoons]
  );

  const filteredHistory = useMemo(() => {
    const keyword = historySearch.trim().toUpperCase();

    return historyTyphoons
      .filter((item) => {
        const matchName =
          !keyword ||
          item.name?.toUpperCase().includes(keyword) ||
          item.sid?.toUpperCase().includes(keyword);

        const matchYear =
          historyYear === "全部" ||
          String(item.year) === String(historyYear);

        return matchName && matchYear;
      })
      .sort((a, b) => {
        if (a.source === "CWA-live" && b.source !== "CWA-live") return -1;
        if (b.source === "CWA-live" && a.source !== "CWA-live") return 1;

        if (Number(b.year) !== Number(a.year)) {
          return Number(b.year) - Number(a.year);
        }

        return String(b.sid ?? "").localeCompare(String(a.sid ?? ""));
      });
  }, [historyTyphoons, historySearch, historyYear]);

  useEffect(() => {
    if (filteredHistory.length === 0) {
      setSelectedSid("");
      return;
    }

    const selectedStillVisible =
      selectedSid &&
      filteredHistory.some((item) => item.sid === selectedSid);

    if (selectedStillVisible) return;

    const liveTyphoon = filteredHistory.find(
      (item) => item.source === "CWA-live"
    );

    setSelectedSid(
      liveTyphoon?.sid ?? filteredHistory[0].sid
    );
  }, [filteredHistory, selectedSid]);

  const selectedTyphoon =
    historyTyphoons.find((item) => item.sid === selectedSid) ??
    filteredHistory[0] ??
    null;

  const selectedTrack = selectedTyphoon?.track ?? [];

  const selectedPath = useMemo(
    () =>
      selectedTrack
        .map((point) => [
          Number(point.lat),
          normalizePacificLongitude(point.lon),
        ])
        .filter(([lat, lon]) => Number.isFinite(lat) && Number.isFinite(lon)),
    [selectedTrack]
  );

  const selectedTrackPoints = useMemo(
    () =>
      selectedTrack
        .map((point) => ({
          position: [
            Number(point.lat),
            normalizePacificLongitude(point.lon),
          ],
          time: point.time ?? "—",
          wind: point.wind ?? null,
          pressure: point.pressure ?? null,
        }))
        .filter(
          (point) =>
            Number.isFinite(point.position[0]) &&
            Number.isFinite(point.position[1])
        ),
    [selectedTrack]
  );

  const selectedStats = useMemo(() => {
    if (!selectedTyphoon) {
      return {
        maxWind: 0,
        minPressure: null,
        startTime: "—",
        endTime: "—",
        trackCount: 0,
      };
    }

    const winds = selectedTrack
      .map((point) => Number(point.wind))
      .filter(Number.isFinite);

    const pressures = selectedTrack
      .map((point) => Number(point.pressure))
      .filter(Number.isFinite);

    return {
      maxWind: winds.length ? Math.max(...winds) : 0,
      minPressure: pressures.length ? Math.min(...pressures) : null,
      startTime: selectedTrack[0]?.time ?? "—",
      endTime: selectedTrack.at(-1)?.time ?? "—",
      trackCount: selectedTrack.length,
    };
  }, [selectedTyphoon, selectedTrack]);

  const surgeStations = useMemo(
    () => (Array.isArray(surgeData?.stations) ? surgeData.stations : []),
    [surgeData]
  );

  useEffect(() => {
    if (surgeStations.length === 0) {
      setSelectedSurgeStationId("");
      return;
    }

    const selectedStillExists =
      selectedSurgeStationId &&
      surgeStations.some(
        (station) => station.stationId === selectedSurgeStationId
      );

    if (selectedStillExists) return;

    setSelectedSurgeStationId(
      surgeData?.summary?.maxPositiveStationId ||
        surgeStations[0].stationId
    );
  }, [surgeStations, selectedSurgeStationId, surgeData]);

  const selectedSurgeStation =
    surgeStations.find(
      (station) => station.stationId === selectedSurgeStationId
    ) ??
    surgeStations[0] ??
    null;

  const liveWind = Number(latestLiveFix?.MaxWindSpeed ?? 0);
  const livePressure = Number(latestLiveFix?.Pressure ?? 0);
  const liveRisk = getRisk(liveWind, livePressure);

  return (
    <div style={pageStyle}>
      <div style={{ maxWidth: "1280px", margin: "0 auto" }}>
        <header style={headerStyle}>
          <h1 style={{ margin: 0, fontSize: "42px", fontWeight: 800 }}>
            暴潮預測與颱風資料系統
          </h1>
          <p style={{ margin: "12px 0 0", fontSize: "18px", opacity: 0.92 }}>
            整合中央氣象署即時資料與 2000 年至今的 IBTrACS 歷史路徑資料
          </p>
        </header>

        <section style={summaryGridStyle}>
          <InfoCard
            title="今日日期"
            value={now.toLocaleDateString("zh-TW")}
            sub="系統即時更新"
          />
          <InfoCard
            title="目前時間"
            value={now.toLocaleTimeString("zh-TW")}
            sub="每秒自動刷新"
          />
          <InfoCard
            title="歷史颱風數量"
            value={historyLoading ? "讀取中" : historyTyphoons.length}
            sub="2000 年至今的西北太平洋資料"
          />
          <InfoCard
            title="目前風險"
            value={liveCyclone ? liveRisk.label : "無即時資料"}
            sub="依即時風速與氣壓進行示範判斷"
            accent={liveCyclone ? liveRisk.textColor : "#64748b"}
          />
        </section>

        <LiveTyphoonPanel
          cyclone={liveCyclone}
          latestFix={latestLiveFix}
          loading={cwaLoading}
          error={cwaError}
          risk={liveRisk}
          cyclones={liveCyclones}
          selectedLiveKey={selectedLiveKey}
          liveSelectionMode={liveSelectionMode}
          onSelectLive={(value) => {
            if (value === "__AUTO__") {
              setLiveSelectionMode("auto");
              setSelectedLiveKey(liveCyclones[0]?.key ?? "");
              return;
            }

            setLiveSelectionMode("manual");
            setSelectedLiveKey(value);
          }}
          lastFetchAt={lastCwaFetchAt}
        />

        <TyphoonMap
          title="中央氣象署即時熱帶系統路徑"
          path={livePath}
          trackPoints={liveTrackPoints}
          emptyText="目前沒有可顯示的即時颱風路徑"
          windUnit="m/s"
          showAllPoints
        />

        <SurgePanel
          data={surgeData}
          stations={surgeStations}
          station={selectedSurgeStation}
          selectedStationId={selectedSurgeStationId}
          onSelectStation={setSelectedSurgeStationId}
          loading={surgeLoading}
          error={surgeError}
          lastFetchAt={lastSurgeFetchAt}
        />

        <section style={cardStyle}>
          <div style={{ marginBottom: "20px" }}>
            <h2 style={sectionTitleStyle}>歷史颱風查詢</h2>
            <p style={sectionSubStyle}>
              依年份或英文名稱搜尋，點選颱風後地圖與統計會同步更新。
            </p>
          </div>

          <div style={filterGridStyle}>
            <div>
              <label style={labelStyle}>搜尋颱風名稱或 SID</label>
              <input
                value={historySearch}
                onChange={(event) => setHistorySearch(event.target.value)}
                placeholder="例如：BILIS、HAIKUI"
                style={inputStyle}
              />
            </div>

            <div>
              <label style={labelStyle}>年份</label>
              <select
                value={historyYear}
                onChange={(event) => setHistoryYear(event.target.value)}
                style={inputStyle}
              >
                {historyYears.map((year) => (
                  <option key={year} value={year}>
                    {year}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label style={labelStyle}>符合資料</label>
              <div style={countBoxStyle}>
                {historyLoading ? "讀取中..." : `${filteredHistory.length} 筆`}
              </div>
            </div>
          </div>

          {historyError && <ErrorMessage>{historyError}</ErrorMessage>}

          {!historyLoading && !historyError && (
            <div style={historyLayoutStyle}>
              <div style={historyListStyle}>
                {filteredHistory.length === 0 ? (
                  <div style={emptyStyle}>查無符合條件的颱風</div>
                ) : (
                  filteredHistory.slice(0, 250).map((typhoon) => {
                    const active = typhoon.sid === selectedTyphoon?.sid;

                    return (
                      <button
                        key={typhoon.sid}
                        type="button"
                        onClick={() => setSelectedSid(typhoon.sid)}
                        style={{
                          ...historyButtonStyle,
                          borderColor: active ? "#2563eb" : "#e2e8f0",
                          background: active ? "#eff6ff" : "#fff",
                        }}
                      >
                        <strong style={{ color: "#123c66" }}>
                          {typhoon.name || "未命名"}
                        </strong>
                        <span style={{ color: "#64748b", fontSize: "13px" }}>
                          {typhoon.year} · {typhoon.sid}
                        </span>
                      </button>
                    );
                  })
                )}

                {filteredHistory.length > 250 && (
                  <p style={{ color: "#64748b", fontSize: "13px" }}>
                    為避免畫面過重，目前只顯示前 250 筆；可用搜尋與年份縮小範圍。
                  </p>
                )}
              </div>

              <div>
                {selectedTyphoon ? (
                  <>
                    <div style={selectedHeaderStyle}>
                      <div>
                        <div style={{ color: "#64748b", fontSize: "14px" }}>
                          已選擇歷史颱風
                        </div>
                        <h3 style={{ margin: "6px 0 0", fontSize: "30px" }}>
                          {selectedTyphoon.name || "未命名"}（
                          {selectedTyphoon.year}）
                        </h3>
                      </div>
                      <span style={sidBadgeStyle}>{selectedTyphoon.sid}</span>
                    </div>

                    <div style={statsGridStyle}>
                      <StatCard
                        title="最大風速"
                        value={`${selectedStats.maxWind} kt`}
                      />
                      <StatCard
                        title="最低氣壓"
                        value={
                          selectedStats.minPressure === null
                            ? "無資料"
                            : `${selectedStats.minPressure} hPa`
                        }
                      />
                      <StatCard
                        title="路徑點數"
                        value={selectedStats.trackCount}
                      />
                      <StatCard
                        title="資料期間"
                        value={`${formatDateTime(
                          selectedStats.startTime
                        )} ～ ${formatDateTime(selectedStats.endTime)}`}
                        small
                      />
                    </div>
                  </>
                ) : (
                  <div style={emptyStyle}>請選擇一筆歷史颱風</div>
                )}
              </div>
            </div>
          )}
        </section>

        <TyphoonMap
          key={selectedTyphoon?.sid || "history-empty"}
          title={
            selectedTyphoon
              ? `${selectedTyphoon.name}（${selectedTyphoon.year}）歷史路徑`
              : "歷史颱風路徑"
          }
          path={selectedPath}
          trackPoints={selectedTrackPoints}
          emptyText="請先選擇一筆歷史颱風"
          windUnit="kt"
          showAllPoints={false}
        />

        {selectedTyphoon && (
          <section style={cardStyle}>
            <h2 style={sectionTitleStyle}>歷史路徑明細</h2>
            <p style={sectionSubStyle}>
              風速單位為 kt；部分時段的氣壓或風速可能缺值。
            </p>

            <div style={{ overflowX: "auto" }}>
              <table style={tableStyle}>
                <thead>
                  <tr style={{ background: "#eff6ff" }}>
                    <TableHead>時間</TableHead>
                    <TableHead>緯度</TableHead>
                    <TableHead>經度</TableHead>
                    <TableHead>風速</TableHead>
                    <TableHead>氣壓</TableHead>
                  </tr>
                </thead>
                <tbody>
                  {selectedTrack.map((point, index) => (
                    <tr
                      key={`${selectedTyphoon.sid}-${point.time}-${index}`}
                      style={{ borderBottom: "1px solid #e5e7eb" }}
                    >
                      <TableCell>{point.time || "—"}</TableCell>
                      <TableCell>{point.lat ?? "—"}</TableCell>
                      <TableCell>{point.lon ?? "—"}</TableCell>
                      <TableCell>
                        {point.wind == null ? "—" : `${point.wind} kt`}
                      </TableCell>
                      <TableCell>
                        {point.pressure == null
                          ? "—"
                          : `${point.pressure} hPa`}
                      </TableCell>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}
      </div>
    </div>
  );
}

function LiveTyphoonPanel({
  cyclone,
  latestFix,
  loading,
  error,
  risk,
  cyclones = [],
  selectedLiveKey,
  liveSelectionMode,
  onSelectLive,
  lastFetchAt,
}) {
  if (loading) {
    return (
      <section style={cardStyle}>
        <h2 style={sectionTitleStyle}>中央氣象署即時資料</h2>
        <p style={{ color: "#64748b" }}>資料讀取中...</p>
      </section>
    );
  }

  if (error) {
    return (
      <section style={cardStyle}>
        <h2 style={sectionTitleStyle}>中央氣象署即時資料</h2>
        <ErrorMessage>{error}</ErrorMessage>
      </section>
    );
  }

  if (!cyclone || !latestFix) {
    return (
      <section style={cardStyle}>
        <h2 style={sectionTitleStyle}>中央氣象署即時資料</h2>
        <p style={{ color: "#64748b" }}>
          目前沒有活動中的熱帶氣旋資料。
        </p>

        <p style={{ color: "#94a3b8", fontSize: "13px" }}>
          網站仍會每 15 分鐘重新檢查中央氣象署資料。
        </p>
      </section>
    );
  }

  const wind = Number(latestFix.MaxWindSpeed ?? 0);
  const pressure = Number(latestFix.Pressure ?? 0);

  return (
    <section style={cardStyle}>
      {cyclones.length > 1 && (
        <div
          style={{
            marginBottom: "20px",
            maxWidth: "520px",
          }}
        >
          <label style={labelStyle}>活動中的熱帶系統</label>

          <select
            value={
              liveSelectionMode === "auto"
                ? "__AUTO__"
                : selectedLiveKey
            }
            onChange={(event) => onSelectLive(event.target.value)}
            style={inputStyle}
          >
            <option value="__AUTO__">
              自動選擇最新更新的熱帶系統
            </option>

            {cyclones.map((item) => (
              <option key={item.key} value={item.key}>
                {getLiveSystemDisplayName(item.cyclone)}
                {" · "}
                {item.cyclone.CwaTyNo ||
                  item.cyclone.CwaTdNo ||
                  "無編號"}
                {" · "}
                {formatDateTime(item.latestFix?.DateTime)}
              </option>
            ))}
          </select>
        </div>
      )}

      <div style={selectedHeaderStyle}>
        <div>
          <div style={{ color: "#64748b", fontSize: "14px" }}>
            中央氣象署活動熱帶系統
          </div>

          <h2 style={{ margin: "6px 0 0", color: "#123c66" }}>
            {getLiveSystemDisplayName(cyclone)}
          </h2>

          <p style={{ color: "#64748b", marginBottom: 0 }}>
            國際名稱：{cyclone.TyphoonName || "—"}　編號：
            {cyclone.CwaTyNo || cyclone.CwaTdNo || "—"}
          </p>
        </div>

        <span style={sidBadgeStyle}>
          {formatDateTime(latestFix.DateTime)}
        </span>
      </div>

      <div style={statsGridStyle}>
        <StatCard title="最大風速" value={`${wind} m/s`} />
        <StatCard title="中心氣壓" value={`${pressure} hPa`} />
        <StatCard
          title="移動速度"
          value={`${latestFix.MovingSpeed || 0} km/h`}
        />
        <StatCard
          title="移動方向"
          value={latestFix.MovingDirection || "—"}
        />
        <StatCard title="風險等級" value={risk.label} />
      </div>

      <div
        style={{
          marginTop: "16px",
          padding: "12px 14px",
          borderRadius: "12px",
          background: "#f8fafc",
          color: "#64748b",
          fontSize: "13px",
          lineHeight: 1.8,
        }}
      >
        <div>
          CWA 最新觀測：
          <strong style={{ color: "#334155" }}>
            {formatDateTime(latestFix.DateTime)}
          </strong>
        </div>

        <div>
          網站最後檢查：
          <strong style={{ color: "#334155" }}>
            {lastFetchAt
              ? lastFetchAt.toLocaleString("zh-TW")
              : "—"}
          </strong>
        </div>

        <div>
          網站每 15 分鐘檢查一次。中央氣象署原始熱帶氣旋資料通常約
          6 小時更新一次，因此兩次檢查之間可能仍是同一筆觀測。
        </div>
      </div>

    </section>
  );
}


function SurgePanel({
  data,
  stations,
  station,
  selectedStationId,
  onSelectStation,
  loading,
  error,
  lastFetchAt,
}) {
  if (loading) {
    return (
      <section style={cardStyle}>
        <h2 style={sectionTitleStyle}>🌊 即時暴潮／潮位監測</h2>
        <p style={{ color: "#64748b" }}>正在讀取潮位與天文潮預報...</p>
      </section>
    );
  }

  if (error) {
    return (
      <section style={cardStyle}>
        <h2 style={sectionTitleStyle}>🌊 即時暴潮／潮位監測</h2>
        <ErrorMessage>{error}</ErrorMessage>
        <p style={{ color: "#64748b", fontSize: "13px" }}>
          請先確認 Vercel 已部署 api/surge.js，且 CWA_API_KEY 環境變數有效。
        </p>
      </section>
    );
  }

  if (!station || stations.length === 0) {
    return (
      <section style={cardStyle}>
        <h2 style={sectionTitleStyle}>🌊 即時暴潮／潮位監測</h2>
        <p style={{ color: "#64748b" }}>
          目前找不到可同時配對「實測潮高」與「天文潮高」的潮位站。
        </p>
        {data?.diagnostics && (
          <pre style={diagnosticStyle}>
            {JSON.stringify(data.diagnostics, null, 2)}
          </pre>
        )}
      </section>
    );
  }

  const anomaly = Number(station.surgeAnomaly);
  const anomalyColor =
    anomaly > 0.3 ? "#b91c1c" : anomaly > 0 ? "#b45309" : "#0369a1";

  return (
    <section style={cardStyle}>
      <div style={selectedHeaderStyle}>
        <div>
          <div style={{ color: "#64748b", fontSize: "14px" }}>
            中央氣象署潮位觀測 × 逐時天文潮預報
          </div>
          <h2 style={{ ...sectionTitleStyle, marginTop: "6px" }}>
            🌊 即時暴潮偏差監測
          </h2>
          <p style={{ ...sectionSubStyle, marginBottom: 0 }}>
            暴潮偏差＝實測潮高－同一基準面的天文潮高。程式會依測站使用 TWVD 或當地平均海平面（Local MSL）配對；正值表示實際海面高於天文潮預期。
          </p>
        </div>

        <span style={sidBadgeStyle}>
          API 最後檢查：
          {lastFetchAt ? lastFetchAt.toLocaleString("zh-TW") : "—"}
        </span>
      </div>

      <div style={{ maxWidth: "520px", marginBottom: "20px" }}>
        <label style={labelStyle}>潮位站</label>
        <select
          value={selectedStationId}
          onChange={(event) => onSelectStation(event.target.value)}
          style={inputStyle}
        >
          {stations.map((item) => (
            <option key={item.stationId} value={item.stationId}>
              {item.stationName || item.stationId} · {item.stationId}
              {Number.isFinite(Number(item.surgeAnomaly))
                ? ` · ${formatSigned(Number(item.surgeAnomaly))} m`
                : ""}
            </option>
          ))}
        </select>
      </div>

      <div style={statsGridStyle}>
        <StatCard
          title="實測潮高"
          value={`${formatNumber(station.observedTide, 2)} m`}
        />
        <StatCard
          title="天文潮高"
          value={`${formatNumber(station.predictedTide, 2)} m`}
        />
        <div style={statCardStyle}>
          <div style={{ color: "#64748b", fontSize: "14px", fontWeight: 700 }}>
            暴潮偏差
          </div>
          <div
            style={{
              color: anomalyColor,
              fontSize: "28px",
              lineHeight: 1.5,
              fontWeight: 900,
              marginTop: "8px",
            }}
          >
            {formatSigned(anomaly)} m
          </div>
        </div>
        <StatCard
          title="觀測時間"
          value={formatDateTime(station.observationTime)}
          small
        />
      </div>

      <div style={surgeMetaGridStyle}>
        <div>
          <strong>預報配對時間：</strong>
          {formatDateTime(station.forecastTime)}
        </div>
        <div>
          <strong>測站位置：</strong>
          {station.latitude == null || station.longitude == null
            ? "—"
            : `${Number(station.latitude).toFixed(4)}, ${Number(
                station.longitude
              ).toFixed(4)}`}
        </div>
        <div>
          <strong>潮位基準：</strong>
          {station.datumLabel || station.datum || "—"}
        </div>
        <div>
          <strong>配對方式：</strong>
          {station.matchedBy || "—"}
        </div>
        <div>
          <strong>資料來源：</strong>O-B0075-001 ＋ F-C0036-001
        </div>
      </div>

      <SurgeChart history={station.history || []} />

      <div style={{ overflowX: "auto", marginTop: "18px" }}>
        <table style={tableStyle}>
          <thead>
            <tr style={{ background: "#eff6ff" }}>
              <TableHead>時間</TableHead>
              <TableHead>實測潮高</TableHead>
              <TableHead>天文潮高</TableHead>
              <TableHead>暴潮偏差</TableHead>
            </tr>
          </thead>
          <tbody>
            {(station.history || [])
              .slice(-10)
              .reverse()
              .map((point, index) => (
                <tr
                  key={`${station.stationId}-${point.time}-${index}`}
                  style={{ borderBottom: "1px solid #e5e7eb" }}
                >
                  <TableCell>{formatDateTime(point.time)}</TableCell>
                  <TableCell>
                    {formatNumber(point.observedTide, 2)} m
                  </TableCell>
                  <TableCell>
                    {formatNumber(point.predictedTide, 2)} m
                  </TableCell>
                  <TableCell>
                    <span
                      style={{
                        fontWeight: 800,
                        color:
                          Number(point.surgeAnomaly) > 0
                            ? "#b45309"
                            : "#0369a1",
                      }}
                    >
                      {formatSigned(Number(point.surgeAnomaly))} m
                    </span>
                  </TableCell>
                </tr>
              ))}
          </tbody>
        </table>
      </div>

      <p style={{ color: "#64748b", fontSize: "13px", marginBottom: 0 }}>
        此區顯示的是「暴潮偏差（Surge Anomaly）」：實測水位減去估算天文潮位。程式會以同一測站、同一潮位基準配對，並將逐時天文潮線性內插到實測時間。
      </p>
    </section>
  );
}

function SurgeChart({ history }) {
  const points = Array.isArray(history) ? history.slice(-24) : [];

  if (points.length < 2) {
    return (
      <div style={{ ...emptyStyle, marginTop: "18px" }}>
        暫時沒有足夠的配對資料可繪製趨勢。
      </div>
    );
  }

  const values = points
    .map((point) => Number(point.surgeAnomaly))
    .filter(Number.isFinite);

  if (values.length < 2) return null;

  const width = 1000;
  const height = 260;
  const paddingX = 52;
  const paddingY = 28;
  const minValue = Math.min(0, ...values);
  const maxValue = Math.max(0, ...values);
  const span = Math.max(0.1, maxValue - minValue);

  const xFor = (index) =>
    paddingX +
    (index * (width - paddingX * 2)) / Math.max(1, points.length - 1);

  const yFor = (value) =>
    paddingY +
    ((maxValue - value) / span) * (height - paddingY * 2);

  const linePoints = points
    .map((point, index) => {
      const value = Number(point.surgeAnomaly);
      return Number.isFinite(value)
        ? `${xFor(index)},${yFor(value)}`
        : null;
    })
    .filter(Boolean)
    .join(" ");

  const zeroY = yFor(0);

  return (
    <div style={surgeChartWrapStyle}>
      <div style={{ color: "#123c66", fontWeight: 800, marginBottom: "8px" }}>
        最近配對資料的暴潮偏差趨勢
      </div>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label="暴潮偏差趨勢圖"
        style={{ width: "100%", height: "auto", display: "block" }}
      >
        <line
          x1={paddingX}
          y1={zeroY}
          x2={width - paddingX}
          y2={zeroY}
          stroke="#94a3b8"
          strokeWidth="2"
          strokeDasharray="8 8"
        />
        <polyline
          points={linePoints}
          fill="none"
          stroke="#0f6fb8"
          strokeWidth="5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        {points.map((point, index) => {
          const value = Number(point.surgeAnomaly);
          if (!Number.isFinite(value)) return null;

          return (
            <circle
              key={`${point.time}-${index}`}
              cx={xFor(index)}
              cy={yFor(value)}
              r="5"
              fill={value > 0 ? "#f59e0b" : "#0f6fb8"}
            />
          );
        })}
        <text x="8" y={Math.max(16, zeroY - 8)} fontSize="18" fill="#64748b">
          0 m
        </text>
      </svg>
    </div>
  );
}

function TyphoonMap({
  title,
  path,
  trackPoints = [],
  emptyText,
  windUnit = "",
  showAllPoints = true,
}) {
  const validPath = Array.isArray(path) ? path : [];

  const [playIndex, setPlayIndex] = useState(
    validPath.length > 0 ? 1 : 0
  );
  const [isPlaying, setIsPlaying] = useState(validPath.length > 0);
  const [speed, setSpeed] = useState(1);

  useEffect(() => {
    if (validPath.length > 0) {
      setPlayIndex(1);
      setIsPlaying(true);
    } else {
      setPlayIndex(0);
      setIsPlaying(false);
    }
  }, [path]);

  useEffect(() => {
    if (!isPlaying || validPath.length === 0) return;

    const timer = window.setInterval(() => {
      setPlayIndex((prev) => {
        if (prev >= validPath.length) {
          setIsPlaying(false);
          return validPath.length;
        }

        return prev + 1;
      });
    }, Math.max(100, 700 / speed));

    return () => window.clearInterval(timer);
  }, [isPlaying, speed, validPath.length]);

  const visibleCount = Math.max(
    0,
    Math.min(playIndex, validPath.length)
  );

  const animatedPath = validPath.slice(0, visibleCount);
  const currentPoint =
    visibleCount > 0 ? validPath[visibleCount - 1] : null;

  const currentInfo =
    visibleCount > 0
      ? trackPoints[visibleCount - 1] ?? null
      : null;

  const displayMarkers = showAllPoints
    ? animatedPath
    : animatedPath.filter(
        (_, index) =>
          index === 0 ||
          index === animatedPath.length - 1 ||
          index %
            Math.max(
              1,
              Math.floor(
                Math.max(animatedPath.length, 1) / 20
              )
            ) ===
            0
      );

  const startPlayback = () => {
    if (!validPath.length) return;

    if (playIndex >= validPath.length) {
      setPlayIndex(1);
    }

    setIsPlaying(true);
  };

  // 每 10 分鐘換一次 cache key；TyphoonMap 播放時本來就會持續重繪，
  // 所以跨過 10 分鐘邊界後會自動抓 CWA 最新雲圖。

  return (
    <section style={{ ...cardStyle, overflow: "hidden" }}>
      <h2 style={sectionTitleStyle}>🌀 {title}</h2>

      <div style={satelliteStatusStyle}>
        <span>🛰 NASA Blue Marble + Himawari AHI（去灰霧混色）</span>
        <span>固定視角：台灣／沖繩／菲律賓／關島／颱風活動區</span>
      </div>

      {validPath.length > 0 ? (
        <div style={animationPanelStyle}>
          <div style={animationButtonRowStyle}>
            <button
              type="button"
              onClick={() =>
                isPlaying
                  ? setIsPlaying(false)
                  : startPlayback()
              }
              style={primaryButtonStyle}
            >
              {isPlaying ? "⏸ 暫停" : "▶ 播放"}
            </button>

            <button
              type="button"
              onClick={() => {
                setPlayIndex(1);
                setIsPlaying(true);
              }}
              style={secondaryButtonStyle}
            >
              ↺ 重新播放
            </button>

            <button
              type="button"
              onClick={() => {
                setIsPlaying(false);
                setPlayIndex(validPath.length);
              }}
              style={secondaryButtonStyle}
            >
              顯示完整路徑
            </button>

            <label style={speedLabelStyle}>
              播放速度
              <select
                value={speed}
                onChange={(event) =>
                  setSpeed(Number(event.target.value))
                }
                style={speedSelectStyle}
              >
                <option value={0.5}>0.5×</option>
                <option value={1}>1×</option>
                <option value={2}>2×</option>
                <option value={4}>4×</option>
              </select>
            </label>
          </div>

          <div style={progressRowStyle}>
            <input
              type="range"
              min="1"
              max={validPath.length}
              value={Math.max(1, visibleCount)}
              onChange={(event) => {
                setIsPlaying(false);
                setPlayIndex(Number(event.target.value));
              }}
              style={{ width: "100%" }}
            />

            <span style={progressTextStyle}>
              {visibleCount} / {validPath.length}
            </span>
          </div>

          {currentInfo && (
            <div style={currentInfoGridStyle}>
              <MiniInfo
                title="時間"
                value={formatDateTime(currentInfo.time)}
              />

              <MiniInfo
                title="風速"
                value={
                  currentInfo.wind == null
                    ? "—"
                    : `${currentInfo.wind} ${windUnit}`
                }
              />

              <MiniInfo
                title="氣壓"
                value={
                  currentInfo.pressure == null
                    ? "—"
                    : `${currentInfo.pressure} hPa`
                }
              />

              <MiniInfo
                title="位置"
                value={
                  currentPoint
                    ? `${currentPoint[0].toFixed(
                        2
                      )}, ${currentPoint[1].toFixed(2)}`
                    : "—"
                }
              />
            </div>
          )}
        </div>
      ) : (
        <div style={{ ...emptyStyle, marginBottom: "18px" }}>
          {emptyText}
        </div>
      )}

      <MapContainer
        center={FIXED_MAP_CENTER}
        zoom={FIXED_MAP_ZOOM}
        minZoom={FIXED_MAP_ZOOM}
        maxZoom={FIXED_MAP_ZOOM}
        zoomSnap={0.25}
        zoomDelta={0.25}
        dragging={false}
        scrollWheelZoom={false}
        doubleClickZoom={false}
        boxZoom={false}
        keyboard={false}
        touchZoom={false}
        zoomControl={false}
        attributionControl={false}
        worldCopyJump={false}
        style={{
          height: "560px",
          width: "100%",
          borderRadius: "20px",
          zIndex: 1,
          background: "#0b3a67",
        }}
      >
        {/* 彩色地表／海洋底圖：把原本灰色底改成藍海綠地。 */}
        <WMSTileLayer
          url={HIMAWARI_WMS_URL}
          layers="BlueMarble_ShadedRelief_Bathymetry"
          styles="default"
          format="image/jpeg"
          transparent={false}
          version="1.3.0"
          opacity={1}
          attribution="NASA GIBS / Blue Marble"
        />

        {/*
          Himawari 紅外線本身是一整張灰階影像。
          如果只調 opacity，灰色仍會像一層霧蓋住 Blue Marble。
          改用 overlay 混色：保留底圖的藍海／綠地色彩，
          同時讓白雲與強對流的紅黃綠訊號顯示出來。
        */}
        <Pane
          name="himawari-cloud-pane"
          style={{
            zIndex: 250,
            mixBlendMode: "overlay",
            filter: "contrast(1.18) saturate(1.15)",
            pointerEvents: "none",
          }}
        >
          <WMSTileLayer
            url={HIMAWARI_WMS_URL}
            layers="Himawari_AHI_Band13_Clean_Infrared"
            styles="default"
            format="image/png"
            transparent={true}
            version="1.3.0"
            opacity={0.82}
            attribution="NASA GIBS / Himawari AHI"
          />
        </Pane>

        {/* 完整路徑會固定顯示，動畫路徑再疊在上面。 */}
        {validPath.length >= 2 && (
          <Polyline
            positions={validPath}
            pathOptions={{
              color: "#ff8aa0",
              weight: 4,
              opacity: 0.55,
              dashArray: "8 8",
            }}
          />
        )}

        {animatedPath.length >= 2 && (
          <Polyline
            positions={animatedPath}
            pathOptions={{
              color: "#ff1744",
              weight: 6,
              opacity: 1,
            }}
          />
        )}

        {displayMarkers.map((position, index) => (
          <Marker
            key={`${position[0]}-${position[1]}-${index}`}
            position={position}
          >
            <Popup>
              路徑點 {index + 1}
              <br />
              緯度：{position[0]}
              <br />
              經度：{position[1]}
            </Popup>
          </Marker>
        ))}

        {currentPoint && (
          <Marker
            position={currentPoint}
            zIndexOffset={1000}
          >
            <Popup>
              <strong>目前播放位置</strong>
              <br />
              路徑點：{visibleCount} / {validPath.length}

              {currentInfo?.time && (
                <>
                  <br />
                  時間：{formatDateTime(currentInfo.time)}
                </>
              )}

              {currentInfo?.wind != null && (
                <>
                  <br />
                  風速：{currentInfo.wind} {windUnit}
                </>
              )}

              {currentInfo?.pressure != null && (
                <>
                  <br />
                  氣壓：{currentInfo.pressure} hPa
                </>
              )}
            </Popup>
          </Marker>
        )}

        {MAP_LABELS.map((item) => (
          <Marker
            key={item.name}
            position={item.position}
            opacity={0}
            interactive={false}
          >
            <Tooltip
              permanent
              direction="center"
              className="county-label"
            >
              {item.name}
            </Tooltip>
          </Marker>
        ))}
      </MapContainer>
    </section>
  );
}

function MiniInfo({ title, value }) {
  return (
    <div style={miniInfoStyle}>
      <div style={{ color: "#64748b", fontSize: "12px", fontWeight: 700 }}>
        {title}
      </div>
      <div style={{ color: "#123c66", fontSize: "15px", fontWeight: 800, marginTop: "5px" }}>
        {value}
      </div>
    </div>
  );
}

function InfoCard({ title, value, sub, accent }) {
  return (
    <div style={infoCardStyle}>
      <div style={{ fontSize: "15px", color: "#6b7280", fontWeight: 600 }}>
        {title}
      </div>
      <div
        style={{
          fontSize: "28px",
          fontWeight: 800,
          color: accent || "#123c66",
          margin: "10px 0 8px",
        }}
      >
        {value}
      </div>
      <div style={{ fontSize: "14px", color: "#94a3b8" }}>{sub}</div>
    </div>
  );
}

function StatCard({ title, value, small = false }) {
  return (
    <div style={statCardStyle}>
      <div style={{ color: "#64748b", fontSize: "14px", fontWeight: 700 }}>
        {title}
      </div>
      <div
        style={{
          color: "#123c66",
          fontSize: small ? "15px" : "24px",
          lineHeight: 1.5,
          fontWeight: 800,
          marginTop: "8px",
          wordBreak: "break-word",
        }}
      >
        {value}
      </div>
    </div>
  );
}

function TableHead({ children }) {
  return (
    <th
      style={{
        textAlign: "left",
        padding: "14px 16px",
        color: "#123c66",
        fontSize: "14px",
        whiteSpace: "nowrap",
      }}
    >
      {children}
    </th>
  );
}

function TableCell({ children }) {
  return (
    <td
      style={{
        padding: "14px 16px",
        color: "#334155",
        fontSize: "14px",
        whiteSpace: "nowrap",
      }}
    >
      {children}
    </td>
  );
}

function ErrorMessage({ children }) {
  return (
    <p
      style={{
        color: "#b91c1c",
        background: "#fee2e2",
        borderRadius: "12px",
        padding: "12px 14px",
        fontWeight: 700,
      }}
    >
      {children}
    </p>
  );
}

function getRisk(wind, pressure) {
  const safeWind = Number(wind) || 0;
  const safePressure =
    Number.isFinite(Number(pressure)) && Number(pressure) > 0
      ? Number(pressure)
      : 1010;

  if (safeWind >= 45 || safePressure <= 940) {
    return {
      label: "高風險",
      bgColor: "#fee2e2",
      textColor: "#b91c1c",
    };
  }

  if (safeWind >= 35 || safePressure <= 960) {
    return {
      label: "中風險",
      bgColor: "#fef3c7",
      textColor: "#b45309",
    };
  }

  return {
    label: "低風險",
    bgColor: "#dcfce7",
    textColor: "#166534",
  };
}

function formatNumber(value, digits = 2) {
  const number = Number(value);
  return Number.isFinite(number) ? number.toFixed(digits) : "—";
}

function formatSigned(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "—";
  const fixed = number.toFixed(2);
  return number > 0 ? `+${fixed}` : fixed;
}

function formatDateTime(value) {
  if (!value || value === "—") return "—";
  return String(value).replace("T", " ").replace("+08:00", "");
}

const pageStyle = {
  minHeight: "100vh",
  background: "#f3f6fb",
  padding: "32px 20px",
  fontFamily: "'Noto Sans TC', 'Microsoft JhengHei', Arial, sans-serif",
  color: "#1e2a3a",
};

const headerStyle = {
  background: "linear-gradient(135deg, #123c66, #1f5f9c)",
  color: "#fff",
  borderRadius: "24px",
  padding: "32px",
  boxShadow: "0 10px 30px rgba(0,0,0,0.12)",
  marginBottom: "28px",
};

const cardStyle = {
  background: "#fff",
  borderRadius: "24px",
  padding: "24px",
  marginBottom: "28px",
  boxShadow: "0 8px 24px rgba(15,23,42,0.08)",
};

const summaryGridStyle = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
  gap: "18px",
  marginBottom: "28px",
};

const infoCardStyle = {
  background: "#fff",
  borderRadius: "20px",
  padding: "22px",
  boxShadow: "0 8px 24px rgba(15,23,42,0.08)",
};

const sectionTitleStyle = {
  marginTop: 0,
  marginBottom: "10px",
  color: "#123c66",
  fontSize: "26px",
};

const sectionSubStyle = {
  color: "#64748b",
  marginTop: 0,
};

const filterGridStyle = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
  gap: "16px",
};

const labelStyle = {
  display: "block",
  marginBottom: "8px",
  fontSize: "14px",
  fontWeight: 700,
  color: "#475569",
};

const inputStyle = {
  width: "100%",
  padding: "12px 14px",
  borderRadius: "12px",
  border: "1px solid #cbd5e1",
  fontSize: "14px",
  outline: "none",
  background: "#fff",
};

const countBoxStyle = {
  minHeight: "45px",
  display: "flex",
  alignItems: "center",
  padding: "12px 14px",
  borderRadius: "12px",
  background: "#eff6ff",
  color: "#123c66",
  fontWeight: 800,
};

const surgeMetaGridStyle = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
  gap: "10px",
  marginTop: "16px",
  padding: "14px 16px",
  borderRadius: "14px",
  background: "#f8fafc",
  color: "#475569",
  fontSize: "13px",
  lineHeight: 1.7,
};

const surgeChartWrapStyle = {
  marginTop: "20px",
  padding: "16px",
  borderRadius: "16px",
  border: "1px solid #dbeafe",
  background: "#f8fbff",
};

const diagnosticStyle = {
  marginTop: "16px",
  padding: "14px",
  borderRadius: "12px",
  background: "#0f172a",
  color: "#e2e8f0",
  overflowX: "auto",
  fontSize: "12px",
};

const historyLayoutStyle = {
  display: "grid",
  gridTemplateColumns: "minmax(260px, 0.8fr) minmax(320px, 1.2fr)",
  gap: "22px",
  marginTop: "22px",
};

const historyListStyle = {
  display: "grid",
  gap: "10px",
  maxHeight: "520px",
  overflowY: "auto",
  paddingRight: "6px",
};

const historyButtonStyle = {
  width: "100%",
  display: "flex",
  justifyContent: "space-between",
  gap: "12px",
  alignItems: "center",
  border: "1px solid #e2e8f0",
  borderRadius: "14px",
  padding: "12px 14px",
  cursor: "pointer",
  textAlign: "left",
};

const selectedHeaderStyle = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "flex-start",
  gap: "16px",
  flexWrap: "wrap",
  marginBottom: "20px",
};

const sidBadgeStyle = {
  display: "inline-block",
  background: "#e0f2fe",
  color: "#075985",
  borderRadius: "999px",
  padding: "8px 12px",
  fontSize: "13px",
  fontWeight: 800,
};

const statsGridStyle = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))",
  gap: "14px",
};

const statCardStyle = {
  background: "#f8fafc",
  borderRadius: "16px",
  padding: "18px",
  border: "1px solid #e2e8f0",
};

const emptyStyle = {
  padding: "30px",
  borderRadius: "16px",
  background: "#f8fafc",
  color: "#64748b",
  textAlign: "center",
};

const tableStyle = {
  width: "100%",
  minWidth: "720px",
  borderCollapse: "collapse",
};

const satelliteStatusStyle = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  gap: "12px",
  flexWrap: "wrap",
  margin: "4px 0 14px",
  padding: "10px 12px",
  borderRadius: "12px",
  background: "#eef6ff",
  color: "#315b7d",
  fontSize: "13px",
  fontWeight: 700,
};

const animationPanelStyle = {
  background: "#f8fafc",
  border: "1px solid #e2e8f0",
  borderRadius: "18px",
  padding: "16px",
  margin: "14px 0 18px",
};

const animationButtonRowStyle = {
  display: "flex",
  alignItems: "center",
  flexWrap: "wrap",
  gap: "10px",
};

const primaryButtonStyle = {
  border: "none",
  borderRadius: "10px",
  padding: "10px 16px",
  background: "#2563eb",
  color: "#fff",
  fontWeight: 800,
  cursor: "pointer",
};

const secondaryButtonStyle = {
  border: "1px solid #cbd5e1",
  borderRadius: "10px",
  padding: "10px 16px",
  background: "#fff",
  color: "#334155",
  fontWeight: 700,
  cursor: "pointer",
};

const speedLabelStyle = {
  display: "flex",
  alignItems: "center",
  gap: "8px",
  color: "#475569",
  fontSize: "14px",
  fontWeight: 700,
};

const speedSelectStyle = {
  border: "1px solid #cbd5e1",
  borderRadius: "8px",
  padding: "8px 10px",
  background: "#fff",
};

const progressRowStyle = {
  display: "grid",
  gridTemplateColumns: "1fr auto",
  alignItems: "center",
  gap: "12px",
  marginTop: "14px",
};

const progressTextStyle = {
  minWidth: "72px",
  color: "#475569",
  fontSize: "13px",
  fontWeight: 800,
  textAlign: "right",
};

const currentInfoGridStyle = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))",
  gap: "10px",
  marginTop: "14px",
};

const miniInfoStyle = {
  background: "#fff",
  border: "1px solid #e2e8f0",
  borderRadius: "12px",
  padding: "10px 12px",
};

export default App;
