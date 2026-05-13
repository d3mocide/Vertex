import React, { useEffect, useState, useCallback } from 'react'
import { API_BASE } from '../config'
import { authHeaders } from '../auth'
import { useRegions } from '../hooks/useRegions'

type Tab = 'radio' | 'news' | 'pollers' | 'zones' | 'regions'

// ── Types ────────────────────────────────────────────────────────────────────

type RadioStream = { id: number; name: string; url: string; format: string; enabled: boolean; source: string }
type NewsFeed    = { id: number; name: string; url: string | null; format: string; enabled: boolean; source: string }
type PollerSrc   = { id: number; type: string; name: string; url: string; enabled: boolean; source: string }
type AlertZone   = { id: number; zone_code: string; enabled: boolean; source: string }

// ── Shared sub-components ────────────────────────────────────────────────────

function ToggleDot({ enabled }: { enabled: boolean }) {
  return (
    <span className={`inline-block w-1.5 h-1.5 rounded-full mr-2 ${enabled ? 'bg-green-400' : 'bg-gray-600'}`} />
  )
}

function DeleteBtn({ onClick }: { onClick: () => void }) {
  return (
    <button onClick={onClick} className="text-[11px] text-red-500/60 hover:text-red-400 transition-colors uppercase tracking-wider">
      Del
    </button>
  )
}

function ToggleBtn({ enabled, onClick }: { enabled: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`text-[11px] uppercase tracking-wider transition-colors ${
        enabled ? 'text-green-400/70 hover:text-red-400' : 'text-gray-600 hover:text-green-400'
      }`}
    >
      {enabled ? 'On' : 'Off'}
    </button>
  )
}

// ── Radio streams ─────────────────────────────────────────────────────────────

function RadioTab() {
  const [items, setItems] = useState<RadioStream[]>([])
  const [name, setName] = useState('')
  const [url, setUrl] = useState('')
  const [format, setFormat] = useState('mp3')
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    const res = await fetch(`${API_BASE}/radio/streams`, { headers: authHeaders() })
    if (res.ok) setItems(await res.json())
  }, [])

  useEffect(() => { load() }, [load])

  const toggle = async (id: number) => {
    await fetch(`${API_BASE}/radio/streams/${id}/toggle`, { method: 'PATCH', headers: authHeaders() })
    await load()
  }

  const del = async (id: number) => {
    if (!confirm('Delete this radio stream?')) return
    await fetch(`${API_BASE}/radio/streams/${id}`, { method: 'DELETE', headers: authHeaders() })
    await load()
  }

  const create = async (e: React.FormEvent) => {
    e.preventDefault()
    setSaving(true)
    try {
      await fetch(`${API_BASE}/radio/streams`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ name, url, format, enabled: true }),
      })
      setName(''); setUrl('')
      await load()
    } finally { setSaving(false) }
  }

  return (
    <div className="space-y-4">
      <div className="border border-white/10">
        {items.map((s) => (
          <div key={s.id} className="flex items-center gap-3 px-3 py-2 border-b border-white/5 last:border-0 hover:bg-white/5">
            <ToggleDot enabled={s.enabled} />
            <div className="flex-1 min-w-0">
              <div className="text-xs text-gray-200 truncate">{s.name}</div>
              <div className="text-[11px] text-gray-500 truncate">{s.url}</div>
            </div>
            <span className="text-[11px] text-gray-600 uppercase">{s.format}</span>
            <ToggleBtn enabled={s.enabled} onClick={() => toggle(s.id)} />
            {s.source === 'user' && <DeleteBtn onClick={() => del(s.id)} />}
          </div>
        ))}
        {items.length === 0 && <p className="px-3 py-4 text-xs text-gray-600">No streams configured.</p>}
      </div>
      <form onSubmit={create} className="grid grid-cols-3 gap-2">
        <input value={name} onChange={(e) => setName(e.target.value)} required placeholder="Name" className="col-span-1 bg-black/60 border border-white/10 text-gray-200 text-xs px-2 py-1.5 focus:outline-none focus:border-amber-gold/60" />
        <input value={url} onChange={(e) => setUrl(e.target.value)} required placeholder="Stream URL" className="col-span-1 bg-black/60 border border-white/10 text-gray-200 text-xs px-2 py-1.5 focus:outline-none focus:border-amber-gold/60" />
        <select value={format} onChange={(e) => setFormat(e.target.value)} className="tactical-select">
          <option value="mp3">mp3</option>
          <option value="aac">aac</option>
          <option value="ogg">ogg</option>
        </select>
        <button type="submit" disabled={saving} className="col-span-3 py-1.5 text-[11px] font-bold uppercase tracking-widest border border-amber-gold/40 text-amber-gold hover:bg-amber-gold/10 transition-colors disabled:opacity-50">
          {saving ? 'Adding…' : 'Add Stream'}
        </button>
      </form>
    </div>
  )
}

