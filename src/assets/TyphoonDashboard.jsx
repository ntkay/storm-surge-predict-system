import { useEffect, useRef } from "react";
import Chart from "chart.js/auto";

export default function TyphoonDashboard() {
  const windRef = useRef(null);
  const pressureRef = useRef(null);

  useEffect(() => {
    const data = {
      time: ["01/14 00:00", "01/14 06:00", "01/14 12:00", "01/14 18:00"],
      wind: [28, 30, 33, 35],
      pressure: [980, 975, 970, 965],
    };

    new Chart(windRef.current, {
      type: "line",
      data: {
        labels: data.time,
        datasets: [
          {
            label: "最大風速 (m/s)",
            data: data.wind,
            borderColor: "#4da3ff",
          },
        ],
      },
    });

    new Chart(pressureRef.current, {
      type: "line",
      data: {
        labels: data.time,
        datasets: [
          {
            label: "中心氣壓 (hPa)",
            data: data.pressure,
            borderColor: "#ff6b6b",
          },
        ],
      },
    });
  }, []);

  return (
    <div style={{ marginTop: 40 }}>
      <h2>🌪️ 颱風預測展示</h2>

      <h3>最大風速</h3>
      <canvas ref={windRef} height="120"></canvas>

      <h3 style={{ marginTop: 30 }}>中心氣壓</h3>
      <canvas ref={pressureRef} height="120"></canvas>
    </div>
  );
}
