import { useEffect, useState } from "react";

function App() {
  const [now, setNow] = useState(new Date());

  useEffect(() => {
    const timer = setInterval(() => {
      setNow(new Date());
    }, 1000);

    return () => clearInterval(timer);
  }, []);

  const windData = [
    { time: "01/14 00:00", value: 28 },
    { time: "01/14 06:00", value: 30 },
    { time: "01/14 12:00", value: 33 },
    { time: "01/14 18:00", value: 35 },
  ];

  const pressureData = [
    { time: "01/14 00:00", value: 980 },
    { time: "01/14 06:00", value: 975 },
    { time: "01/14 12:00", value: 970 },
    { time: "01/14 18:00", value: 965 },
  ];

  const typhoonData = [
    {
      id: 1,
      name: "杜蘇芮",
      year: 2023,
      location: "高雄",
      wind: 50,
      pressure: 930,
      surge: 1.8,
    },
    {
      id: 2,
      name: "海葵",
      year: 2023,
      location: "台東",
      wind: 45,
      pressure: 940,
      surge: 1.5,
    },
    {
      id: 3,
      name: "梅姬",
      year: 2016,
      location: "基隆",
      wind: 38,
      pressure: 960,
      surge: 1.2,
    },
    {
      id: 4,
      name: "莫蘭蒂",
      year: 2016,
      location: "屏東",
      wind: 55,
      pressure: 915,
      surge: 2.1,
    },
  ];

  const averageWind = Math.round(
    typhoonData.reduce((sum, item) => sum + item.wind, 0) / typhoonData.length
  );

  const averagePressure = Math.round(
    typhoonData.reduce((sum, item) => sum + item.pressure, 0) / typhoonData.length
  );

  const maxSurge = Math.max(...typhoonData.map((item) => item.surge));

  const overallRisk = getOverallRisk(averageWind, averagePressure);

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "#f3f6fb",
        padding: "32px 20px",
        fontFamily:
          "'Noto Sans TC', 'Microsoft JhengHei', Arial, sans-serif",
        color: "#1e2a3a",
      }}
    >
      <div style={{ maxWidth: "1200px", margin: "0 auto" }}>
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
          <h1
            style={{
              margin: 0,
              fontSize: "42px",
              fontWeight: "800",
              letterSpacing: "1px",
            }}
          >
            暴潮預測系統
          </h1>

          <p
            style={{
              margin: "12px 0 0",
              fontSize: "18px",
              opacity: 0.92,
            }}
          >
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
            title="預測狀態"
            value={overallRisk.label}
            sub="依歷史颱風特徵評估"
            accent={overallRisk.color}
          />
          <InfoCard
            title="最大暴潮值"
            value={`${maxSurge} m`}
            sub="歷史資料統計"
          />
        </section>

        <section
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(340px, 1fr))",
            gap: "22px",
            marginBottom: "28px",
          }}
        >
          <ChartCard
            title="最大風速變化"
            subtitle="Maximum Wind Speed"
            unit="m/s"
            data={windData}
            lineColor="#2f80ed"
          />

          <ChartCard
            title="中心氣壓變化"
            subtitle="Central Pressure"
            unit="hPa"
            data={pressureData}
            lineColor="#27ae60"
          />
        </section>

        <section
          style={{
            display: "grid",
            gridTemplateColumns: "1.4fr 1fr",
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
            <h2
              style={{
                marginTop: 0,
                marginBottom: "8px",
                color: "#123c66",
                fontSize: "26px",
              }}
            >
              歷史颱風資料
            </h2>
            <p
              style={{
                marginTop: 0,
                marginBottom: "20px",
                color: "#64748b",
                fontSize: "14px",
              }}
            >
              可作為暴潮預測分析的基礎資料
            </p>

            <table
              style={{
                width: "100%",
                borderCollapse: "collapse",
                minWidth: "700px",
              }}
            >
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
                {typhoonData.map((item) => {
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
                })}
              </tbody>
            </table>
          </div>

          <div
            style={{
              display: "grid",
              gap: "22px",
            }}
          >
            <SummaryCard
              title="平均最大風速"
              value={`${averageWind} m/s`}
              desc="依目前歷史颱風資料計算"
            />
            <SummaryCard
              title="平均中心氣壓"
              value={`${averagePressure} hPa`}
              desc="數值越低代表颱風越強"
            />
            <SummaryCard
              title="系統判斷邏輯"
              value="風速高 + 氣壓低"
              desc="代表較高的暴潮潛勢"
            />
          </div>
        </section>
      </div>
    </div>
  );
}