// ── News feeds ────────────────────────────────────────────────────────────────

function NewsTab() {
  const [items, setItems] = useState<NewsFeed[]>([])
  const [name, setName] = useState('')
  const [url, setUrl] = useState('')
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    const res = await fetch(`${API_BASE}/sources/feeds`, { headers: authHeaders() })
    if (res.ok) setItems(await res.json())
  }, [])

  useEffect(() => { load() }, [load])

  const toggle = async (id: number) => {
    await fetch(`${API_BASE}/sources/feeds/${id}/toggle`, { method: 'PATCH', headers: authHeaders() })
    await load()
  }

  const del = async (id: number) => {
    if (!confirm('Delete this news feed?')) return
    await fetch(`${API_BASE}/sources/feeds/${id}`, { method: 'DELETE', headers: authHeaders() })
    await load()
  }

  const create = async (e: React.FormEvent) => {
    e.preventDefault()
    setSaving(true)
    try {
      await fetch(`${API_BASE}/sources/feeds`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ name, url, format: 'rss', enabled: true }),
      })
      setName(''); setUrl('')
      await load()
    } finally { setSaving(false) }
  }

  return (
    <div className="space-y-4">
      <div className="border border-white/10">
        {items.map((f) => (
          <div key={f.id} className="flex items-center gap-3 px-3 py-2 border-b border-white/5 last:border-0 hover:bg-white/5">
            <ToggleDot enabled={f.enabled} />
            <div className="flex-1 min-w-0">
              <div className="text-xs text-gray-200 truncate">{f.name}</div>
              {f.url && <div className="text-[11px] text-gray-500 truncate">{f.url}</div>}
            </div>
            <ToggleBtn enabled={f.enabled} onClick={() => toggle(f.id)} />
            {f.source === 'user' && <DeleteBtn onClick={() => del(f.id)} />}
          </div>
        ))}
        {items.length === 0 && <p className="px-3 py-4 text-xs text-gray-600">No feeds configured.</p>}
      </div>
      <form onSubmit={create} className="grid grid-cols-2 gap-2">
        <input value={name} onChange={(e) => setName(e.target.value)} required placeholder="Feed name" className="bg-black/60 border border-white/10 text-gray-200 text-xs px-2 py-1.5 focus:outline-none focus:border-amber-gold/60" />
        <input value={url} onChange={(e) => setUrl(e.target.value)} required placeholder="RSS URL" className="bg-black/60 border border-white/10 text-gray-200 text-xs px-2 py-1.5 focus:outline-none focus:border-amber-gold/60" />
        <button type="submit" disabled={saving} className="col-span-2 py-1.5 text-[11px] font-bold uppercase tracking-widest border border-amber-gold/40 text-amber-gold hover:bg-amber-gold/10 transition-colors disabled:opacity-50">
          {saving ? 'Adding…' : 'Add Feed'}
        </button>
      </form>
    </div>
  )
}

// ── Poller sources ────────────────────────────────────────────────────────────

const POLLER_TYPES = ['adsb', 'ais', 'p25', 'meshcore', 'fire', 'aprs'] as const
type PollerType = typeof POLLER_TYPES[number]

