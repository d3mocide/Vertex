# Vertex Implementation Plan — Code Review Remediation

**Source:** CODE_REVIEW.md (sessions 1–5, 2026-05-08)  
**Scope:** All CRIT / HIGH / MED / LOW / NIT findings  
**Total findings:** 6 CRIT · 19 HIGH · 40 MED · 20 LOW · 13 NIT

Work is grouped into nine parallel work packages (WPs). Packages with no inter-WP dependencies can be executed simultaneously. Hard dependencies are noted per package.

---

## Dependency Order

```
WP-4 (SQL injection)  ──────────────────────────────────────────┐
WP-5 (DB schema)      ──────────────────────────────────────────┤
WP-1 (Auth overhaul)  ──┐                                       │
WP-2 (XSS/Injection)  ──┤── all can land independently          │
WP-3 (SSRF)           ──┤                                       ├── any order
WP-6 (Backend reliability) ────────────────────────────────────-┤
WP-7 (Frontend reliability) ── depends on WP-1 auth.ts fix ─────┤
WP-8 (Poller reliability) ──────────────────────────────────────┤
WP-9 (Config/Env)     ──────────────────────────────────────────┘
```

---

## WP-1 · Auth System Overhaul

**Domains:** `backend/`, `frontend/`  
**Severity:** 3 CRIT · 2 HIGH · 5 MED · 2 LOW

This is the highest-leverage package: several other findings are symptoms of a broken auth foundation.

### Backend

#### [CRIT] `backend/config.py:17` — Empty `auth_secret_key` allows forged JWTs
```
Raise ValueError at app startup when auth_enabled=True and
len(auth_secret_key) < 32. Add validator:

  @model_validator(mode='after')
  def _check_secret(self):
      if self.auth_enabled and len(self.auth_secret_key) < 32:
          raise ValueError("AUTH_SECRET_KEY must be ≥32 chars when AUTH_ENABLED=true")
      return self
```

#### [CRIT] `backend/auth_middleware.py:49` — Missing `role` defaults to `admin`
```
Change:
  role = payload.get("role", "admin")
To:
  role = payload.get("role") or "viewer"

Same fix required in routers/auth.py:80 and routers/auth.py:146.
```

#### [HIGH] `backend/routers/auth.py` — JWT decode duplicated, `_decode_admin` fragile
```
Create backend/security.py with a single decode_token() function:
  - Uses the shared settings.auth_secret_key and algorithm
  - Raises HTTPException(401) on any failure (no bare except)
  - Returns the decoded payload dict

Replace _decode_admin() calls in routers/auth.py with:
  Depends(get_current_admin_user)  — a new FastAPI dependency
  that calls decode_token() and checks role == "admin"

Update auth_middleware.py to call the same decode_token().
```

#### [MED] `backend/auth_middleware.py:21` — Entire `/api/v1/auth/` prefix bypassed
```
Change the bypass condition from:
  path.startswith("/api/v1/auth/")
To explicit allowlist:
  path in {"/api/v1/auth/login", "/api/v1/auth/setup", "/api/v1/auth/status"}

User-management routes GET/PATCH/DELETE /auth/users/* will now go through
middleware and rely on the Depends(get_current_admin_user) dependency.
```

#### [MED] `backend/routers/auth.py:100-101` — TOCTOU race in `/auth/setup`
```
Remove the _user_count() pre-check.
Attempt the INSERT directly and catch asyncpg.exceptions.UniqueViolationError
(or sqlalchemy IntegrityError) to return 409 Conflict.
Add UNIQUE constraint to users.username if not present (already in schema).
```

#### [MED] `backend/routers/auth.py:63` — `_make_token` defaults role to `admin`
```
Remove the default: def _make_token(username: str, role: str) -> str:
All call sites already pass role explicitly.
```

#### [LOW] `backend/routers/admin.py:36` — GET admin routes readable by viewer
```
Add Depends(get_current_admin_user) to all GET routes in admin.py,
not just mutating routes.
```

#### [HIGH] `backend/routers/admin.py:36-88` — Admin endpoints fully public when auth disabled
```
Wrap all admin routes with a dependency that checks admin role regardless of
auth_enabled. When auth is disabled this should still require a network-local
originator, or document explicitly that admin routes are trust-based.
Option A (recommended): Require AUTH_ENABLED=true for admin routes; return 503
with a clear message if not.
Option B: Enforce via Nginx allow/deny on /api/v1/admin/* to localhost only.
```

### Frontend

#### [CRIT] `frontend/src/auth.ts:10,17` — Missing/corrupt token falls through to `'admin'`
```
getUserRole():
  - Return 'viewer' when localStorage has no token (line 10)
  - Return 'viewer' inside the catch block (line 17)
  - Return 'viewer' when the payload has no 'role' claim

getUserRole() must NEVER return 'admin' for an unauthenticated caller.
```

#### [HIGH] `frontend/src/main.tsx:10` — Admin route guard relies on broken getUserRole()
```
After fixing getUserRole(), the existing guard logic works correctly.
Also add: if the backend /auth/status check fails, redirect to login rather
than granting access (see WP-7 App.tsx fix).
```

---

## WP-2 · XSS and Injection Fixes

**Domains:** `frontend/`, `poller/`  
**Severity:** 1 CRIT · 1 HIGH · 1 HIGH

#### [CRIT] `frontend/src/components/MapOverlay.tsx` — XSS via `innerHTML`
```
Replace tooltip.innerHTML = html with safe DOM construction.

Strategy:
1. Create a helper: function escHtml(s: string): string that uses
   document.createElement('span').textContent = s; return span.innerHTML
   (or a simple manual escape of &, <, >, ", ')

2. Replace every interpolated variable in the html template literal with
   escHtml(value ?? '').

3. For the outer structure, keep innerHTML only for the wrapper tags
   (which contain no external data), and set .textContent on leaf nodes.

Alternatively, refactor to build the tooltip using createElement/appendChild
throughout, using .textContent for all user-data fields.

Affected values: callsign, uid, category, cam.name, cam.road, ev.summary,
gauge.name, node.name, node.status, sat.name, geofence.name, and others.
```

