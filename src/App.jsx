import { useEffect, useMemo, useState } from "react";
import {
  MapContainer,
  Marker,
  Polyline,
  Popup,
  TileLayer,
  Tooltip,
  useMap,
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

const TAIWAN_COUNTIES = [
  { name: "基隆市", position: [25.1276, 121.7392] },
  { name: "臺北市", position: [25.0375, 121.5637] },
  { name: "新北市", position: [25.0169, 121.4628] },
  { name: "桃園市", position: [24.9936, 121.301] },
  { name: "新竹市", position: [24.8138, 120.9675] },
  { name: "新竹縣", position: [24.839, 121.002] },
  { name: "苗栗縣", position: [24.5602, 120.8214] },
  { name: "臺中市", position: [24.1477, 120.6736] },
  { name: "彰化縣", position: [24.0685, 120.5575] },
  { name: "南投縣", position: [23.9609, 120.9719] },
  { name: "雲林縣", position: [23.7092, 120.4313] },
  { name: "嘉義市", position: [23.4801, 120.4491] },
  { name: "嘉義縣", position: [23.4518, 120.2555] },
  { name: "臺南市", position: [22.9999, 120.227] },
  { name: "高雄市", position: [22.6273, 120.3014] },
  { name: "屏東縣", position: [22.5519, 120.5487] },
  { name: "宜蘭縣", position: [24.7021, 121.7378] },
  { name: "花蓮縣", position: [23.9911, 121.6015] },
  { name: "臺東縣", position: [22.7972, 121.0714] },
  { name: "澎湖縣", position: [23.5712, 119.5793] },
];

const NEARBY_CITIES = [
  { name: "福州", position: [26.0745, 119.2965] },
  { name: "廈門", position: [24.4798, 118.0894] },
  { name: "沖繩", position: [26.2124, 127.6792] },
];

function App() {
  const [now, setNow] = useState(new Date());

  const [cwaTyphoon, setCwaTyphoon] = useState(null);
  const [cwaLoading, setCwaLoading] = useState(true);
  const [cwaError, setCwaError] = useState("");

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
    const fetchCwaData = () => {
      fetch(`/data/cwa_typhoon.json?t=${Date.now()}`)
        .then((response) => {
          if (!response.ok) {
            throw new Error(`即時資料 HTTP ${response.status}`);
          }
          return response.json();
        })
        .then((data) => {
          setCwaTyphoon(data);
          setCwaLoading(false);
          setCwaError("");
        })
        .catch((error) => {
          console.error("讀取中央氣象署資料失敗：", error);
          setCwaError("讀取中央氣象署即時資料失敗");
          setCwaLoading(false);
        });
    };

    fetchCwaData();
    const timer = window.setInterval(fetchCwaData, 5 * 60 * 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    fetch("/data/typhoons.json")
      .then((response) => {
        if (!response.ok) {
          throw new Error(`歷史資料 HTTP ${response.status}`);
        }
        return response.json();
      })
      .then((data) => {
        const validData = Array.isArray(data) ? data : [];
        setHistoryTyphoons(validData);
        setSelectedSid(validData[0]?.sid ?? "");
        setHistoryLoading(false);
      })
      .catch((error) => {
        console.error("讀取歷史颱風資料失敗：", error);
        setHistoryError("讀取歷史颱風資料失敗");
        setHistoryLoading(false);
      });
  }, []);

  const liveCyclone =
    cwaTyphoon?.records?.TropicalCyclones?.TropicalCyclone?.[0] ?? null;

  const liveFixes = liveCyclone?.AnalysisData?.Fix ?? [];
  const latestLiveFix = liveFixes.at(-1) ?? null;

  const livePath = useMemo(
    () =>
      liveFixes
        .map((fix) => [
          Number(fix.CoordinateLatitude),
          Number(fix.CoordinateLongitude),
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
            Number(fix.CoordinateLongitude),
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

    return historyTyphoons.filter((item) => {
      const matchName =
        !keyword ||
        item.name?.toUpperCase().includes(keyword) ||
        item.sid?.toUpperCase().includes(keyword);

      const matchYear =
        historyYear === "全部" ||
        String(item.year) === String(historyYear);

      return matchName && matchYear;
    });
  }, [historyTyphoons, historySearch, historyYear]);

  useEffect(() => {
    if (
      filteredHistory.length > 0 &&
      !filteredHistory.some((item) => item.sid === selectedSid)
    ) {
      setSelectedSid(filteredHistory[0].sid);
    }
  }, [filteredHistory, selectedSid]);

  const selectedTyphoon =
    historyTyphoons.find((item) => item.sid === selectedSid) ??
    filteredHistory[0] ??
    null;

  const selectedTrack = selectedTyphoon?.track ?? [];

  const selectedPath = useMemo(
    () =>
      selectedTrack
        .map((point) => [Number(point.lat), Number(point.lon)])
        .filter(([lat, lon]) => Number.isFinite(lat) && Number.isFinite(lon)),
    [selectedTrack]
  );

  const selectedTrackPoints = useMemo(
    () =>
      selectedTrack
        .map((point) => ({
          position: [Number(point.lat), Number(point.lon)],
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

  const liveWind = Number(latestLiveFix?.MaxWindSpeed ?? 0);
  const livePressure = Number(latestLiveFix?.Pressure ?? 0);
  const liveRisk = getRisk(liveWind, livePressure);
  const liveSurge = calculatePredictedSurge(liveWind, livePressure);

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
          surge={liveSurge}
          risk={liveRisk}
        />

        <TyphoonMap
          title="中央氣象署即時颱風路徑"
          path={livePath}
          trackPoints={liveTrackPoints}
          emptyText="目前沒有可顯示的即時颱風路徑"
          windUnit="m/s"
          showAllPoints
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
  surge,
  risk,
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
        <p style={{ color: "#64748b" }}>目前沒有活動中的熱帶氣旋資料。</p>
      </section>
    );
  }

  const wind = Number(latestFix.MaxWindSpeed ?? 0);
  const pressure = Number(latestFix.Pressure ?? 0);

  return (
    <section style={cardStyle}>
      <div style={selectedHeaderStyle}>
        <div>
          <div style={{ color: "#64748b", fontSize: "14px" }}>
            中央氣象署即時颱風
          </div>
          <h2 style={{ margin: "6px 0 0", color: "#123c66" }}>
            {cyclone.CwaTyphoonName || cyclone.TyphoonName || "未命名"}颱風
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
        <StatCard title="移動速度" value={`${latestFix.MovingSpeed || 0} km/h`} />
        <StatCard title="移動方向" value={latestFix.MovingDirection || "—"} />
        <StatCard title="示範暴潮估算" value={`${surge} m`} />
        <StatCard title="風險等級" value={risk.label} />
      </div>

      <p style={{ color: "#64748b", fontSize: "13px", marginBottom: 0 }}>
        暴潮數值目前僅為介面示範公式，不應作為正式預報或防災依據。
      </p>
    </section>
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
  const [playIndex, setPlayIndex] = useState(validPath.length || 0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);

  useEffect(() => {
    setIsPlaying(false);
    setPlayIndex(validPath.length || 0);
  }, [validPath]);

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
    }, Math.max(80, 600 / speed));

    return () => window.clearInterval(timer);
  }, [isPlaying, speed, validPath.length]);

  const visibleCount = Math.max(0, Math.min(playIndex, validPath.length));
  const animatedPath = validPath.slice(0, visibleCount);
  const currentPoint = visibleCount > 0 ? validPath[visibleCount - 1] : null;
  const currentInfo = visibleCount > 0 ? trackPoints[visibleCount - 1] ?? null : null;

  const displayMarkers = showAllPoints
    ? animatedPath
    : animatedPath.filter(
        (_, index) =>
          index === 0 ||
          index === animatedPath.length - 1 ||
          index % Math.max(1, Math.floor(Math.max(animatedPath.length, 1) / 20)) === 0
      );

  const startPlayback = () => {
    if (!validPath.length) return;
    if (playIndex >= validPath.length) setPlayIndex(1);
    setIsPlaying(true);
  };

  return (
    <section style={{ ...cardStyle, overflow: "hidden" }}>
      <h2 style={sectionTitleStyle}>🌀 {title}</h2>

      {validPath.length === 0 ? (
        <div style={emptyStyle}>{emptyText}</div>
      ) : (
        <>
          <div style={animationPanelStyle}>
            <div style={animationButtonRowStyle}>
              <button
                type="button"
                onClick={() => (isPlaying ? setIsPlaying(false) : startPlayback())}
                style={primaryButtonStyle}
              >
                {isPlaying ? "⏸ 暫停" : "▶ 播放"}
              </button>

              <button
                type="button"
                onClick={() => {
                  setIsPlaying(false);
                  setPlayIndex(1);
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
                  onChange={(event) => setSpeed(Number(event.target.value))}
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
                <MiniInfo title="時間" value={formatDateTime(currentInfo.time)} />
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
                      ? `${currentPoint[0].toFixed(2)}, ${currentPoint[1].toFixed(2)}`
                      : "—"
                  }
                />
              </div>
            )}
          </div>

          <MapContainer
            center={[23.8, 122.2]}
            zoom={6}
            minZoom={3}
            maxZoom={10}
            scrollWheelZoom
            style={{
              height: "560px",
              width: "100%",
              borderRadius: "20px",
              zIndex: 1,
            }}
          >
            <TileLayer
              attribution="&copy; OpenStreetMap contributors"
              url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            />

            <FitMapToPath path={validPath} />

            <Polyline
              positions={animatedPath}
              pathOptions={{ color: "#2563eb", weight: 4 }}
            />

            {displayMarkers.map((position, index) => (
              <Marker key={`${position[0]}-${position[1]}-${index}`} position={position}>
                <Popup>
                  緯度：{position[0]}
                  <br />
                  經度：{position[1]}
                </Popup>
              </Marker>
            ))}

            {currentPoint && (
              <Marker position={currentPoint}>
                <Popup>
                  <strong>目前播放位置</strong>
                  <br />
                  路徑點：{visibleCount} / {validPath.length}
                  {currentInfo?.time && <><br />時間：{formatDateTime(currentInfo.time)}</>}
                  {currentInfo?.wind != null && <><br />風速：{currentInfo.wind} {windUnit}</>}
                  {currentInfo?.pressure != null && <><br />氣壓：{currentInfo.pressure} hPa</>}
                </Popup>
              </Marker>
            )}

            <FollowAnimatedPoint point={currentPoint} isPlaying={isPlaying} />

            {TAIWAN_COUNTIES.map((county) => (
              <Marker
                key={county.name}
                position={county.position}
                opacity={0}
                interactive={false}
              >
                <Tooltip permanent direction="center" className="county-label">
                  {county.name}
                </Tooltip>
              </Marker>
            ))}

            {NEARBY_CITIES.map((city) => (
              <Marker
                key={city.name}
                position={city.position}
                opacity={0}
                interactive={false}
              >
                <Tooltip permanent direction="center" className="county-label">
                  {city.name}
                </Tooltip>
              </Marker>
            ))}
          </MapContainer>
        </>
      )}
    </section>
  );
}

function FitMapToPath({ path }) {
  const map = useMap();

  useEffect(() => {
    if (!path?.length) return;

    const bounds = L.latLngBounds(path);
    if (bounds.isValid()) {
      map.fitBounds(bounds, {
        padding: [30, 30],
        maxZoom: 7,
      });
    }

    window.setTimeout(() => map.invalidateSize(), 100);
  }, [map, path]);

  return null;
}

function FollowAnimatedPoint({ point, isPlaying }) {
  const map = useMap();

  useEffect(() => {
    if (!isPlaying || !point) return;
    map.panTo(point, { animate: true, duration: 0.35 });
  }, [map, point, isPlaying]);

  return null;
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

function calculatePredictedSurge(wind, pressure) {
  const safePressure = Number.isFinite(pressure) && pressure > 0 ? pressure : 1010;
  const pressureEffect = Math.max(0, 1010 - safePressure) * 0.01;
  const windEffect = Math.max(0, Number(wind) || 0) * 0.03;
  return (pressureEffect + windEffect).toFixed(2);
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
