import { useEffect, useRef } from "react";
import Chart from "chart.js/auto";

export default function TyphoonDashboard() {
  const windCanvasRef = useRef(null);
  const pressureCanvasRef = useRef(null);

  const windChartRef = useRef(null);
  const pressureChartRef = useRef(null);

  useEffect(() => {
    const data = {
      time: ["01/14 00:00", "01/14 06:00", "01/14 12:00", "01/14 18:00"],
      wind: [28, 30, 33, 35],
      pressure: [980, 975, 970, 965],
    };

    // 先清掉舊的（避免 React dev mode 重複建立）
    if (windChartRef.current) windChartRef.current.destroy();
    if (pressureChartRef.current) pressureChartRef.current.destroy();

    windChartRef.current = new Chart(windCanvasRef.current, {
      type: "line",
      data: {
        labels: data.time,
        datasets: [{ label: "最大風速 (m/s)", data: data.wind, tension: 0.3 }],
      },
    });

    pressureChartRef.current = new Chart(pressureCanvasRef.current, {
      type: "line",
      data: {
        labels: data.time,
        datasets: [{ label: "中心氣壓 (hPa)", data: data.pressure, tension: 0.3 }],
      },
    });

    return () => {
      if (windChartRef.current) windChartRef.current.destroy();
      if (pressureChartRef.current) pressureChartRef.current.destroy();
      windChartRef.current = null;
      pressureChartRef.current = null;
    };
  }, []);

  return (
    <div style={{ marginTop: 40 }}>
      <h2>🌪️ 颱風預測展示</h2>

      <h3>最大風速</h3>
      <div style={{ height: 240 }}>
        <canvas ref={windCanvasRef} />
      </div>

      <h3 style={{ marginTop: 24 }}>中心氣壓</h3>
      <div style={{ height: 240 }}>
        <canvas ref={pressureCanvasRef} />
      </div>
    </div>
  );
}
