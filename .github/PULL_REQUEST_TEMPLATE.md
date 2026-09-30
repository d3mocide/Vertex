## What and why

## Checks
- [ ] `cd frontend && npx tsc --noEmit` passes (if the frontend changed)
- [ ] `docker compose config --quiet` passes (if compose files changed)
- [ ] `pytest` passes in `poller/` and `backend/` (if those changed)
- [ ] `TASK_LOG.md` entry added
- [ ] No secrets, personal paths, LAN IPs, or real coordinates in the diff (see the Privacy section of `CLAUDE.md`)
- [ ] Screenshots (if any) show no private location or personal devices