#### [HIGH] `poller/pollers/cot_emitter.py:77` — XML injection in CoT output
```
Import xml.sax.saxutils at top of file.

Replace every variable interpolated into the XML f-string with:
  xml.sax.saxutils.escape(str(value))   for element text
  xml.sax.saxutils.quoteattr(str(value)) for attribute values

Applies to: _build_cot() and _build_annotation_cot() — all parameters
from external sources (callsign, uid, remarks, cot_type, lat, lon, alt_m).
```

#### [HIGH] `poller/pollers/summary.py:87-118` — Prompt injection via Redis feed data
```
Before composing the LLM prompt, sanitise each field:

def _sanitise_for_prompt(text: str, max_len: int = 300) -> str:
    # Strip known injection patterns
    for pat in ('###', 'SYSTEM:', '<|', '[INST]', '<<SYS>>'):
        text = text.replace(pat, '')
    return text[:max_len].strip()

Apply to: weather alert descriptions, fire incident titles, traffic events,
news headlines — every field read from Redis before interpolation into the prompt.
```

---

## WP-3 · SSRF Fixes

**Domains:** `backend/`, `poller/`, `frontend/`  
**Severity:** 2 HIGH · 3 MED

#### [HIGH] `backend/webhook_dispatcher.py:90-113` — SSRF via stored webhook URL
```
Add a validate_webhook_url(url: str) function in backend/security.py:
  - Parse with urllib.parse.urlparse
  - Reject non-http/https schemes
  - Resolve hostname to IP, reject RFC-1918 (10/8, 172.16/12, 192.168/16),
    loopback (127/8), and link-local (169.254/16) addresses
  - Raise ValueError on rejection

Call before every httpx.post() in _dispatch_webhook.
```

#### [HIGH] `backend/routers/alertrules.py:62-64` — Webhook URL accepted without validation
```
Add to the AlertRuleCreate schema:
  from pydantic import HttpUrl, field_validator

  @field_validator('action_config')
  def validate_webhook_url(cls, v):
      if v.get('url'):
          validate_webhook_url(v['url'])  # reuse security.py helper
      return v

Same validator on AlertRuleUpdate.
```

#### [MED] `poller/pollers/traffic.py:286-313` — SSRF via ODOT camera URLs
```
Before issuing HEAD to camera URL, validate it:
  from urllib.parse import urlparse
  import ipaddress

  def _is_public_url(url: str) -> bool:
      parsed = urlparse(url)
      if parsed.scheme not in ('http', 'https'):
          return False
      try:
          ip = ipaddress.ip_address(parsed.hostname)
          return ip.is_global
      except ValueError:
          pass  # hostname, not IP — DNS not checked here, acceptable for Pi
      return True

Skip camera health check if _is_public_url() returns False.
```

#### [MED] `frontend/src/components/layout/AlertRulesSection.tsx:~80` — No client-side webhook scheme check
```
On form submit:
  if (webhookUrl && !/^https?:\/\//i.test(webhookUrl)) {
    setError('Webhook URL must start with http:// or https://');
    return;
  }
```

#### [MED] `frontend/src/components/panels/TacticalAudio.tsx:~55` — Audio URL from backend
```
const safeUrl = /^https?:\/\//i.test(selectedStream.url) ? selectedStream.url : '';
<audio src={safeUrl} ... />
```

---

## WP-4 · SQL Injection Fix

**Domain:** `poller/`  
**Severity:** 1 CRIT

#### [CRIT] `poller/db.py:122` — SQL injection via Redis-controlled `retention_days`
```
Change from:
  f"DELETE FROM observations WHERE ts < NOW() - INTERVAL '{retention_days} days'"

To parameterised form using asyncpg:
  await conn.execute(
      "DELETE FROM observations WHERE ts < NOW() - ($1 * INTERVAL '1 day')",
      int(retention_days)
  )

Also add: validate that retention_days is a positive integer before use.
  retention_days = max(1, min(int(retention_days), 3650))
```

---

## WP-5 · Database Schema Fixes

**Domain:** `db/`  
**Severity:** 3 HIGH · 6 MED · 4 LOW · 5 NIT  
**Note:** Most changes require a `docker compose down -v && docker compose up -d` to apply to a fresh DB. Document this requirement.

### Security / Integrity

#### [HIGH] `db/init/01_schema.sql:116-121` — Default role `'admin'` on users
```
Change:
  role VARCHAR(32) NOT NULL DEFAULT 'admin'
To:
  role VARCHAR(32) NOT NULL DEFAULT 'viewer'
```

#### [HIGH] `db/init/01_schema.sql:106-109` — `purge_old_observations()` no privilege restriction
```
After the CREATE FUNCTION block, add:
  REVOKE EXECUTE ON FUNCTION purge_old_observations() FROM PUBLIC;
  GRANT EXECUTE ON FUNCTION purge_old_observations() TO vertex_app;

Also add SECURITY DEFINER SET search_path = public to the function header.
```

#### [HIGH] `db/init/01_schema.sql:51-64` — `events.entity_id` no FK
```
Add to events table definition:
  entity_id VARCHAR(64) REFERENCES entities(entity_id) ON DELETE SET NULL,

(replace the current bare entity_id VARCHAR(64) declaration)
```

