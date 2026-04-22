param(
  [switch]$Build
)

$ErrorActionPreference = 'Stop'

$composeArgs = @('--env-file', '.env.local-sdr', '--profile', 'sdr', 'up', '-d')
if ($Build) {
  $composeArgs += '--build'
}

Write-Host "Starting Civic_Grid in LOCAL SDR mode using .env.local-sdr..." -ForegroundColor Cyan
docker compose @composeArgs