function PollersTab() {
  const [items, setItems] = useState<PollerSrc[]>([])
  const [name, setName] = useState('')
  const [url, setUrl] = useState('')
  const [type, setType] = useState<PollerType>('adsb')
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    const res = await fetch(`${API_BASE}/sources/pollers`, { headers: authHeaders() })
    if (res.ok) setItems(await res.json())
  }, [])

  useEffect(() => { load() }, [load])

  const toggle = async (id: number) => {
    await fetch(`${API_BASE}/sources/pollers/${id}/toggle`, { method: 'PATCH', headers: authHeaders() })
    await load()
  }

  const del = async (id: number) => {
    if (!confirm('Delete this poller source?')) return
    await fetch(`${API_BASE}/sources/pollers/${id}`, { method: 'DELETE', headers: authHeaders() })
    await load()
  }

  const create = async (e: React.FormEvent) => {
    e.preventDefault()
    setSaving(true)
    try {
      await fetch(`${API_BASE}/sources/pollers`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ type, name, url, enabled: true }),
      })
      setName(''); setUrl('')
      await load()
    } finally { setSaving(false) }
  }

  return (
    <div className="space-y-4">
      <div className="border border-white/10">
        {items.map((p) => (
          <div key={p.id} className="flex items-center gap-3 px-3 py-2 border-b border-white/5 last:border-0 hover:bg-white/5">
            <ToggleDot enabled={p.enabled} />
            <span className="text-[11px] text-amber-400/70 uppercase w-12 shrink-0">{p.type}</span>
            <div className="flex-1 min-w-0">
              <div className="text-xs text-gray-200 truncate">{p.name}</div>
              <div className="text-[11px] text-gray-500 truncate">{p.url}</div>
            </div>
            <ToggleBtn enabled={p.enabled} onClick={() => toggle(p.id)} />
            {p.source === 'user' && <DeleteBtn onClick={() => del(p.id)} />}
          </div>
        ))}
        {items.length === 0 && <p className="px-3 py-4 text-xs text-gray-600">No poller sources configured.</p>}
      </div>
      <form onSubmit={create} className="grid grid-cols-3 gap-2">
        <select value={type} onChange={(e) => setType(e.target.value as PollerType)} className="tactical-select">
          {POLLER_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
        <input value={name} onChange={(e) => setName(e.target.value)} required placeholder="Name" className="bg-black/60 border border-white/10 text-gray-200 text-xs px-2 py-1.5 focus:outline-none focus:border-amber-gold/60" />
        <input value={url} onChange={(e) => setUrl(e.target.value)} required placeholder="URL / host" className="bg-black/60 border border-white/10 text-gray-200 text-xs px-2 py-1.5 focus:outline-none focus:border-amber-gold/60" />
        <button type="submit" disabled={saving} className="col-span-3 py-1.5 text-[11px] font-bold uppercase tracking-widest border border-amber-gold/40 text-amber-gold hover:bg-amber-gold/10 transition-colors disabled:opacity-50">
          {saving ? 'Adding…' : 'Add Source'}
        </button>
      </form>
    </div>
  )
}

// ── Alert zones ───────────────────────────────────────────────────────────────

function ZonesTab() {
  const [items, setItems] = useState<AlertZone[]>([])
  const [code, setCode] = useState('')
  const [saving, setSaving] = useState(false)
  const [addError, setAddError] = useState('')

  const load = useCallback(async () => {
    const res = await fetch(`${API_BASE}/sources/alert-zones`, { headers: authHeaders() })
    if (res.ok) setItems(await res.json())
  }, [])

  useEffect(() => { load() }, [load])

  const del = async (id: number) => {
    if (!confirm('Remove this alert zone?')) return
    await fetch(`${API_BASE}/sources/alert-zones/${id}`, { method: 'DELETE', headers: authHeaders() })
    await load()
  }

  const create = async (e: React.FormEvent) => {
    e.preventDefault()
    setSaving(true)
    setAddError('')
    try {
      const res = await fetch(`${API_BASE}/sources/alert-zones`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ zone_code: code.toUpperCase(), enabled: true }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.detail ?? `HTTP ${res.status}`)
      }
      setCode('')
      await load()
    } catch (e) {
      setAddError(String(e))
    } finally { setSaving(false) }
  }

  return (
    <div className="space-y-4">
      <div className="border border-white/10">
        {items.map((z) => (
          <div key={z.id} className="flex items-center gap-3 px-3 py-2 border-b border-white/5 last:border-0 hover:bg-white/5">
            <ToggleDot enabled={z.enabled} />
            <span className="flex-1 font-mono text-xs text-gray-200">{z.zone_code}</span>
            <span className="text-[11px] text-gray-600">{z.source}</span>
            {z.source === 'user' && <DeleteBtn onClick={() => del(z.id)} />}
          </div>
        ))}
        {items.length === 0 && <p className="px-3 py-4 text-xs text-gray-600">No alert zones configured.</p>}
      </div>
      <form onSubmit={create} className="flex gap-2">
        <input
          value={code}
          onChange={(e) => setCode(e.target.value)}
          required
          placeholder="NWS zone code, e.g. ORZ006"
          className="flex-1 bg-black/60 border border-white/10 text-gray-200 text-xs px-2 py-1.5 focus:outline-none focus:border-amber-gold/60 font-mono uppercase"
        />
        <button type="submit" disabled={saving} className="px-4 py-1.5 text-[11px] font-bold uppercase tracking-widest border border-amber-gold/40 text-amber-gold hover:bg-amber-gold/10 transition-colors disabled:opacity-50">
          {saving ? '…' : 'Add'}
        </button>
      </form>
      {addError && <p className="text-xs text-red-400">{addError}</p>}
    </div>
  )
}