#### [MED] `db/init/04_entity_mission_tags.sql:2-9` — `entity_mission_tags.entity_id` no FK
```
Add ON DELETE CASCADE to the column definition:
  entity_id VARCHAR(64) NOT NULL REFERENCES entities(entity_id) ON DELETE CASCADE,
```

### Schema Correctness

#### [MED] `db/init/01_schema.sql:28-42` — nullable lat/lon/geom inconsistency
```
Add CHECK constraint to observations table:
  CONSTRAINT observations_coords_consistent
    CHECK (
      (lat IS NULL) = (lon IS NULL)
      AND (lat IS NULL) = (geom IS NULL)
    )
```

#### [MED] `db/init/01_schema.sql:69-84` — `geofences.geom` typed POLYGON, stores circles
```
Change:
  geom GEOMETRY(POLYGON, 4326),
To:
  geom GEOMETRY(GEOMETRY, 4326),

Add CHECK constraints per shape type:
  CONSTRAINT geofences_circle_requires_radius
    CHECK (geofence_shape <> 'circle' OR (radius_m IS NOT NULL AND center_lat IS NOT NULL)),
  CONSTRAINT geofences_polygon_requires_geom
    CHECK (geofence_shape <> 'polygon' OR geom IS NOT NULL)
```

#### [MED] `db/init/02_geofences.sql:4` — Seed INSERTs not idempotent
```
Add UNIQUE(name) to geofences table in 01_schema.sql.
Change all INSERTs in 02_geofences.sql to:
  INSERT INTO geofences (...) VALUES (...) ON CONFLICT (name) DO NOTHING;
```

#### [MED] `db/init/03_sources.sql:18-28` — `news_feeds.url` nullable
```
Change:
  url TEXT,
To:
  url TEXT NOT NULL,
```

### Cleanup

#### [MED] `db/init/01_schema.sql:123` — Redundant index on `username`
```
Remove:
  CREATE INDEX IF NOT EXISTS ix_users_username ON users (username);
The UNIQUE constraint already creates this index.
```

#### [LOW] `db/init/01_schema.sql:52` — `uuid-ossp` installed but unused
```
Remove line: CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
The built-in gen_random_uuid() is used everywhere.
```

#### [LOW] `db/init/01_schema.sql:89-99` — `alert_rules.action_config` stores secrets in plaintext
```
Add a comment above the column definition:
  -- SECURITY: Store only references (env var names, Vault paths), never inline secrets.
  -- Webhook tokens and passwords must not be stored here in plaintext.

Add CHECK constraint:
  CONSTRAINT alert_rules_no_inline_secrets
    CHECK (NOT (action_config ? 'token' OR action_config ? 'secret' OR action_config ? 'password'))
```

#### [LOW] `db/init/04_entity_mission_tags.sql:13-16` — ALTER TABLE scattered across init files
```
Move the three column additions (cooldown_seconds, max_per_hour, dedup_key)
from 04_entity_mission_tags.sql into the CREATE TABLE alert_rules block in
01_schema.sql. Remove the ALTER TABLE statements from 04_entity_mission_tags.sql.
```

#### [LOW] `db/init/05_annotations.sql:1-14` — `annotations.created_by` no FK
```
Add to the annotations CREATE TABLE:
  created_by VARCHAR(64) REFERENCES users(username) ON DELETE SET NULL,

Same for entity_mission_tags.created_by.
```

#### [NIT] `db/init/01_schema.sql:74` — `geofence_shape` naming inconsistent
```
Rename column to shape_type throughout (01_schema.sql, 02_geofences.sql,
and all application code that references this column).
```

#### [NIT] `db/init/03_sources.sql:31-43` — `poller_sources` no UNIQUE on (type, name)
```
Add:
  UNIQUE(type, name)
to the poller_sources table definition.
```

#### [NIT] `db/init/03_sources.sql:45-52` — `alert_zone_configs` missing index on `enabled`
```
Add:
  CREATE INDEX IF NOT EXISTS ix_alert_zone_configs_enabled
    ON alert_zone_configs (enabled);
```

---

## WP-6 · Backend Reliability and Correctness

**Domain:** `backend/`  
**Severity:** 1 CRIT · 4 HIGH · 11 MED · 1 LOW · 2 NIT

### Security / Config

#### [CRIT] `backend/main.py:42-47` — CORS wildcard `allow_origins=["*"]`
```
Replace:
  allow_origins=["*"]
With:
  allow_origins=settings.cors_origins  # new field: List[str], default ["http://localhost"]

Add cors_origins: list[str] = ["http://localhost:3000", "http://localhost"]
to backend/config.py. Document in .env.example:
  CORS_ORIGINS=http://your-pi-ip:3000,http://localhost
```

#### [HIGH] `backend/main.py:49` — `/metrics` publicly unauthenticated
```
Option A (recommended for Pi): Remove Prometheus exposure from the app entirely
and serve it on a separate internal port (not exposed by Nginx):
  Instrumentator().expose(app, endpoint="/metrics", include_in_schema=False)
  # then restrict in nginx.conf: /metrics { allow 127.0.0.1; deny all; }

Option B: Add /metrics to AuthMiddleware enforcement with admin role check.
```

### Reliability

#### [HIGH] `backend/main.py:28-36` — Shutdown catches `BaseException`, silences errors
```
Change:
  except BaseException:
      pass
To:
  except asyncio.CancelledError:
      pass
  except Exception as exc:
      logger.error("[shutdown] task cleanup error: %s", exc)
```

#### [HIGH] `backend/redis_bus.py:37-43` — `r.keys("entity:*")` O(N) blocking scan
```
Replace:
  keys = await r.keys("entity:*")
With cursor-based scan:
  keys = []
  cur, batch = await r.scan(0, match="entity:*", count=100)
  keys.extend(batch)
  while cur:
      cur, batch = await r.scan(cur, match="entity:*", count=100)
      keys.extend(batch)

Or maintain a Redis Set 'entities:index': add entity_id on write, use SMEMBERS.
```

