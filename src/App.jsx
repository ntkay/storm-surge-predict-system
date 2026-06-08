import { useEffect, useMemo, useState } from "react";

import {
  MapContainer,
  TileLayer,
  Marker,
  Popup,
  Polyline,
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

function App() {
  const [now, setNow] = useState(new Date());
  const [search, setSearch] = useState("");
  const [selectedYear, setSelectedYear] = useState("全部");
  const [selectedLocation, setSelectedLocation] = useState("全部");
  const [cwaTyphoon, setCwaTyphoon] = useState(null);
  const [cwaLoading, setCwaLoading] = useState(true);
  const [cwaError, setCwaError] = useState("");

  useEffect(() => {
    const timer = setInterval(() => {
      setNow(new Date());
    }, 1000);

    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
  fetch("/data/cwa_typhoon.json")
    .then((res) => res.json())
    .then((data) => {
      console.log("中央氣象署颱風資料：", data);
      setCwaTyphoon(data);
      setCwaLoading(false);
    })
    .catch((error) => {
      console.error("讀取錯誤：", error);
      setCwaError("讀取本地中央氣象署資料失敗");
      setCwaLoading(false);
    });
}, []);

  const typhoonData = [
    { id: 1, name: "杜蘇芮", year: 2023, location: "高雄", wind: 50, pressure: 930, surge: 1.8 },
    { id: 2, name: "海葵", year: 2023, location: "台東", wind: 45, pressure: 940, surge: 1.5 },
    { id: 3, name: "梅姬", year: 2016, location: "基隆", wind: 38, pressure: 960, surge: 1.2 },
    { id: 4, name: "莫蘭蒂", year: 2016, location: "屏東", wind: 55, pressure: 915, surge: 2.1 },
    { id: 5, name: "天鵝", year: 2015, location: "台南", wind: 42, pressure: 950, surge: 1.4 },
    { id: 6, name: "尼伯特", year: 2016, location: "花蓮", wind: 48, pressure: 935, surge: 1.7 },
  ];

  const typhoonPath = useMemo(() => {
  if (!cwaTyphoon?.records?.TropicalCyclones?.TropicalCyclone) {
    return [];
  }

  const cyclone =
    cwaTyphoon.records.TropicalCyclones.TropicalCyclone[0];

  const analysisData =
    cyclone.AnalysisData?.Fix || [];

  return analysisData.map((item) => [
    parseFloat(item.CoordinateLatitude),
    parseFloat(item.CoordinateLongitude),
  ]);
}, [cwaTyphoon]);

  const years = ["全部", ...new Set(typhoonData.map((item) => item.year))];
  const locations = ["全部", ...new Set(typhoonData.map((item) => item.location))];

  const filteredTyphoonData = useMemo(() => {
    return typhoonData.filter((item) => {
      const matchSearch = item.name.includes(search.trim());
      const matchYear =
        selectedYear === "全部" || item.year.toString() === selectedYear.toString();
      const matchLocation =
        selectedLocation === "全部" || item.location === selectedLocation;

      return matchSearch && matchYear && matchLocation;
    });
  }, [search, selectedYear, selectedLocation]);

  const averageWind =
    filteredTyphoonData.length > 0
      ? Math.round(filteredTyphoonData.reduce((sum, item) => sum + item.wind, 0) / filteredTyphoonData.length)
      : 0;

  const averagePressure =
    filteredTyphoonData.length > 0
      ? Math.round(filteredTyphoonData.reduce((sum, item) => sum + item.pressure, 0) / filteredTyphoonData.length)
      : 0;

  const maxSurge =
    filteredTyphoonData.length > 0
      ? Math.max(...filteredTyphoonData.map((item) => item.surge))
      : 0;

  const overallRisk = getOverallRisk(averageWind, averagePressure);

  const windChartData = filteredTyphoonData.map((item) => ({
    time: `${item.name}-${item.year}`,
    value: item.wind,
  }));

  const pressureChartData = filteredTyphoonData.map((item) => ({
    time: `${item.name}-${item.year}`,
    value: item.pressure,
  }));

  const surgeRanking = [...filteredTyphoonData]
    .sort((a, b) => b.surge - a.surge)
    .slice(0, 5);

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "#f3f6fb",
        padding: "32px 20px",
        fontFamily: "'Noto Sans TC', 'Microsoft JhengHei', Arial, sans-serif",
        color: "#1e2a3a",
      }}
    >
      <div style={{ maxWidth: "1280px", margin: "0 auto" }}>
        <header
          style={{
            background: "linear-gradient(135deg, #123c66, #1f5f9c)",
            color: "#fff",
            borderRadius: "24px",
            padding: "32px",
            boxShadow: "0 10px 30px rgba(0,0,0,0.12)",
            marginBottom: "28px",
          }}
        >
          <h1 style={{ margin: 0, fontSize: "42px", fontWeight: "800", letterSpacing: "1px" }}>
            暴潮預測系統
          </h1>
          <p style={{ margin: "12px 0 0", fontSize: "18px", opacity: 0.92 }}>
            以歷史颱風資料分析沿海暴潮風險與變化趨勢
          </p>
        </header>

        <section
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
            gap: "18px",
            marginBottom: "28px",
          }}
        >
          <InfoCard title="今日日期" value={now.toLocaleDateString("zh-TW")} sub="系統即時更新" />
          <InfoCard title="目前時間" value={now.toLocaleTimeString("zh-TW")} sub="每秒自動刷新" />
          <InfoCard title="預測狀態" value={overallRisk.label} sub="依篩選後資料評估" accent={overallRisk.color} />
          <InfoCard title="最大暴潮值" value={`${maxSurge || 0} m`} sub="目前篩選資料中的最大值" />
        </section>

        <LiveTyphoonPanel cwaTyphoon={cwaTyphoon} />

        <CwaTyphoonPanel
          data={cwaTyphoon}
          loading={cwaLoading}
          error={cwaError}
        />

        <TyphoonMap typhoonPath={typhoonPath} />

        <section
          style={{
            background: "#fff",
            borderRadius: "24px",
            padding: "24px",
            boxShadow: "0 8px 24px rgba(15, 23, 42, 0.08)",
            marginBottom: "28px",
          }}
        >
          <h2 style={{ marginTop: 0, marginBottom: "18px", fontSize: "26px", color: "#123c66" }}>
            資料篩選
          </h2>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
              gap: "16px",
            }}
          >
            <div>
              <label style={labelStyle}>搜尋颱風名稱</label>
              <input
                type="text"
                placeholder="例如：海葵"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                style={inputStyle}
              />
            </div>

            <div>
              <label style={labelStyle}>篩選年份</label>
              <select
                value={selectedYear}
                onChange={(e) => setSelectedYear(e.target.value)}
                style={inputStyle}
              >
                {years.map((year) => (
                  <option key={year} value={year}>
                    {year}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label style={labelStyle}>篩選地區</label>
              <select
                value={selectedLocation}
                onChange={(e) => setSelectedLocation(e.target.value)}
                style={inputStyle}
              >
                {locations.map((location) => (
                  <option key={location} value={location}>
                    {location}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </section>

        <section
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(340px, 1fr))",
            gap: "22px",
            marginBottom: "28px",
          }}
        >
          <ChartCard title="最大風速變化" subtitle="Maximum Wind Speed" unit="m/s" data={windChartData} lineColor="#2f80ed" />
          <ChartCard title="中心氣壓變化" subtitle="Central Pressure" unit="hPa" data={pressureChartData} lineColor="#27ae60" />
        </section>

        <section
          style={{
            display: "grid",
            gridTemplateColumns: "1.5fr 1fr",
            gap: "22px",
          }}
        >
          <div
            style={{
              background: "#fff",
              borderRadius: "24px",
              padding: "24px",
              boxShadow: "0 8px 24px rgba(15, 23, 42, 0.08)",
              overflowX: "auto",
            }}
          >
            <h2 style={{ marginTop: 0, marginBottom: "8px", color: "#123c66", fontSize: "26px" }}>
              歷史颱風資料表
            </h2>
            <p style={{ marginTop: 0, marginBottom: "20px", color: "#64748b", fontSize: "14px" }}>
              顯示目前搜尋與篩選後的結果
            </p>

            <table style={{ width: "100%", borderCollapse: "collapse", minWidth: "760px" }}>
              <thead>
                <tr style={{ background: "#eff6ff" }}>
                  <TableHead>颱風名稱</TableHead>
                  <TableHead>年份</TableHead>
                  <TableHead>地區</TableHead>
                  <TableHead>最大風速</TableHead>
                  <TableHead>中心氣壓</TableHead>
                  <TableHead>暴潮高度</TableHead>
                  <TableHead>風險等級</TableHead>
                </tr>
              </thead>
              <tbody>
                {filteredTyphoonData.length === 0 ? (
                  <tr>
                    <td colSpan="7" style={{ padding: "24px", textAlign: "center", color: "#64748b" }}>
                      查無符合條件的資料
                    </td>
                  </tr>
                ) : (
                  filteredTyphoonData.map((item) => {
                    const risk = getRisk(item.wind, item.pressure);

                    return (
                      <tr key={item.id} style={{ borderBottom: "1px solid #e5e7eb" }}>
                        <TableCell>{item.name}</TableCell>
                        <TableCell>{item.year}</TableCell>
                        <TableCell>{item.location}</TableCell>
                        <TableCell>{item.wind} m/s</TableCell>
                        <TableCell>{item.pressure} hPa</TableCell>
                        <TableCell>{item.surge} m</TableCell>
                        <TableCell>
                          <span
                            style={{
                              display: "inline-block",
                              padding: "6px 12px",
                              borderRadius: "999px",
                              fontSize: "13px",
                              fontWeight: "700",
                              color: risk.textColor,
                              background: risk.bgColor,
                            }}
                          >
                            {risk.label}
                          </span>
                        </TableCell>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>

          <div style={{ display: "grid", gap: "22px" }}>
            <SummaryCard title="平均最大風速" value={`${averageWind} m/s`} desc="依目前篩選資料計算" />
            <SummaryCard title="平均中心氣壓" value={`${averagePressure} hPa`} desc="數值越低代表颱風越強" />
            <RankingCard ranking={surgeRanking} />
          </div>
        </section>
      </div>
    </div>
  );
}

function LiveTyphoonPanel({ cwaTyphoon }) {
  const currentTyphoon =
    cwaTyphoon?.records?.TropicalCyclones?.TropicalCyclone?.[0];

  if (!currentTyphoon) {
    return null;
  }

  const fixes = currentTyphoon.AnalysisData?.Fix || [];
  const latestFix = fixes[fixes.length - 1];

  const wind = Number(latestFix?.MaxWindSpeed || 0);
  const pressure = Number(latestFix?.Pressure || 0);

  const predictedSurge = calculatePredictedSurge(wind, pressure);
  const risk = getRisk(wind, pressure);

  return (
    <section
      style={{
        background: "#fff",
        borderRadius: "24px",
        padding: "28px",
        boxShadow: "0 8px 24px rgba(15, 23, 42, 0.08)",
        marginBottom: "28px",
      }}
    >
      <h2 style={{ marginTop: 0, color: "#123c66" }}>
        中央氣象署颱風資料
      </h2>

      <h3 style={{ fontSize: "32px", color: "#123c66" }}>
        {currentTyphoon.CwaTyphoonName || currentTyphoon.TyphoonName}颱風
      </h3>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
          gap: "16px",
        }}
      >
        <LiveInfoCard title="最大風速" value={`${wind} m/s`} color="#2563eb" />
        <LiveInfoCard title="中心氣壓" value={`${pressure} hPa`} color="#16a34a" />
        <LiveInfoCard title="預測暴潮" value={`${predictedSurge} m`} color="#dc2626" />
        <LiveInfoCard title="風險等級" value={risk.label} color={risk.textColor} />
      </div>
    </section>
  );
}
function LiveInfoCard({ title, value, color }) {
  return (
    <div
      style={{
        background: "#f8fafc",
        borderRadius: "18px",
        padding: "20px",
        borderLeft: `6px solid ${color}`,
      }}
    >
      <div style={{ fontSize: "14px", color: "#64748b", marginBottom: "10px", fontWeight: "700" }}>
        {title}
      </div>

      <div style={{ fontSize: "26px", fontWeight: "800", color }}>
        {value}
      </div>
    </div>
  );
}

function calculatePredictedSurge(wind, pressure) {
  const pressureEffect = Math.max(0, 1010 - pressure) * 0.01;
  const windEffect = wind * 0.03;
  return (pressureEffect + windEffect).toFixed(2);
}

function getRisk(wind, pressure) {
  if (wind >= 45 || pressure <= 940) {
    return { label: "高風險", bgColor: "#fee2e2", textColor: "#b91c1c" };
  }

  if (wind >= 35 || pressure <= 960) {
    return { label: "中風險", bgColor: "#fef3c7", textColor: "#b45309" };
  }

  return { label: "低風險", bgColor: "#dcfce7", textColor: "#166534" };
}

function getOverallRisk(avgWind, avgPressure) {
  if (avgWind >= 45 || avgPressure <= 940) {
    return { label: "高風險", color: "#b91c1c" };
  }

  if (avgWind >= 35 || avgPressure <= 960) {
    return { label: "中風險", color: "#b45309" };
  }

  return { label: "低風險", color: "#166534" };
}

function InfoCard({ title, value, sub, accent }) {
  return (
    <div style={{ background: "#fff", borderRadius: "20px", padding: "22px", boxShadow: "0 8px 24px rgba(15, 23, 42, 0.08)" }}>
      <div style={{ fontSize: "15px", color: "#6b7280", marginBottom: "10px", fontWeight: "600" }}>
        {title}
      </div>

      <div style={{ fontSize: "30px", fontWeight: "800", color: accent || "#123c66", marginBottom: "8px" }}>
        {value}
      </div>

      <div style={{ fontSize: "14px", color: "#94a3b8" }}>
        {sub}
      </div>
    </div>
  );
}

function SummaryCard({ title, value, desc }) {
  return (
    <div style={{ background: "#fff", borderRadius: "24px", padding: "24px", boxShadow: "0 8px 24px rgba(15, 23, 42, 0.08)" }}>
      <div style={{ color: "#64748b", fontSize: "14px", marginBottom: "10px", fontWeight: "600" }}>
        {title}
      </div>
      <div style={{ color: "#123c66", fontSize: "28px", fontWeight: "800", marginBottom: "10px" }}>
        {value}
      </div>
      <div style={{ color: "#94a3b8", fontSize: "14px" }}>
        {desc}
      </div>
    </div>
  );
}

function RankingCard({ ranking }) {
  return (
    <div style={{ background: "#fff", borderRadius: "24px", padding: "24px", boxShadow: "0 8px 24px rgba(15, 23, 42, 0.08)" }}>
      <h3 style={{ marginTop: 0, marginBottom: "16px", color: "#123c66", fontSize: "22px" }}>
        暴潮排行榜
      </h3>

      {ranking.length === 0 ? (
        <div style={{ color: "#64748b" }}>目前沒有資料</div>
      ) : (
        ranking.map((item, index) => (
          <div
            key={item.id}
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              padding: "12px 0",
              borderBottom: index !== ranking.length - 1 ? "1px solid #e5e7eb" : "none",
            }}
          >
            <div>
              <div style={{ fontWeight: "700", color: "#1e293b" }}>
                {index + 1}. {item.name}
              </div>
              <div style={{ fontSize: "13px", color: "#64748b" }}>
                {item.location} / {item.year}
              </div>
            </div>
            <div style={{ fontWeight: "800", color: "#0f766e" }}>
              {item.surge} m
            </div>
          </div>
        ))
      )}
    </div>
  );
}

function TableHead({ children }) {
  return (
    <th style={{ textAlign: "left", padding: "14px 16px", color: "#123c66", fontSize: "14px" }}>
      {children}
    </th>
  );
}

function TableCell({ children }) {
  return (
    <td style={{ padding: "14px 16px", fontSize: "14px", color: "#334155" }}>
      {children}
    </td>
  );
}

function ChartCard({ title, subtitle, unit, data, lineColor }) {
  if (data.length === 0) {
    return (
      <div style={{ background: "#fff", borderRadius: "24px", padding: "24px", boxShadow: "0 8px 24px rgba(15, 23, 42, 0.08)" }}>
        <h2 style={{ margin: 0, fontSize: "24px", color: "#123c66" }}>{title}</h2>
        <p style={{ color: "#64748b", fontSize: "14px" }}>{subtitle}</p>
        <div style={{ color: "#94a3b8", paddingTop: "24px" }}>目前沒有資料可顯示</div>
      </div>
    );
  }

  const values = data.map((item) => item.value);
  const min = Math.min(...values);
  const max = Math.max(...values);

  const width = 520;
  const height = 240;
  const padding = 40;

  const points = data
    .map((item, index) => {
      const x = padding + (index * (width - padding * 2)) / (data.length - 1 || 1);
      const y = height - padding - ((item.value - min) / (max - min || 1)) * (height - padding * 2);
      return `${x},${y}`;
    })
    .join(" ");

  return (
    <div style={{ background: "#fff", borderRadius: "24px", padding: "24px", boxShadow: "0 8px 24px rgba(15, 23, 42, 0.08)" }}>
      <div style={{ marginBottom: "18px" }}>
        <h2 style={{ margin: 0, fontSize: "24px", color: "#123c66" }}>{title}</h2>
        <p style={{ margin: "8px 0 0", color: "#64748b", fontSize: "14px" }}>{subtitle}</p>
      </div>

      <svg
        viewBox={`0 0 ${width} ${height}`}
        style={{
          width: "100%",
          height: "260px",
          display: "block",
          background: "#f8fafc",
          borderRadius: "16px",
        }}
      >
        {[0, 1, 2, 3].map((i) => {
          const y = padding + (i * (height - padding * 2)) / 3;
          return <line key={i} x1={padding} y1={y} x2={width - padding} y2={y} stroke="#dbeafe" strokeWidth="1" />;
        })}

        {data.map((item, index) => {
          const x = padding + (index * (width - padding * 2)) / (data.length - 1 || 1);
          return <line key={item.time} x1={x} y1={padding} x2={x} y2={height - padding} stroke="#e5e7eb" strokeWidth="1" />;
        })}

        <polyline fill="none" stroke={lineColor} strokeWidth="4" points={points} strokeLinejoin="round" strokeLinecap="round" />

        {data.map((item, index) => {
          const x = padding + (index * (width - padding * 2)) / (data.length - 1 || 1);
          const y = height - padding - ((item.value - min) / (max - min || 1)) * (height - padding * 2);

          return (
            <g key={item.time}>
              <circle cx={x} cy={y} r="5" fill={lineColor} />
              <text x={x} y={height - 14} textAnchor="middle" fontSize="12" fill="#475569">
                {item.time}
              </text>
            </g>
          );
        })}

        <text x={padding} y={24} fontSize="14" fill="#475569" fontWeight="700">
          {title} ({unit})
        </text>
      </svg>
    </div>
  );
}

const labelStyle = {
  display: "block",
  marginBottom: "8px",
  fontSize: "14px",
  fontWeight: "700",
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

const taiwanCounties = [
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
  { name: "金門縣", position: [24.4321, 118.3171] },
  { name: "連江縣", position: [26.1605, 119.9517] },
];

const nearbyCities = [
  { name: "福州", position: [26.0745, 119.2965] },
  { name: "廈門", position: [24.4798, 118.0894] },
  { name: "沖繩", position: [26.2124, 127.6792] },
];

function createTextIcon(text, type = "county") {
  return L.divIcon({
    className: "map-text-label",
    html: `
      <div style="
        color: #111827;
        font-size: ${type === "county" ? "14px" : "12px"};
        font-weight: ${type === "county" ? "700" : "500"};
        white-space: nowrap;
        text-shadow:
          -1px -1px 0 #fff,
           1px -1px 0 #fff,
          -1px  1px 0 #fff,
           1px  1px 0 #fff;
      ">
        ${text}
      </div>
    `,
    iconSize: [80, 20],
    iconAnchor: [40, 10],
  });
}

function TyphoonMap({ typhoonPath }) {
  return (
    <section
      style={{
        background: "#fff",
        borderRadius: "24px",
        padding: "24px",
        marginBottom: "28px",
        boxShadow: "0 8px 24px rgba(15,23,42,0.08)",
        overflow: "hidden",
      }}
    >
      <h2
        style={{
          marginTop: 0,
          marginBottom: "18px",
          color: "#123c66",
          fontSize: "28px",
        }}
      >
        🌀 台灣颱風路徑追蹤
      </h2>

      <MapContainer
        center={[23.8, 121]}
        zoom={7}
        minZoom={6}
        maxZoom={10}
        scrollWheelZoom={true}
        maxBounds={[
          [20.5, 117.5],
          [27.5, 124.5],
        ]}
        maxBoundsViscosity={1.0}
        style={{
          height: "560px",
          width: "100%",
          borderRadius: "20px",
          zIndex: 1,
        }}
        whenReady={() => {
          setTimeout(() => {
            window.dispatchEvent(new Event("resize"));
          }, 100);
        }}
      >
        <TileLayer
          attribution="&copy; OpenStreetMap contributors"
          url="https://tile.openstreetmap.de/{z}/{x}/{y}.png"
      />

        <Polyline
          positions={typhoonPath}
          pathOptions={{
            color: "#2563eb",
            weight: 5,
          }}
        />

        {typhoonPath.map((position, index) => (
          <Marker key={index} position={position}>
            <Popup>
              颱風路徑點 {index + 1}
              <br />
              緯度：{position[0]}
              <br />
              經度：{position[1]}
            </Popup>
          </Marker>
        ))}

        {taiwanCounties.map((county) => (
          <Marker
            key={county.name}
            position={county.position}
            opacity={0}
          >
            <Tooltip
              permanent
              direction="center"
              className="county-label"
            >
              {county.name}
            </Tooltip>
          </Marker>
        ))}

        {nearbyCities.map((city) => (
          <Marker key={city.name} position={city.position} opacity={0}>
            <Tooltip
              permanent
              direction="center"
              offset={[0, 0]}
              className="county-label"
            >
              {city.name}
            </Tooltip>
          </Marker>
        ))}
      </MapContainer>
    </section>
  );
}

function CwaTyphoonPanel({ data, loading, error }) {
  const datasetDescription =
    data?.records?.datasetDescription ||
    data?.records?.dataid ||
    "颱風路徑資料";

  return (
    <section
      style={{
        background: "#fff",
        borderRadius: "24px",
        padding: "24px",
        marginBottom: "28px",
        boxShadow: "0 8px 24px rgba(15,23,42,0.08)",
      }}
    >
      <h2
        style={{
          marginTop: 0,
          marginBottom: "12px",
          color: "#123c66",
          fontSize: "26px",
        }}
      >
        中央氣象署颱風資料
      </h2>

      {loading && <p style={{ color: "#64748b" }}>資料讀取中...</p>}

      {error && (
        <p style={{ color: "#b91c1c", fontWeight: "700" }}>
          {error}
        </p>
      )}

      {!loading && !error && (
        <div
          style={{
            background: "#f8fafc",
            borderRadius: "18px",
            padding: "18px",
            color: "#334155",
            lineHeight: 1.7,
          }}
        >
          <p>
            <strong>資料集：</strong>
            {datasetDescription}
          </p>

          <p>
            <strong>狀態：</strong>
            已成功連接中央氣象署 API
          </p>

          <p style={{ color: "#64748b" }}>
            目前先確認 API 連線成功，下一步再把回傳資料解析成颱風名稱、
            中心氣壓、最大風速與路徑點。
          </p>
        </div>
      )}
    </section>
  );
}

export default App;