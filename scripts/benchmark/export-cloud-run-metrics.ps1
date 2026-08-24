param(
  [Parameter(Mandatory = $true)][string]$ProjectId,
  [Parameter(Mandatory = $true)][datetime]$StartTime,
  [Parameter(Mandatory = $true)][datetime]$EndTime,
  [Parameter(Mandatory = $true)][string]$OutputPath
)

$ErrorActionPreference = "Stop"
$token = (& gcloud auth print-access-token).Trim()
if (-not $token) { throw "gcloud access token unavailable" }
$headers = @{ Authorization = "Bearer $token" }
$services = @(
  "tm-dev-web", "tm-dev-public-bff", "tm-dev-intent-provenance",
  "tm-dev-agent-runtime", "tm-dev-authority", "tm-dev-gateway",
  "tm-dev-outcome-resolution"
)

function Get-Series([string]$service, [string]$metric, [string]$aligner, [string]$extraFilter = "") {
  $filter = "resource.type=`"cloud_run_revision`" AND resource.labels.service_name=`"$service`" AND metric.type=`"$metric`"$extraFilter"
  $query = @{
    filter = $filter
    "interval.startTime" = $StartTime.ToUniversalTime().ToString("o")
    "interval.endTime" = $EndTime.ToUniversalTime().ToString("o")
    "aggregation.alignmentPeriod" = "60s"
    "aggregation.perSeriesAligner" = $aligner
    view = "FULL"
  }
  $encoded = ($query.GetEnumerator() | ForEach-Object { "{0}={1}" -f [uri]::EscapeDataString($_.Key), [uri]::EscapeDataString([string]$_.Value) }) -join "&"
  $uri = "https://monitoring.googleapis.com/v3/projects/$ProjectId/timeSeries?$encoded"
  return (Invoke-RestMethod -Headers $headers -Uri $uri -Method Get).timeSeries
}

function Point-Value($point) {
  if ($null -ne $point.value.doubleValue) { return [double]$point.value.doubleValue }
  if ($null -ne $point.value.int64Value) { return [double]$point.value.int64Value }
  return 0.0
}

$rows = @()
foreach ($service in $services) {
  $metricSets = @{
    requestCount = Get-Series $service "run.googleapis.com/request_count" "ALIGN_SUM"
    errorCount = Get-Series $service "run.googleapis.com/request_count" "ALIGN_SUM" " AND metric.labels.response_code_class=`"5xx`""
    instanceCount = Get-Series $service "run.googleapis.com/container/instance_count" "ALIGN_MAX"
    cpuUtilization = Get-Series $service "run.googleapis.com/container/cpu/utilizations" "ALIGN_PERCENTILE_95"
    memoryUtilization = Get-Series $service "run.googleapis.com/container/memory/utilizations" "ALIGN_PERCENTILE_95"
    requestLatencyP95Ms = Get-Series $service "run.googleapis.com/request_latencies" "ALIGN_PERCENTILE_95"
  }
  $points = @{}
  foreach ($entry in $metricSets.GetEnumerator()) {
    foreach ($series in @($entry.Value)) {
      foreach ($point in @($series.points)) {
        $at = [string]$point.interval.endTime
        if (-not $points.ContainsKey($at)) { $points[$at] = @{ service = $service; observedAt = $at; requestCount = 0; errorCount = 0; instanceCount = 0 } }
        $value = Point-Value $point
        if ($entry.Key -eq "requestLatencyP95Ms") { $value = $value / 1e6 }
        $points[$at][$entry.Key] = $value
      }
    }
  }
  $rows += $points.Values
}

$parent = Split-Path -Parent $OutputPath
if ($parent) { New-Item -ItemType Directory -Path $parent -Force | Out-Null }
$rows | Sort-Object observedAt, service | ForEach-Object { $_ | ConvertTo-Json -Compress } | Set-Content -LiteralPath $OutputPath -Encoding utf8
Write-Output "Exported $($rows.Count) Cloud Run metric rows to $OutputPath"
