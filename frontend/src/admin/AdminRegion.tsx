import { useCallback, useEffect, useState } from 'react'
import { API_BASE } from '../config'
import { authHeaders } from '../auth'
import type { Capabilities } from '../hooks/useCapabilities'
import type { RegionConfig } from '../region'
import { fetchPacks, fetchSetupStatus, type PackInfo, type SetupStatus } from '../setup'
import { SetupWizard } from '../components/SetupWizard'
import { AdminSection } from './ui'

const SOURCE_TEXT: Record<RegionConfig['source'], string> = {
  env: 'Set in .env (REGION_LAT / REGION_LON)',
  database: 'Chosen in the setup wizard',
  default: 'Built-in default — setup has not been run',
}

const REASON_TEXT: Record<string, string> = {
  outside_coverage: 'outside the area this source covers',
  not_configured: 'needs an API key',
  no_pack: 'core feeds only — no region pack chosen',
  not_in_pack: 'not provided by the chosen pack',
}

const STATUS_STYLE: Record<string, { dot: string; text: string; label: string }> = {
  ok: { dot: 'bg-green-ais', text: 'text-green-ais', label: 'active' },
  pending: { dot: 'bg-amber-gold', text: 'text-amber-gold', label: 'waiting for data' },
  stale: { dot: 'bg-amber-gold', text: 'text-amber-gold', label: 'late' },
  down: { dot: 'bg-red-emergency', text: 'text-red-emergency', label: 'not updating' },
  none: { dot: 'bg-on-surface-variant', text: 'text-on-surface-variant', label: 'off' },
}

async function getJson<T>(path: string): Promise<T | null> {
  try {
    const res = await fetch(`${API_BASE}${path}`, { headers: authHeaders() })
    return res.ok ? ((await res.json()) as T) : null
  } catch {
    return null
  }
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <div className="text-[11px] uppercase tracking-widest text-on-surface-variant mb-1">{label}</div>
      <div className="font-mono text-[13px] text-on-surface break-words">{children}</div>
    </div>
  )
}

/**
 * Where this install is and what that turns on: the region, the region packs available, their API keys, and
 * which data sources are active as a result. The setup wizard lives behind the button; it also opens by itself
 * on first sign-in when nothing has chosen a region yet.
 */