#### [HIGH] `backend/webhook_dispatcher.py:116-152` — Dispatcher dies on Redis disconnect
```
Wrap the inner loop body in an outer while True with backoff:

  async def run_webhook_dispatcher():
      backoff = 1
      while True:
          try:
              r = get_redis()
              pubsub = r.pubsub()
              await pubsub.subscribe("civic:updates")
              backoff = 1
              async for msg in pubsub.listen():
                  ...
          except Exception as exc:
              logger.warning("[webhook] dispatcher error, retrying in %ds: %s", backoff, exc)
              await asyncio.sleep(backoff)
              backoff = min(backoff * 2, 60)
```

#### [HIGH] `backend/metrics_collector.py:89-99` — Swallows all exceptions silently
```
Change:
  except Exception:
      pass
To:
  except Exception as exc:
      logger.warning("[metrics] collection error: %s", exc)
```

### Correctness

#### [MED] `backend/rate_limit.py:30` — Rate key uses `127.0.0.1` behind Nginx
```
Replace:
  client_ip = request.client.host
With:
  client_ip = (
      request.headers.get("X-Real-IP")
      or request.headers.get("X-Forwarded-For", "").split(",")[0].strip()
      or request.client.host
  )

Update nginx.conf to pass: proxy_set_header X-Real-IP $remote_addr;
```

#### [MED] `backend/routers/observations.py:43` — `end` param not normalised to UTC
```
Add the same guard as start:
  if end.tzinfo is None:
      end = end.replace(tzinfo=timezone.utc)
```

#### [MED] `backend/webhook_dispatcher.py:135` — DB session error kills dispatcher
```
Wrap per-event DB access:
  try:
      async with AsyncSession(...) as db:
          ...
  except Exception as exc:
      logger.warning("[webhook] db error for event %s: %s", event_id, exc)
      continue
```

#### [MED] `backend/webhook_dispatcher.py:76-86` — Non-atomic Redis INCR + EXPIRE
```
Replace the two-command sequence with a Lua script:
  local count = redis.call('INCR', KEYS[1])
  if count == 1 then
      redis.call('EXPIRE', KEYS[1], ARGV[1])
  end
  return count

Execute via: r.eval(lua_script, 1, key, window_seconds)
```

#### [MED] `backend/webhook_dispatcher.py:97` — Unbounded `timeout_s`
```
Replace:
  timeout = float(cfg.get("timeout_s") or 10)
With:
  timeout = min(float(cfg.get("timeout_s") or 10), 30.0)
```

#### [MED] `backend/routers/admin.py:84-88` — POST /admin/retention writes Redis but never prunes
```
After storing the retention value in Redis, trigger an immediate purge:
  from poller.db import purge_observations  # or call via internal API
  asyncio.create_task(purge_observations(retention_days))

If the poller is separate process, document that the setting is picked up
on the poller's next scheduled purge cycle (add a comment + API response note).
```

#### [MED] `backend/routers/ws.py:9-60` — WebSocket handler cannot identify user
```
In AuthMiddleware, after successful token decode, attach to request state:
  request.state.user = payload  # {'sub': username, 'role': role, ...}

In ws.py handler, access via:
  user = getattr(request.state, 'user', None)
```

#### [MED] `backend/redis_bus.py:59-63` — New pubsub connection per WebSocket client
```
Implement a shared fan-out broadcaster:
  - One background task subscribes to "civic:updates" and maintains a set of
    asyncio.Queue instances (one per connected client)
  - Each WebSocket handler registers/deregisters its queue
  - The background task puts messages into all queues
  - Each handler reads from its queue and sends to its WebSocket

This replaces per-client r.pubsub() calls.
```

#### [MED] `backend/config_writer.py:23-30` — Sync file I/O on async event loop
```
Replace blocking calls:
  CONFIG_PATH.read_text()   → await asyncio.to_thread(CONFIG_PATH.read_text)
  CONFIG_PATH.write_text()  → await asyncio.to_thread(CONFIG_PATH.write_text, content)
```

#### [MED] `backend/routers/news.py:11`, `routers/traffic.py:11,17` — Unguarded `json.loads`
```
Wrap each json.loads call:
  try:
      data = json.loads(raw)
  except (json.JSONDecodeError, TypeError):
      return []
```

#### [MED] `backend/routers/sitrep.py:86-91` — Unescaped Redis/DB content in Markdown
```
Add a sanitise helper:
  def _safe_md(text: str, max_len: int = 500) -> str:
      # Strip characters that can embed Markdown images/links
      text = re.sub(r'!\[.*?\]\(.*?\)', '', text)  # image links
      text = re.sub(r'\[.*?\]\(.*?\)', '', text)    # hyperlinks
      return text[:max_len]

Apply to all DB/Redis-sourced fields before embedding in the Markdown report.
```

#### [MED] `backend/routers/layers.py:55` — Unbounded GeoJSON accepted
```
Add a Pydantic validator to LayerCreate:
  @field_validator('geojson')
  def validate_geojson_size(cls, v):
      import json
      raw = json.dumps(v)
      if len(raw) > 5 * 1024 * 1024:  # 5 MB cap
          raise ValueError("GeoJSON payload exceeds 5 MB limit")
      return v
```

#### [MED] `backend/routers/sources.py:208-213` — TOCTOU race on zone code uniqueness
```
Remove the pre-check query.
Attempt INSERT directly and catch sqlalchemy.exc.IntegrityError:
  try:
      db.add(new_zone)
      await db.commit()
  except IntegrityError:
      await db.rollback()
      raise HTTPException(409, "Zone code already exists")
```

### Code Quality

