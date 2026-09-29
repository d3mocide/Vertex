// Who an aircraft flies for — set by the poller (identity.role, poller/enrichment/aircraft_roles.py).
// Life-safety roles share the emergency red used for dispatch incidents; law enforcement uses the
// P25/dispatch amber; everything else is a quiet grey.

export type AircraftRole = 'rescue' | 'medical' | 'fire' | 'law_enforcement' | 'military' | 'news' | 'government'

export interface RoleMeta {
  label: string
  short: string
  text: string                       // Tailwind text token
  border: string                     // Tailwind border token (badge outline)
  rgb: [number, number, number]      // map ring colour
}

const RED: [number, number, number] = [198, 40, 40]     // red-emergency
const AMBER: [number, number, number] = [255, 143, 0]   // amber-p25
const GREY: [number, number, number] = [140, 140, 140]  // on-surface-variant

export const ROLE_META: Record<AircraftRole, RoleMeta> = {
  rescue:          { label: 'Search & rescue',     short: 'SAR',      text: 'text-red-emergency', border: 'border-red-emergency/60', rgb: RED },
  medical:         { label: 'Air ambulance',       short: 'MEDICAL',  text: 'text-red-emergency', border: 'border-red-emergency/60', rgb: RED },
  fire:            { label: 'Aerial firefighting', short: 'FIRE',     text: 'text-red-emergency', border: 'border-red-emergency/60', rgb: RED },
  law_enforcement: { label: 'Law enforcement',     short: 'POLICE',   text: 'text-amber-p25',     border: 'border-amber-p25/60',     rgb: AMBER },
  military:        { label: 'Military',            short: 'MIL',      text: 'text-on-surface-variant', border: 'border-white/20',    rgb: GREY },
  news:            { label: 'News / media',        short: 'NEWS',     text: 'text-on-surface-variant', border: 'border-white/20',    rgb: GREY },
  government:      { label: 'Government',          short: 'GOV',      text: 'text-on-surface-variant', border: 'border-white/20',    rgb: GREY },
}

export const ROLE_ORDER: AircraftRole[] = ['rescue', 'medical', 'fire', 'law_enforcement', 'military', 'news', 'government']

export function roleMeta(role: unknown): RoleMeta | null {
  return typeof role === 'string' && role in ROLE_META ? ROLE_META[role as AircraftRole] : null
}

export const ALERT_LABEL: Record<string, string> = {
  emergency: '7700 EMERGENCY',
  hijack: '7500 HIJACK',
  radio_failure: '7600 RADIO FAIL',
  uav_lost_link: '7400 UAV LINK',
}
