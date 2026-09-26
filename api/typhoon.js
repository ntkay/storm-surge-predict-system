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

  const url = new URL(
    "https://opendata.cwa.gov.tw/api/v1/rest/datastore/W-C0034-005"
  );

  url.searchParams.set("Authorization", apiKey);
  url.searchParams.set("format", "JSON");

  try {
    const response = await fetch(url.toString(), {
      method: "GET",
      headers: {
        Accept: "application/json",
      },
    });

    const rawText = await response.text();

    if (!response.ok) {
      return res.status(502).json({
        success: false,
        message: `CWA API returned HTTP ${response.status}`,
        detail: rawText.slice(0, 500),
      });
    }

    let data;

    try {
      data = JSON.parse(rawText);
    } catch {
      return res.status(502).json({
        success: false,
        message: "CWA API did not return valid JSON",
        detail: rawText.slice(0, 500),
      });
    }

    res.setHeader(
      "Cache-Control",
      "no-store, no-cache, must-revalidate, proxy-revalidate"
    );

    return res.status(200).json(data);
  } catch (error) {
    console.error("CWA fetch failed:", error);

    return res.status(502).json({
      success: false,
      message: "Failed to fetch CWA typhoon data",
      error: error instanceof Error ? error.message : String(error),
    });
  }
}