#### [MED] `backend/redis_bus.py:35-36` — Loop variable `r` shadows Redis client `r`
```
Rename:
  for r in results:
To:
  for raw in results:
Update all references to `r` inside the loop to `raw`.
```

#### [LOW] `backend/db/session.py:35` — IntegrityError matched on internal PG index name
```
Replace the string-match guard with:
  from asyncpg.exceptions import UniqueViolationError
  except UniqueViolationError:
      ...  # handle duplicate
Or use SQLAlchemy's IntegrityError with constraint name from the DDL.
```

#### [NIT] `backend/redis_bus.py:59-63` — Channel name mismatch: `annotation_update`
```
Verify intent: if annotations should appear in the WebSocket stream, add
"annotation_update" to the subscription list in redis_bus.py and confirm
the poller publishes to that channel name.
If intentional (annotations not streamed), add a comment explaining why.
```

#### [NIT] Multiple GET routers — Missing `response_model` annotations
```
Add response_model= to:
  routers/weather.py, routers/alerts.py, routers/utilities.py, routers/summary.py
Define minimal TypedDict or Pydantic schemas for each return shape.
```

---

## WP-7 · Frontend Reliability and Security

**Domain:** `frontend/`  
**Severity:** 5 HIGH · 12 MED · 5 LOW · 6 NIT  
**Depends on:** WP-1 (auth.ts fix must land first)

### Map Layer Listener Leaks

#### [HIGH] `MeshLayer.tsx`, `TinyGSLayer.tsx`, `StreamGaugeLayer.tsx` — Listeners never removed
```
In each affected useEffect, capture handlers in const before registration:

  useEffect(() => {
    if (!map) return;
    const handleClick = (e: maplibregl.MapMouseEvent) => { ... };
    const handleEnter = () => { ... };
    const handleLeave = () => { ... };
    map.on('click', 'layer-id', handleClick);
    map.on('mouseenter', 'layer-id', handleEnter);
    map.on('mouseleave', 'layer-id', handleLeave);
    return () => {
      map.off('click', 'layer-id', handleClick);
      map.off('mouseenter', 'layer-id', handleEnter);
      map.off('mouseleave', 'layer-id', handleLeave);
    };
  }, [map, ...deps]);

Apply this pattern to all three files.
```

#### [MED] `GeofenceLayer.tsx:~50` — Source and layers not removed on unmount
```
Track which sources/layers were added:
  return () => {
    if (map.getLayer('geofence-fill')) map.removeLayer('geofence-fill');
    if (map.getLayer('geofence-outline')) map.removeLayer('geofence-outline');
    if (map.getSource('geofence-draw')) map.removeSource('geofence-draw');
  };
```

### WebSocket Reliability

#### [HIGH] `hooks/useWebSocket.ts:55` — Unguarded `JSON.parse` kills all real-time updates
```
Wrap in try/catch:
  try {
    const data = JSON.parse(event.data);
    // process data
  } catch (err) {
    console.warn('[ws] malformed frame, ignoring:', err);
    return;
  }
```

#### [HIGH] `hooks/useWebSocket.ts:~70` — Fixed 3s reconnect with no backoff
```
Replace the fixed setTimeout(3000) with exponential backoff:
  let reconnectDelay = 1000;
  const MAX_DELAY = 60_000;

  function scheduleReconnect() {
    setTimeout(connect, reconnectDelay);
    reconnectDelay = Math.min(reconnectDelay * 2, MAX_DELAY);
  }

  // On successful open:
  reconnectDelay = 1000;
```

### URL Validation

#### [HIGH] `CameraModal.tsx:~45` — Camera URL without protocol check
```
const rawUrl = selectedCam.ldi_url ?? selectedCam.url ?? '';
const safeUrl = /^https?:\/\//i.test(rawUrl) ? rawUrl : '';
// Use safeUrl for src=
```

#### [MED] `Sidebar.tsx:77,335` — Unvalidated `href` from RSS data
```
const safeLink = (link: string) =>
  /^https?:\/\//i.test(link) ? link : '#';

Apply to every href={incident.link} and href={item.link}.
Add rel="noopener noreferrer" to all external anchors.
```

#### [MED] `IncidentsPanel.tsx:~50,~90` — Unvalidated href + ReactMarkdown
```
Same href validation as Sidebar.
Add comment above <ReactMarkdown>:
  {/* DO NOT add rehype-raw — enables arbitrary HTML from model output */}
```

#### [MED] `environment/FireStatusCard.tsx:65` — Unvalidated `href` from fire entity
```
const safeUrl = /^https?:\/\//i.test(fire.link ?? '') ? fire.link : '#';
<a href={safeUrl} rel="noopener noreferrer">
```

### Auth / Auth State

#### [MED] `App.tsx:129` — Network error on auth check silently grants access
```
Change the .catch handler:
  .catch(() => {
    setAuthed(false);
    setAuthChecked(true);
    // Show an error UI rather than granting access
  });
```

### Correctness

#### [MED] `hooks/useTrailHydration.ts:~15` — `fetchedRef` grows unbounded
```
After each fetch cycle, prune stale entries:
  const currentUids = new Set(Object.keys(entities));
  for (const uid of fetchedRef.current) {
    if (!currentUids.has(uid)) fetchedRef.current.delete(uid);
  }
```

#### [MED] `hooks/useTrailHydration.ts:~40` — No abort on unmount
```
  useEffect(() => {
    const controller = new AbortController();
    fetchTrail(entityId, { signal: controller.signal })
      .then(data => { if (!controller.signal.aborted) refreshEntityTrack(data); })
      .catch(err => { if (err.name !== 'AbortError') console.error(err); });
    return () => controller.abort();
  }, [entityId]);
```

