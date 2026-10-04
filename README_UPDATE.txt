龍洞 BPNN 示範更新 — 2026/10/04

已套用 Downloads/BPNN_Model_Export_20261004.zip 的原始匯出內容至 models/longdong-bpnn/。
shared/longdongBpnnSummary.json 保存同一份摘要供 src/LongdongBpnnDemo.jsx 顯示。
暴潮預測區新增龍洞 BPNN 架構、+1/+3/+6 小時集成測試指標及測試事件。
示範表格是匯出模型的固定測試結果，不隨上方颱風期間改變；蘇澳不套用龍洞模型。
匯出包未包含逐時特徵與預測序列，尚未執行推論，不生成示意預測數字。
權重維持原始 NPZ 格式；MATLAB loadModelRows 接口與既有 API 回傳格式保留。
輸入為連續 24 小時 x 8 特徵，依包內 README 順序；目標 surgeC_cm 為 cm，
接入 predicted_surge 時須除以 100 換為 m，時間需包含時區。
測試 RMSE/MAE 依目標標示 cm；peak_error_m 欄名與目標單位存在疑義，未展示。

以下為既有颱風潮位／MATLAB 接口說明。

基於 C:\Users\User\projects\web-app 目前已套用的事件分析最新版。
同一個外層 card，內含「颱風潮位」與「暴潮預測」兩個 section。
下方預測區以紫色底、分隔線與獨立標題區分。
潮位站選單與兩個 API 僅支援龍洞潮位站、蘇澳潮位站。
保留 mapping：龍洞 C4A02 / 1226；蘇澳 C4U01 / 1246。
保留年份、颱風、事件前後 24 小時選項與實測／天文潮／暴潮增水三條曲線。
上方即時颱風與既有歷史路徑功能保留。

MATLAB 接口
GET /api/model-surge?station=C4A02&start=2023-07-24T00:00:00Z&end=2023-07-30T00:00:00Z
station 支援上述現行站碼與舊站碼；start/end 必須含時區，最長 120 天。
api/model-surge.js 的 loadModelRows({station,start,end}) 是待接資料 adapter。
目前回傳空陣列，畫面顯示「尚未接入 MATLAB 預測資料」，未產生模擬數字。
未來 adapter 回傳真實 MATLAB 輸出列：
{ station: 'C4A02', time: '含時區的 ISO 時間', predicted_surge: 數值 }
predicted_surge 單位公尺；必須由模型提供，不能拿 surgeAnomaly 代替。
API 篩選同站同期間的有效列，前端有預測資料時顯示獨立資料表。
未來作實測比較前，須確認時間、單位、站點及垂直基準一致。
目前未接實際 MATLAB 模型，未驗證模型準確度。
歷史潮位仍受既有 CWA 發布資料期間限制；缺資料不以近期值代替。

套用全部九個程式檔及本說明，保留其他檔案。不需新增套件。
下載 ZIP 至 Downloads 後在 PowerShell 執行：

$updateZip = Join-Path $env:USERPROFILE 'Downloads\storm-surge-panel-update.zip'
$updateDir = Join-Path $env:USERPROFILE 'Downloads\storm-surge-panel-update'
Expand-Archive -LiteralPath $updateZip -DestinationPath $updateDir -Force
Set-Location -LiteralPath 'C:\Users\User\projects\web-app'
$updateFiles = @('src/App.jsx','src/EventSurgePanel.jsx','src/ModelSurgePanel.jsx','src/eventCatalog.js','shared/tideStations.js','api/surge.js','api/model-surge.js','api/typhoon-history.js','vite.config.js','README_UPDATE.txt')
$backupDir = Join-Path $env:USERPROFILE ('Downloads\storm-surge-backup-' + (Get-Date -Format 'yyyyMMdd-HHmmss'))
foreach ($relative in $updateFiles) {
  if (Test-Path -LiteralPath $relative) {
    $backupFile = Join-Path $backupDir $relative
    New-Item -ItemType Directory -Path (Split-Path -Parent $backupFile) -Force | Out-Null
    Copy-Item -LiteralPath $relative -Destination $backupFile
  }
  $targetFile = Join-Path (Get-Location).Path $relative
  New-Item -ItemType Directory -Path (Split-Path -Parent $targetFile) -Force | Out-Null
  Copy-Item -LiteralPath (Join-Path $updateDir $relative) -Destination $targetFile -Force
}
npm.cmd run build

GitHub 上傳（確認 build 成功後）
git status --short
git branch --show-current
git diff -- src/App.jsx src/EventSurgePanel.jsx src/ModelSurgePanel.jsx src/eventCatalog.js shared/tideStations.js api/surge.js api/model-surge.js api/typhoon-history.js vite.config.js README_UPDATE.txt
git diff --cached --name-only
最後一個指令若列出其他已暫存檔案，先確認是否要包含，避免一起提交。
確認目前分支為 main，再執行：
git add -- src/App.jsx src/EventSurgePanel.jsx src/ModelSurgePanel.jsx src/eventCatalog.js shared/tideStations.js api/surge.js api/model-surge.js api/typhoon-history.js vite.config.js README_UPDATE.txt
git diff --cached --stat
git commit -m "Separate typhoon tides and MATLAB surge predictions"
git push origin main
若分支不是 main，請使用確認過的目前分支名稱替換 push 的 main。
本更新不自動提交或推送。Vercel 連接該分支時依其設定部署。
伺服器沿用原有 CWA_API_KEY，請勿上傳 .env。

交付檢查：npm run build 正式建置通過；api/surge.js、api/model-surge.js 語法檢查通過；兩站 mapping、新舊站碼、無模型空資料、其他站點拒絕、HTTP 方法檢查通過。未連線驗證實際 CWA 歷史資料或 MATLAB 模型。