export default function AdminRegion() {
  const [region, setRegion] = useState<RegionConfig | null>(null)
  const [status, setStatus] = useState<SetupStatus | null>(null)
  const [packs, setPacks] = useState<PackInfo[]>([])
  const [caps, setCaps] = useState<Capabilities | null>(null)
  const [wizard, setWizard] = useState(false)

  const load = useCallback(async () => {
    const r = await getJson<RegionConfig>('/config/region')
    setRegion(r)
    setStatus(await fetchSetupStatus().catch(() => null))
    setCaps(await getJson<Capabilities>('/capabilities'))
    if (r) setPacks(await fetchPacks(r.center[0], r.center[1], null).catch(() => []))
  }, [])

  useEffect(() => { void load() }, [load])

  if (!region) return <p className="text-xs text-on-surface-variant">Loading…</p>

  const activePack = region.pack && region.pack !== 'none' ? packs.find((p) => p.id === region.pack) : null
  const packLabel = region.pack === 'none' ? 'Core feeds only' : activePack ? activePack.name : region.pack ?? 'None chosen (all built-in sources active)'
  const b = region.bbox
  const contracts = caps ? Object.entries(caps.contracts) : []

  return (
    <div className="max-w-5xl space-y-8">
      {status?.restart_required && (
        <div className="flex gap-2 p-3 border border-amber-gold/40 bg-amber-gold/10 text-xs text-amber-gold" role="status">
          <span className="ms text-[16px] shrink-0" aria-hidden="true">restart_alt</span>
          <span>The region changed after the poller started. Restart it to collect data for the new region:{' '}
            <code className="font-mono">docker compose restart poller</code></span>
        </div>
      )}
      {status?.poller.state === 'waiting' && (
        <div className="flex gap-2 p-3 border border-amber-gold/40 bg-amber-gold/10 text-xs text-amber-gold" role="status">
          <span className="ms text-[16px] shrink-0" aria-hidden="true">hourglass_top</span>
          <span>The poller is waiting for a region to be chosen. It starts collecting as soon as you finish the wizard.</span>
        </div>
      )}

      <AdminSection title="Region" action={
        <button type="button" className="btn-primary" onClick={() => setWizard(true)}>
          {region.configured ? 'Change region…' : 'Run setup…'}
        </button>
      }>
        <div className="border border-white/10 bg-black/30 p-4 space-y-4">
          <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
            <span className="text-lg font-bold text-on-surface">{region.name}</span>
            <span className="text-[12px] text-on-surface-variant">{SOURCE_TEXT[region.source]}</span>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <Fact label="Center">{region.center[0].toFixed(4)}, {region.center[1].toFixed(4)}</Fact>
            <Fact label="Area">{b.min_lat.toFixed(2)}–{b.max_lat.toFixed(2)} N<br />{Math.abs(b.max_lon).toFixed(2)}–{Math.abs(b.min_lon).toFixed(2)} W</Fact>
            <Fact label="Timezone">{region.timezone}</Fact>
            <Fact label="Region pack">{packLabel}</Fact>
            {region.nws && (
              <>
                <Fact label="Weather office">{region.nws.office ?? '—'}</Fact>
                <Fact label="Forecast zone">{region.nws.forecast_zone ?? '—'}</Fact>
                <Fact label="County zone">{region.nws.county_zone ?? '—'}</Fact>
                <Fact label="Fire zone">{region.nws.fire_zone ?? '—'}</Fact>
              </>
            )}
          </div>
          {region.locked && (
            <p className="text-[12px] text-on-surface-variant border-t border-white/10 pt-3">
              This region is pinned by <span className="font-mono">{region.locked_by.join(', ')}</span> in <span className="font-mono">.env</span>.
              The wizard can walk you through the options, but saving is refused until you remove those variables and restart.
            </p>
          )}
        </div>
      </AdminSection>

      <AdminSection title="Region packs">
        {packs.length === 0 ? (
          <p className="text-xs text-on-surface-variant">No region packs are installed.</p>
        ) : (
          <div className="space-y-2">
            {packs.map((p) => {
              const missing = (p.keys ?? []).filter((k) => !k.present)
              return (
                <div key={p.id} className={`border p-3 space-y-2 ${p.id === region.pack ? 'border-amber-gold/50 bg-amber-gold/5' : 'border-white/10 bg-black/30'}`}>
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                    <span className="font-bold text-on-surface">{p.name}</span>
                    {p.id === region.pack && <span className="text-[10px] uppercase tracking-widest text-amber-gold">in use</span>}
                    {p.suggested && <span className="text-[10px] uppercase tracking-widest text-green-ais">covers this region</span>}
                    {!p.valid && <span className="text-[10px] uppercase tracking-widest text-red-emergency">not usable</span>}
                  </div>
                  {p.valid ? (
                    <>
                      {p.description && <div className="text-[12px] text-on-surface-variant">{p.description}</div>}
                      {!!p.provides?.length && <div className="text-[12px] text-on-surface-variant">Provides: {p.provides.map((c) => c.title).join(', ')}</div>}
                      {!!p.keys?.length && (
                        <div className="flex flex-wrap gap-2 pt-1">
                          {p.keys.map((k) => (
                            <span key={k.name} className={`inline-flex items-center gap-1.5 border px-2 py-0.5 text-[11px] font-mono ${k.present ? 'border-green-ais/40 text-green-ais' : 'border-amber-gold/40 text-amber-gold'}`}>
                              {k.name} {k.present ? 'found' : 'missing'}
                              {!k.present && k.where && <a className="underline" href={k.where} target="_blank" rel="noreferrer">get a key</a>}
                            </span>
                          ))}
                        </div>
                      )}
                      {p.id === region.pack && missing.length > 0 && (
                        <div className="text-[11px] text-amber-gold">
                          Add {missing.map((k) => k.name).join(', ')} to <span className="font-mono">.env</span> and restart the backend and poller.
                        </div>
                      )}
                    </>
                  ) : <div className="text-[12px] text-red-emergency">{p.error}</div>}
                </div>
              )
            })}
          </div>
        )}
        <p className="mt-3 text-[11px] text-on-surface-variant">
          Packs live under <span className="font-mono">regions/</span>. To add one for your area, copy <span className="font-mono">regions/_template</span> and
          see <a className="text-amber-gold underline" href="https://github.com/d3mocide/Vertex/blob/main/docs/architecture/region-packs.md" target="_blank" rel="noreferrer">the region packs guide</a>.
        </p>
      </AdminSection>

      <AdminSection title="What is active here">
        <div className="border border-white/10 bg-black/30 divide-y divide-white/5">
          {contracts.map(([id, c]) => {
            const st = STATUS_STYLE[c.status] ?? STATUS_STYLE.none
            return (
              <div key={id} className="flex flex-wrap items-center gap-x-4 gap-y-0.5 px-3 py-2 text-[12px]">
                <span className="w-56 text-on-surface">{c.title}</span>
                <span className={`inline-flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-wider ${st.text}`}>
                  <span className={`w-1.5 h-1.5 rounded-full ${st.dot}`} aria-hidden="true" />{st.label}
                </span>
                <span className="text-on-surface-variant text-[11px] font-mono">
                  {c.status === 'none'
                    ? `${c.reason ? REASON_TEXT[c.reason] ?? c.reason : ''}${c.requires ? ` (${c.requires})` : ''}`
                    : c.providers.join(', ')}
                </span>
              </div>
            )
          })}
          {contracts.length === 0 && <div className="px-3 py-2 text-xs text-on-surface-variant">No regional sources are defined.</div>}
        </div>
        <p className="mt-2 text-[11px] text-on-surface-variant">
          National sources (weather, alerts, aircraft, vessels, earthquakes, wildfire) work in any region and are not listed here.
          Extra monitoring areas can be defined under Feeds → Regions.
        </p>
      </AdminSection>

      {wizard && <SetupWizard firstRun={false} onClose={() => { setWizard(false); void load() }} />}
    </div>
  )
}
