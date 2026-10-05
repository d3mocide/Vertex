/** The operator's own saved layer views, kept in this browser (like the other per-device layer choices). */
import type { SubFilters } from '../storeTypes'

export interface SavedView { id: string; label: string; on: string[]; sub: SubFilters }

const KEY = 'vertex.layerViews'
const MAX_VIEWS = 12
const MAX_NAME = 24

export function loadViews(): SavedView[] {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(KEY) ?? '[]')
    if (!Array.isArray(raw)) return []
    return raw.filter((v): v is SavedView =>
      Boolean(v) && typeof v.id === 'string' && typeof v.label === 'string' && Array.isArray(v.on) && typeof v.sub === 'object' && v.sub !== null)
      .slice(0, MAX_VIEWS)
  } catch { return [] }
}

function store(views: SavedView[]): SavedView[] {
  try { localStorage.setItem(KEY, JSON.stringify(views)) } catch { /* storage blocked: the views last for this session only */ }
  return views
}

/** Adds a view, or replaces the one with the same name. Returns the new list. */
export function saveView(views: SavedView[], name: string, on: string[], sub: SubFilters): SavedView[] {
  const label = name.trim().slice(0, MAX_NAME)
  if (!label) return views
  const existing = views.find(v => v.label.toLowerCase() === label.toLowerCase())
  const view: SavedView = { id: existing?.id ?? `view-${Date.now().toString(36)}`, label, on: [...on], sub: { ...sub } }
  const next = existing ? views.map(v => (v === existing ? view : v)) : [...views, view].slice(-MAX_VIEWS)
  return store(next)
}

export function deleteView(views: SavedView[], id: string): SavedView[] {
  return store(views.filter(v => v.id !== id))
}
