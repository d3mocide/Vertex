param(
  [switch]$Build
)

$ErrorActionPreference = 'Stop'

$composeArgs = @('--env-file', '.env.remote', 'up', '-d')
if ($Build) {
  $composeArgs += '--build'
}

Write-Host "Starting Civic_Grid in REMOTE mode using .env.remote..." -ForegroundColor Cyan
docker compose @composeArgs
