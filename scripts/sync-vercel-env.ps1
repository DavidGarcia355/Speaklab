param(
  [string]$EnvFile = ".env.local",
  [string[]]$Targets = @("preview"),
  [switch]$IncludeOptionalClientEnv
)

$ErrorActionPreference = "Stop"

if (-not (Get-Command vercel.cmd -ErrorAction SilentlyContinue)) {
  Write-Error "vercel CLI not found. Install with: npm install -g vercel"
}

if (-not (Test-Path $EnvFile)) {
  Write-Error "Env file '$EnvFile' not found."
}

$requiredKeys = @(
  "AUTH_GOOGLE_ID",
  "AUTH_GOOGLE_SECRET",
  "AUTH_SECRET",
  "SCHOOL_GOOGLE_DOMAIN",
  "TEACHER_EMAILS",
  "TURSO_DATABASE_URL",
  "TURSO_AUTH_TOKEN",
  "UPSTASH_REDIS_REST_URL",
  "UPSTASH_REDIS_REST_TOKEN",
  "BLOB_READ_WRITE_TOKEN",
  "CRON_SECRET",
  "NEXTAUTH_URL"
)

$optionalClientKeys = @(
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY"
)

$selectedKeys = @($requiredKeys)
if ($IncludeOptionalClientEnv) {
  $selectedKeys += $optionalClientKeys
}

$values = @{}
Get-Content $EnvFile | ForEach-Object {
  $line = $_.Trim()
  if (-not $line -or $line.StartsWith("#")) { return }
  if ($line -notmatch "^[A-Za-z_][A-Za-z0-9_]*=") { return }
  $parts = $line -split "=", 2
  $key = $parts[0].Trim()
  $value = $parts[1]
  $values[$key] = $value
}

$missing = @()
foreach ($key in $requiredKeys) {
  if (-not $values.ContainsKey($key) -or [string]::IsNullOrWhiteSpace($values[$key])) {
    $missing += $key
  }
}
if ($missing.Count -gt 0) {
  Write-Error "Missing required env values in ${EnvFile}: $($missing -join ', ')"
}

foreach ($target in $Targets) {
  Write-Host "Syncing envs to Vercel target: $target"
  foreach ($key in $selectedKeys) {
    if (-not $values.ContainsKey($key)) { continue }
    $value = $values[$key]
    if ([string]::IsNullOrWhiteSpace($value)) { continue }

    # Remove existing key if present (ignore failures)
    try {
      vercel.cmd env rm $key $target -y | Out-Null
    } catch {
      # no-op
    }

    $value | vercel.cmd env add $key $target | Out-Null
    Write-Host "  set $key"
  }
}

Write-Host "Vercel env sync complete."