// ── Monitoring Regions ────────────────────────────────────────────────────────

function RegionsTab() {
  const regions = useRegions()

  return (
    <div className="space-y-3">
      <p className="text-[11px] text-gray-500 uppercase tracking-widest">
        Regions are defined in <span className="text-gray-400 font-mono">sources.yml</span>. Edit that file to add or modify regions.
      </p>
      <div className="border border-white/10">
        {regions.map((r) => (
          <div key={r.id} className="px-3 py-3 border-b border-white/5 last:border-0 hover:bg-white/5">
            <div className="flex items-center gap-3 mb-1">
              <span className={`inline-block w-1.5 h-1.5 rounded-full ${r.enabled ? 'bg-green-400' : 'bg-gray-600'}`} />
              <span className="text-xs font-semibold text-gray-200">{r.name}</span>
              <span className="font-mono text-[11px] text-gray-500">{r.id}</span>
              {!r.enabled && (
                <span className="text-[11px] uppercase tracking-wider text-gray-600">disabled</span>
              )}
            </div>
            <div className="ml-4 font-mono text-[11px] text-gray-500 space-y-0.5">
              <div>
                Lat {r.bbox.min_lat} → {r.bbox.max_lat} &nbsp;|&nbsp; Lon {r.bbox.min_lon} → {r.bbox.max_lon}
              </div>
            </div>
          </div>
        ))}
        {regions.length === 0 && (
          <p className="px-3 py-4 text-xs text-gray-600">No regions configured.</p>
        )}
      </div>
    </div>
  )
}

// ── Main ──────────────────────────────────────────────────────────────────────

const TABS: { id: Tab; label: string; icon: string }[] = [
  { id: 'radio', label: 'Radio Streams', icon: 'radio' },
  { id: 'news', label: 'News Feeds', icon: 'rss_feed' },
  { id: 'pollers', label: 'Pollers', icon: 'settings_input_component' },
  { id: 'zones', label: 'Alert Zones', icon: 'notification_important' },
  { id: 'regions', label: 'Regions', icon: 'map' },
]

export default function AdminFeeds() {
  const [tab, setTab] = useState<Tab>('radio')

  return (
    <div className="space-y-6">
      {/* Tab Navigation */}
      <div className="border-b border-white/10 -mx-6 px-6">
        <div className="flex gap-1 overflow-x-auto">
          {TABS.map(({ id, label, icon }) => (
            <button
              key={id}
              onClick={() => setTab(id)}
              className={`flex items-center gap-2 px-4 py-3 border-b-2 transition-colors text-[11px] font-bold uppercase tracking-widest whitespace-nowrap ${
                tab === id
                  ? 'border-amber-gold text-amber-gold'
                  : 'border-transparent text-on-surface-variant hover:text-on-surface'
              }`}
            >
              <span className="ms text-[16px]">{icon}</span>
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Tab Content */}
      <div className="max-w-5xl space-y-8">
        {tab === 'radio'   && <RadioTab />}
        {tab === 'news'    && <NewsTab />}
        {tab === 'pollers' && <PollersTab />}
        {tab === 'zones'   && <ZonesTab />}
        {tab === 'regions' && <RegionsTab />}
      </div>
    </div>
  )
}
