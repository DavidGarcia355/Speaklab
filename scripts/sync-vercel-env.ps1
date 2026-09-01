param(
  [string]$EnvFile = ".env.local",
  [string[]]$Targets = @("preview"),
  [switch]$IncludeOptionalClientEnv,
  [switch]$PrivateDeployment,
  [string]$ProductionOrigin = "https://tryhabla.com"
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
  "TURSO_DATABASE_URL",
  "TURSO_AUTH_TOKEN",
  "UPSTASH_REDIS_REST_URL",
  "UPSTASH_REDIS_REST_TOKEN",
  "AUDIO_BLOB_STORE_ID",
  "CRON_SECRET",
  "NEXTAUTH_URL"
)

# Preview deployments may omit these controls and remain closed. Production
# requires an explicit registration policy so a public Start free release cannot
# silently sync an invite-only runtime configuration.
$managedOptionalServerKeys = @(
  "TEACHER_ALLOWLIST",
  "ALLOW_TEACHER_SELF_REGISTRATION"
)

$optionalClientKeys = @(
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY"
)

$selectedKeys = @($requiredKeys) + @($managedOptionalServerKeys)
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

if ($Targets -contains "production") {
  $nextAuthUrl = $values["NEXTAUTH_URL"].Trim().TrimEnd("/")
  $reviewedProductionOrigin = $ProductionOrigin.Trim().TrimEnd("/")
  if ($nextAuthUrl -notmatch '^https://[^/?#]+(?::\d+)?$') {
    Write-Error "NEXTAUTH_URL must be an HTTPS origin with no path, query, or fragment before syncing production."
  }
  if ($nextAuthUrl -ne $reviewedProductionOrigin) {
    Write-Error "NEXTAUTH_URL must match the reviewed production origin '$reviewedProductionOrigin' before syncing production."
  }
  if (
    $values.ContainsKey("LOCAL_DEV_BYPASS_AUTH") -and
    $values["LOCAL_DEV_BYPASS_AUTH"].Trim().ToLowerInvariant() -eq "true"
  ) {
    Write-Error "LOCAL_DEV_BYPASS_AUTH=true is local-only and cannot be present in a production sync source."
  }
  foreach ($secretKey in @("AUTH_SECRET", "CRON_SECRET")) {
    if ($values[$secretKey].Trim().Length -lt 32) {
      Write-Error "$secretKey must contain at least 32 characters before syncing production."
    }
  }

  $registrationKey = "ALLOW_TEACHER_SELF_REGISTRATION"
  if (-not $values.ContainsKey($registrationKey) -or [string]::IsNullOrWhiteSpace($values[$registrationKey])) {
    Write-Error "$registrationKey must be explicit for production: true for public TryHabla, or false with -PrivateDeployment."
  }

  $registrationValue = $values[$registrationKey].Trim().ToLowerInvariant()
  if ($registrationValue -notin @("true", "false")) {
    Write-Error "$registrationKey must be either true or false."
  }
  if ($registrationValue -eq "false" -and -not $PrivateDeployment) {
    Write-Error "$registrationKey=false requires -PrivateDeployment because public TryHabla advertises Start free."
  }
  if ($registrationValue -eq "true" -and $PrivateDeployment) {
    Write-Error "$registrationKey=true conflicts with -PrivateDeployment; set it to false for invite-only access."
  }
}

foreach ($target in $Targets) {
  Write-Host "Syncing envs to Vercel target: $target"
  $listingJson = & vercel.cmd env ls $target --format json 2>$null
  if ($LASTEXITCODE -ne 0) {
    throw "Could not list existing Vercel environment variables for target '$target'."
  }
  try {
    $listing = ($listingJson -join [Environment]::NewLine) | ConvertFrom-Json
    $existingKeys = @($listing.envs | ForEach-Object { $_.key })
  } catch {
    throw "Vercel returned an unreadable environment-variable inventory for target '$target'."
  }

  foreach ($key in $selectedKeys) {
    if (-not $values.ContainsKey($key) -or [string]::IsNullOrWhiteSpace($values[$key])) {
      if ($existingKeys -contains $key) {
        & vercel.cmd env rm $key $target -y | Out-Null
        if ($LASTEXITCODE -ne 0) {
          throw "Could not clear optional Vercel environment variable '$key' for target '$target'."
        }
        Write-Host "  cleared optional $key"
      } else {
        Write-Host "  optional $key already absent"
      }
      continue
    }

    $value = $values[$key]
    $value | & vercel.cmd env add $key $target --force -y | Out-Null
    if ($LASTEXITCODE -ne 0) {
      throw "Could not set Vercel environment variable '$key' for target '$target'."
    }
    Write-Host "  set $key"
  }
}

Write-Host "Migration-only BLOB_READ_WRITE_TOKEN and AUDIO_READ_WRITE_TOKEN were intentionally not synced."
Write-Host "Vercel env sync complete."