#### [MED] `store.ts` — `trafficFlow: any[]`, `utilityStatus: any`, `oregonStatus: any`
```
Define minimal interfaces in storeTypes.ts:
  interface TrafficFlowEntry { /* fields actually used */ }
  interface UtilityStatus { /* fields */ }
  interface OregonStatus { /* fields */ }

Replace any with these types in store.ts.
```

#### [MED] `components/layers/RadarLayer.tsx:95` — Private MapLibre internal
```
Replace:
  (map as any).style?.sourceCaches?.[sourceId]
With:
  map.getSource(sourceId)
Adjust downstream logic to work with the public Source type.
```

#### [MED] `layers/buildCustomLayers.ts:~30` — `hexToRgb` returns NaN for invalid hex
```
Add guard at top of hexToRgb:
  if (!/^#[0-9a-f]{6}$/i.test(hex)) return [100, 100, 100];
```

#### [MED] `snapshotExport.ts:24` — `toDataURL()` throws on cross-origin tiles
```
  try {
    const dataUrl = canvas.toDataURL('image/png');
    // proceed with download
  } catch (err) {
    alert('Cannot export snapshot: map tiles are cross-origin. Try after tiles load from cache.');
  }
```

#### [MED] `admin/AdminMetrics.tsx:25` — Stale `authHeaders()` in callbacks
```
Move the authHeaders() call inside each fetch function:
  const fetchData = useCallback(async () => {
    const h = authHeaders();  // ← called at fetch time, not at render
    const res = await fetch('/api/v1/admin/metrics', { headers: h });
    ...
  }, []);  // no dependency on h
```

### Code Quality

#### [LOW] `store.ts` — Variable shadowing in filter callback
```
Rename inner filter param:
  .filter((strike) => now - strike.ts < WINDOW_MS)
```

#### [LOW] `storeTypes.ts:154` — `SystemEvent.details` typed `any`
```
Change:
  [key: string]: any
To:
  [key: string]: unknown
```

#### [LOW] `hooks/useEntities.ts:~10` — New array on every subscription tick
```
Use Zustand's shallow comparator:
  import { shallow } from 'zustand/shallow';
  const entities = useStore(
    state => Object.values(state.entities).filter(e => e.active),
    shallow
  );
```

#### [LOW] `components/panels/CustomLayersTab.tsx:~60` — No file size limit on upload
```
if (file.size > 10 * 1024 * 1024) {
  setError('File too large (max 10 MB)');
  return;
}
```

#### [LOW] `components/panels/EntitySearchPanel.tsx:145` — Dead conditional `showList`
```
Remove: const showList = true;
Render the list component directly without the surrounding conditional.
```

#### [LOW] `layers/iconAtlas.ts` vs `layers/atlasIcons.ts` — Two parallel implementations
```
Confirm atlasIcons.ts is the canonical implementation.
Delete iconAtlas.ts. Update any imports that reference iconAtlas.
```

#### [NIT] `layers/buildGeofenceLayers.ts:37` — Repeated `as any` casts
```
Type geojson_polygon as GeoJSON.Geometry in the relevant interface/type.
Import from 'geojson' package (already a MapLibre dependency).
```

#### [NIT] `layers/buildTrailLayers.ts:94-98` — Double `as any` for PathStyleExtension
```
Add a comment:
  // as any: PathStyleExtension accessors are not in Deck.gl's TS types
  // Track: https://github.com/visgl/deck.gl/issues/XXXX
```

#### [NIT] `admin/metrics/Primitives.tsx:26` — `Math.random()` for SVG gradient ID
```
Replace:
  const id = `gradient-${Math.random()}`;
With:
  const id = useId();  // React 18 built-in
```

#### [NIT] `IncidentsPanel.tsx` / `Sidebar.tsx` / `InfrastructureGrid.tsx` — Duplicated helpers
```
Create src/utils/incidentFormatters.ts with:
  export function formatIncidentLocation(incident: Incident): string { ... }
  export function deriveIncidentTitle(incident: Incident): string { ... }

Import in the three files; delete the local copies.
```

#### [NIT] `nginx.conf:43` — `/op25/` proxy unrestricted
```
Add inside the /op25/ location block:
  allow 127.0.0.1;
  allow 192.168.0.0/16;  # or your specific admin subnet
  deny all;
```

#### [NIT] `public/sw.js:3` — Service worker missing activate handler
```
Add:
  self.addEventListener('activate', event => {
    event.waitUntil(self.clients.claim());
  });
```

#### [LOW] `config.ts:~5` — Map style URL with no integrity pinning
```
Copy the OpenFreeMap style JSON to public/map-style.json and reference it locally:
  export const MAP_STYLE = '/map-style.json';
This eliminates the CDN dependency and pinned-version drift.
```

---

## WP-8 · Poller Reliability and Correctness

**Domain:** `poller/`  
**Severity:** 3 HIGH · 9 MED · 11 LOW · 5 NIT

### High Priority

#### [HIGH] `pollers/cot_receiver.py:49-51` — Zero-coordinate fallback places entities at 0°N 0°E
```
After parsing lat/lon, add:
  if lat == 0.0 and lon == 0.0:
      logger.debug("[cot] dropping event with null-island coordinates: %s", uid)
      return None

Or validate full range: -90 <= lat <= 90, -180 <= lon <= 180.
```

#### [HIGH] `pollers/ais.py:69` — AISstream API key in logged subscription message
```
Do not log the subscription dict. On connection error, catch and log only the
exception string. Verify with:
  assert settings.aisstream_api_key not in str(exc)
before the log call (or simply remove the subscription dict from the log).
```

#### [HIGH] `pollers/weather.py:62` — AirNow URL logged at INFO
```
Remove the logger.info("[weather] AirNow request: %s …", url, …) line.
```

