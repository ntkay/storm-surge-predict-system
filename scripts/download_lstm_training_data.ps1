param(
    [int]$FirstYear = 2000,
    [int]$LastYear = 2024
)

$ErrorActionPreference = 'Stop'
$outputDirectory = Join-Path (Split-Path -Parent $PSScriptRoot) 'data/lstm-training/cwa'
New-Item -ItemType Directory -Force -Path $outputDirectory | Out-Null

$base = 'https://ocean.cwa.gov.tw/V2/'
$session = New-Object Microsoft.PowerShell.Commands.WebRequestSession
$headers = @{ 'User-Agent' = 'Mozilla/5.0' }
Invoke-WebRequest -Uri "${base}data_interface/download?all_formats=CSV&dataset=API-Tide6haH&format=CSV" -WebSession $session -Headers $headers -TimeoutSec 30 | Out-Null
$ticketResponse = Invoke-WebRequest -Uri "${base}menu_process/get_api_config" -Method Post -WebSession $session `
    -Headers ($headers + @{ 'X-Requested-With' = 'XMLHttpRequest'; 'Referer' = "${base}data_interface/download" }) `
    -Body @{} -TimeoutSec 30
$ticket = ($ticketResponse.Content | ConvertFrom-Json).ticket
if (-not $ticket) { throw 'CWA did not return a public download ticket.' }

$failures = @()
foreach ($stationId in @('1226', '1246')) {
    $stationFirstYear = if ($stationId -eq '1226') { [Math]::Max($FirstYear, 2001) } else { $FirstYear }
    for ($year = $stationFirstYear; $year -le $LastYear; $year++) {
        $destination = Join-Path $outputDirectory "$stationId-$year.zip"
        if (Test-Path -LiteralPath $destination) { continue }
        $url = "https://oceanapi.cwa.gov.tw/restapi/v2/PROVIDE/getTideData?longname=Tide-his&stid=$stationId&time_start=$year&time_end=$year&var=tide&output_type=csv&ticket=$ticket"
        try {
            $response = Invoke-WebRequest -Uri $url -WebSession $session -Headers $headers -TimeoutSec 90
            [byte[]]$bytes = $response.Content
            if ($bytes.Length -lt 10000 -or $bytes[0] -ne 0x50 -or $bytes[1] -ne 0x4b) {
                throw "Unexpected response for station $stationId in $year."
            }
            [IO.File]::WriteAllBytes($destination, $bytes)
            Write-Host "Downloaded $stationId $year ($($bytes.Length) bytes)"
        } catch {
            $failures += "$stationId $year`: $($_.Exception.Message)"
            Write-Warning $failures[-1]
        }
        Start-Sleep -Milliseconds 200
    }
}

if ($failures.Count) {
    throw "Some annual CWA archives failed:`n$($failures -join "`n")"
}
Write-Host "CWA tide archives are ready in $outputDirectory"
