import { useCapabilities, useCapabilitiesUnavailable } from '../../hooks/useCapabilities'
import { formatAge } from './FeedAge'

const PROVIDER_NAMES: Record<string, string> = {
  'odot-tripcheck': 'ODOT', 'wsdot-travel': 'WSDOT', 'oregon-odin': 'ODIN',
  'trimet-transit': 'TriMet', 'cherriots-transit': 'Cherriots',
  'soundtransit-transit': 'Sound Transit', 'ctran-transit': 'C-TRAN',
  'odf-fire-danger': 'ODF', 'wadnr-fire-danger': 'WA DNR',
}

/** Show each affected source even when another provider keeps the combined feed fresh. */
export function RegionalFeedStatus({ contracts }: { contracts: string[] }) {
  const caps = useCapabilities()
  const unavailable = useCapabilitiesUnavailable()
  const issues = new Map<string, { provider: string; status: string; reason: string | null; titles: string[]; age: number | null }>()
  for (const id of contracts) {
    const contract = caps?.contracts[id]
    if (!contract) continue
    for (const [provider, detail] of Object.entries(contract.provider_statuses ?? {})) {
      if (detail.status === 'ok' || (detail.status === 'none' && !['not_configured', 'access_unverified'].includes(detail.reason ?? ''))) continue
      const key = `${provider}:${detail.status}`
      const issue = issues.get(key) ?? { provider, status: detail.status, reason: detail.reason, titles: [], age: detail.updated_age_s }
      issue.titles.push(contract.title)
      if (detail.updated_age_s != null) issue.age = Math.max(issue.age ?? 0, detail.updated_age_s)
      issues.set(key, issue)
    }
  }
  if (!unavailable && issues.size === 0) return null
  return (
    <section className="hud-panel px-4 py-3 stack-y-2" role="status" aria-label="Regional feed status">
      {unavailable && <p className="text-[12px] text-amber-gold">Feed freshness could not be checked. Displayed data may be out of date.</p>}
      {[...issues.entries()].map(([key, issue]) => (
        <div key={key} className="text-[12px]">
          <span className={`font-mono ${issue.status === 'down' ? 'text-red-emergency' : 'text-amber-gold'}`}>
            {PROVIDER_NAMES[issue.provider] ?? issue.provider} · {issue.status === 'stale' ? 'Updates delayed' : issue.status === 'down' ? 'Updates overdue' : issue.status === 'none' ? (issue.reason === 'access_unverified' ? 'Supported feed access pending' : 'API key required') : 'Waiting for first update'}
            {issue.age != null ? ` · last received ${formatAge(issue.age)}` : ''}
          </span>
          <p className="text-on-surface-variant">{issue.titles.join(', ')}</p>
        </div>
      ))}
      {[...issues.values()].some((issue) => issue.status === 'stale' || issue.status === 'down') && (
        <p className="text-[11px] text-on-surface-variant">Last known data may remain visible while updates are overdue.</p>
      )}
    </section>
  )
}