### Schema / DB Correctness

#### [MED] `pollers/anomaly.py:67` — Wrong column names, anomaly events never persisted
```
Replace the manual INSERT with:
  await db.write_event(
      event_type="anomaly",
      entity_id=entity_id,
      severity=severity,
      summary=description,
      details={"anomaly_type": anomaly_type},
  )
Verify write_event() matches the canonical events schema.
```

#### [MED] `pollers/alerts.py:99-109` — References non-existent `Settings` attributes
```
Add to poller/config.py with safe defaults:
  flashalert_enabled: bool = False
  flashalert_url: str = ""
  tvfr_enabled: bool = False
  tvfr_rss_url: str = ""

Or remove the fallback block entirely if alert_feed_configs always covers these.
```

### Memory / Resource Bounds

#### [MED] `geofence.py:13` — `_entity_state` dict grows indefinitely
```
In the existing exited_ids cleanup pass, also evict stale entries:
  cutoff = time.time() - 6 * 3600  # 6-hour TTL
  stale = [eid for eid, state in _entity_state.items()
           if state.get('entered_at', 0) < cutoff]
  for eid in stale:
      del _entity_state[eid]
```

#### [MED] `pollers/adsb.py:89` — `r.keys("entity:*")` O(N) blocking
```
Replace with cursor-based SCAN (same pattern as WP-6 redis_bus.py fix):
  keys = []
  cur = 0
  while True:
      cur, batch = await r.scan(cur, match='entity:*', count=200)
      keys.extend(batch)
      if cur == 0:
          break
```

#### [MED] `pollers/cot_receiver.py:192-204` — TCP buffer grows without bound
```
Add size guard inside the reader loop:
  if len(buf) > 1_000_000:
      logger.warning("[cot] receive buffer overflow, resetting connection")
      break  # triggers reconnect
```

#### [LOW] `pollers/seismic.py:19` — `_seen_ids` set grows without bound
```
Convert to a dict mapping event_id → timestamp:
  _seen_ids: dict[str, float] = {}

On each check, evict entries older than 2 hours:
  cutoff = time.time() - 7200
  _seen_ids = {k: v for k, v in _seen_ids.items() if v > cutoff}

On add: _seen_ids[event_id] = time.time()
```

### Timeout / Reconnect

#### [MED] `pollers/aprs.py:116-168` — No timeout on `reader.readline()`
```
Wrap:
  try:
      line = await asyncio.wait_for(reader.readline(), timeout=120)
  except asyncio.TimeoutError:
      logger.warning("[aprs] read timeout, reconnecting")
      break  # triggers reconnect loop
```

#### [LOW] `pollers/cot_receiver.py` — Infinite reconnect loop with no escalation
```
Add consecutive failure counter:
  consecutive_failures = 0
  MAX_BEFORE_ERROR = 5
  ...
  except Exception:
      consecutive_failures += 1
      level = logging.ERROR if consecutive_failures >= MAX_BEFORE_ERROR else logging.WARNING
      logger.log(level, "[cot] connection failed (%d times): %s", consecutive_failures, exc)
  else:
      consecutive_failures = 0
```

### Data Correctness

#### [MED] `enrichment/cache.py:116-123` — Race condition in `_fetch_and_cache`
```
Replace task-presence check with asyncio.Event per key:
  self._inflight: dict[str, asyncio.Event] = {}
  self._results: dict[str, Any] = {}

  async def _fetch_and_cache(self, key):
      if key in self._inflight:
          await self._inflight[key].wait()
          return self._results.get(key)
      event = asyncio.Event()
      self._inflight[key] = event
      try:
          result = await self._do_fetch(key)
          self._results[key] = result
          return result
      finally:
          event.set()
          self._inflight.pop(key, None)
```

#### [MED] `pollers/lightning.py:128` — Unvalidated `int()` on untrusted timestamp
```
Replace:
  ts = int(ns_time)
With:
  if not isinstance(ns_time, (int, float)) or not (0 < ns_time < 2e18):
      logger.debug("[lightning] invalid timestamp %r, skipping strike", ns_time)
      continue
  ts = int(ns_time)
```

#### [MED] `pollers/tinygs.py:78` — `float()` on untrusted `lastPacketTime` outside try/except
```
Wrap per-station:
  try:
      last_ts = float(station.get('lastPacketTime', 0))
  except (TypeError, ValueError):
      last_ts = 0.0
```

#### [LOW] `pollers/fire.py:84` — Wrong centroid when coordinates filtered out
```
Change:
  centroid_lat = sum(p[0] for p in ring if isinstance(p[0], float)) / len(ring)
To:
  valid = [p for p in ring if isinstance(p[0], float) and isinstance(p[1], float)]
  if not valid:
      continue
  centroid_lat = sum(p[0] for p in valid) / len(valid)
  centroid_lon = sum(p[1] for p in valid) / len(valid)
```

#### [LOW] `normalizers/beast_decoder.py:~420` — TAT formula physically wrong
```
Replace:
  tat = sat + (0.2 * float(ac.mach) ** 2) * (sat + 273.15) - 273.15
With correct ISA formula:
  sat_k = sat + 273.15
  tat_k = sat_k * (1 + 0.2 * float(ac.mach) ** 2)
  tat = tat_k - 273.15
```

#### [LOW] `pollers/p25.py:77-93` — Call-end event records incoming talkgroup tag
```
Add: self._last_tag = None
On talkgroup start: self._last_tag = tag
On call-end record: use tag=self._last_tag (not the new tag)
```

### Class / Instance Variable Fixes

#### [LOW] `pollers/traffic.py:21` — `_station_map` is class variable
```
Move from class body to __init__ or setup():
  self._station_map: dict[str, Any] = {}
```