function getRisk(wind, pressure) {
  if (wind >= 45 || pressure <= 940) {
    return {
      label: "高風險",
      bgColor: "#fee2e2",
      textColor: "#b91c1c",
    };
  }

  if (wind >= 35 || pressure <= 960) {
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
    <div
      style={{
        background: "#fff",
        borderRadius: "20px",
        padding: "22px",
        boxShadow: "0 8px 24px rgba(15, 23, 42, 0.08)",
      }}
    >
      <div
        style={{
          fontSize: "15px",
          color: "#6b7280",
          marginBottom: "10px",
          fontWeight: "600",
        }}
      >
        {title}
      </div>

      <div
        style={{
          fontSize: "30px",
          fontWeight: "800",
          color: accent || "#123c66",
          marginBottom: "8px",
        }}
      >
        {value}
      </div>

      <div
        style={{
          fontSize: "14px",
          color: "#94a3b8",
        }}
      >
        {sub}
      </div>
    </div>
  );
}

function SummaryCard({ title, value, desc }) {
  return (
    <div
      style={{
        background: "#fff",
        borderRadius: "24px",
        padding: "24px",
        boxShadow: "0 8px 24px rgba(15, 23, 42, 0.08)",
      }}
    >
      <div
        style={{
          color: "#64748b",
          fontSize: "14px",
          marginBottom: "10px",
          fontWeight: "600",
        }}
      >
        {title}
      </div>
      <div
        style={{
          color: "#123c66",
          fontSize: "28px",
          fontWeight: "800",
          marginBottom: "10px",
        }}
      >
        {value}
      </div>
      <div
        style={{
          color: "#94a3b8",
          fontSize: "14px",
        }}
      >
        {desc}
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
        fontSize: "14px",
        color: "#334155",
      }}
    >
      {children}
    </td>
  );
}

function ChartCard({ title, subtitle, unit, data, lineColor }) {
  const values = data.map((item) => item.value);
  const min = Math.min(...values);
  const max = Math.max(...values);

  const width = 520;
  const height = 240;
  const padding = 40;

  const points = data
    .map((item, index) => {
      const x =
        padding + (index * (width - padding * 2)) / (data.length - 1 || 1);
      const y =
        height -
        padding -
        ((item.value - min) / (max - min || 1)) * (height - padding * 2);
      return `${x},${y}`;
    })
    .join(" ");

  return (
    <div
      style={{
        background: "#fff",
        borderRadius: "24px",
        padding: "24px",
        boxShadow: "0 8px 24px rgba(15, 23, 42, 0.08)",
      }}
    >
      <div style={{ marginBottom: "18px" }}>
        <h2
          style={{
            margin: 0,
            fontSize: "24px",
            color: "#123c66",
          }}
        >
          {title}
        </h2>
        <p
          style={{
            margin: "8px 0 0",
            color: "#64748b",
            fontSize: "14px",
          }}
        >
          {subtitle}
        </p>
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
          return (
            <line
              key={i}
              x1={padding}
              y1={y}
              x2={width - padding}
              y2={y}
              stroke="#dbeafe"
              strokeWidth="1"
            />
          );
        })}

        {data.map((item, index) => {
          const x =
            padding + (index * (width - padding * 2)) / (data.length - 1 || 1);
          return (
            <line
              key={item.time}
              x1={x}
              y1={padding}
              x2={x}
              y2={height - padding}
              stroke="#e5e7eb"
              strokeWidth="1"
            />
          );
        })}

        <polyline
          fill="none"
          stroke={lineColor}
          strokeWidth="4"
          points={points}
          strokeLinejoin="round"
          strokeLinecap="round"
        />

        {data.map((item, index) => {
          const x =
            padding + (index * (width - padding * 2)) / (data.length - 1 || 1);
          const y =
            height -
            padding -
            ((item.value - min) / (max - min || 1)) * (height - padding * 2);

          return (
            <g key={item.time}>
              <circle cx={x} cy={y} r="5" fill={lineColor} />
              <text
                x={x}
                y={height - 14}
                textAnchor="middle"
                fontSize="12"
                fill="#475569"
              >
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

export default App;