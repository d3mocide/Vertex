# Civic_Grid

See your neighborhood sharper

## Environment Modes

Use separate env files for each runtime mode, then choose one with `--env-file`.

### 1) Remote Radio Mode (lean local stack)

- Copy `.env.remote.example` to `.env.remote`
- Set your remote OP25/Icecast host values
- Start with:

```bash
docker compose --env-file .env.remote up -d
```

This runs the core app stack while consuming remote radio infrastructure.

### 2) Full Local SDR Mode

- Copy `.env.local-sdr.example` to `.env.local-sdr`
- Set local SDR device values/credentials
- Start with:

```bash
docker compose --env-file .env.local-sdr --profile sdr up -d
```

This runs local OP25/Icecast/SDR-related services.

### Why This Is Clean

- No more single overloaded `.env` for all scenarios
- One file per mode keeps values obvious and avoids accidental cross-mode settings
- Backend and poller now consume the selected mode file through `CIVICGRID_ENV_FILE`

## Quick Mode Scripts (PowerShell)

From the project root on Windows:

- Remote mode:

```powershell
.\up-remote.ps1
```

- Remote mode with rebuild:

```powershell
.\up-remote.ps1 -Build
```

- Full local SDR mode:

```powershell
.\up-local-sdr.ps1
```

- Full local SDR mode with rebuild:

```powershell
.\up-local-sdr.ps1 -Build
```