#### [LOW] `pollers/utilities.py:19` — `_consecutive_failures` initialised in `setup()` not `__init__`
```
Add to __init__:
  self._consecutive_failures = 0
```

#### [LOW] `pollers/weather.py:107-111` — `locals()` used to detect success
```
Replace with explicit flag:
  _success = False
  try:
      data = ...
      _success = True
  finally:
      if not _success:
          logger.warning("[weather] fetch failed")
```

#### [LOW] `pollers/base.py:47` — `hasattr(self, 'close')` always True
```
Remove the hasattr guard:
  await self.close()
```

### Minor Fixes

#### [LOW] `pollers/weather.py:54` — AirNow API URL uses HTTP
```
Change:
  http://www.airnowapi.org/
To:
  https://www.airnowapi.org/
```

#### [LOW] `enrichment/adsbdb.py:93-95` — Shared `_dirty_count` across two caches
```
Add separate counters:
  self._route_dirty_count = 0
  self._aircraft_dirty_count = 0

Increment and flush each independently.
```

#### [NIT] `db.py:24-30` — DDL migrations in startup
```
Add a comment near the ALTER TABLE statements:
  # TODO: migrate to Alembic for schema evolution tracking
Accept current behaviour for now; document in CONTRIBUTING.md.
```

#### [NIT] `pollers/news.py:67-74` — Generator in `list()`
```
Change:
  list({...} for s in _STATIC_SOURCES)
To:
  [{...} for s in _STATIC_SOURCES]
```

#### [NIT] `pollers/traffic.py:193` — `RADIUS_DEG` dead variable
```
Remove: RADIUS_DEG = ...
```

#### [NIT] Haversine duplicated 5× across codebase
```
Files to fix: seismic.py, fire.py, adsb.py, enrichment/navaids_db.py
Action: Delete the local _haversine_km() / haversine_km() function from each.
Import instead: from normalizers.beast_math import haversine_km
Also fix traffic.py:176-179 to import haversine_km instead of flat-Earth approximation.
```

---

## WP-9 · Config and Environment Fixes

**Domain:** Cross-cutting (`.env.example`, `docker-compose.yml`, `docker-compose.dev.yml`)  
**Severity:** 3 LOW · 1 NIT

#### [LOW] `.env.example` — `REGION_ALT` is a dead variable
```
Remove REGION_ALT=100ft from .env.example (no config.py reads it).
Or: add region_alt: str = Field(default="100ft") to backend/config.py and
poller/config.py if the value is useful to operators.
```

#### [LOW] `docker-compose.yml` — `VITE_RADAR_FALLBACK_*` not plumbed as build args
```
Add to docker-compose.yml frontend.build.args:
  VITE_RADAR_FALLBACK_MAX_ZOOM: ${VITE_RADAR_FALLBACK_MAX_ZOOM:-6}
  VITE_RADAR_FALLBACK_LAYER: ${VITE_RADAR_FALLBACK_LAYER:-radar}

Add to .env.example:
  VITE_RADAR_FALLBACK_MAX_ZOOM=6
  VITE_RADAR_FALLBACK_LAYER=radar
```

#### [LOW] `docker-compose.dev.yml` — Missing `VITE_RADIO_STREAM_URL`
```
Add to frontend.environment in docker-compose.dev.yml:
  VITE_RADIO_STREAM_URL: ${VITE_RADIO_STREAM_URL:-/stream/radio.mp3}
```

#### [NIT] `poller/config.py` — `adsb_enrichment_cache_dir` not in `.env.example`
```
Add commented-out entry to .env.example near other ADSB_* variables:
  # ADSB_ENRICHMENT_CACHE_DIR=/data
```

---

## Commit Strategy

Each WP should land as one or more atomic commits on the feature branch. Suggested groupings:

| Commit | Contents |
|--------|----------|
| `fix(auth): overhaul JWT validation and role defaults` | WP-1 |
| `fix(security): escape XSS and injection vectors` | WP-2 |
| `fix(security): validate webhook and camera URLs (SSRF)` | WP-3 |
| `fix(db-poller): parameterise retention_days SQL` | WP-4 |
| `fix(db): schema integrity, FK constraints, defaults` | WP-5 |
| `fix(backend): reliability, CORS, rate-limiting, pub/sub` | WP-6 |
| `fix(frontend): listener cleanup, reconnect backoff, href validation` | WP-7 |
| `fix(poller): bounds, timeouts, coordinate validation, formula` | WP-8 |
| `fix(config): env example, Docker build args` | WP-9 |

Run `pre-commit-check` (TypeScript typecheck + Docker compose validate + Python compile) before each commit.

---

## Severity Count by WP

| WP | CRIT | HIGH | MED | LOW | NIT | Total |
|----|------|------|-----|-----|-----|-------|
| WP-1 Auth | 2 | 2 | 5 | 2 | 0 | 11 |
| WP-2 XSS/Inject | 1 | 2 | 0 | 0 | 0 | 3 |
| WP-3 SSRF | 0 | 2 | 3 | 0 | 0 | 5 |
| WP-4 SQL Inject | 1 | 0 | 0 | 0 | 0 | 1 |
| WP-5 DB Schema | 0 | 3 | 6 | 4 | 5 | 18 |
| WP-6 Backend Rel | 1 | 4 | 11 | 1 | 2 | 19 |
| WP-7 Frontend Rel | 0 | 5 | 12 | 5 | 6 | 28 |
| WP-8 Poller Rel | 0 | 3 | 9 | 11 | 5 | 28 |
| WP-9 Config | 0 | 0 | 0 | 3 | 1 | 4 |
| **Total** | **5** | **21** | **46** | **26** | **19** | **117** |

> Note: Some findings span two domains (e.g. auth touches both backend and frontend) so total count exceeds the 98 raw findings.
