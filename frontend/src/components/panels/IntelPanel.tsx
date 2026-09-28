import { useMemo, useState } from 'react'
import { AlertItem, NewsItem, useCivicPick } from '../../store'
import { PageHeader, StatusDot, ChipRow, Chip, EmptyState, SectionTitle } from '../common/Page'

/*
 * Intel — local news, ranked. Stories arrive already merged across outlets,
 * classified by topic and scored for local relevance (poller news_rank.py);
 * this page leads with what is local, keeps the rest compact, and remembers
 * what you've opened on this device.
 */

const TOPICS = ['Safety', 'Weather', 'Transportation', 'Government', 'Community', 'Sports', 'Obituaries', 'Other'] as const
const TOPIC_ICONS: Record<string, string> = {
  Safety: 'local_fire_department', Weather: 'partly_cloudy_day', Transportation: 'traffic',
  Government: 'account_balance', Community: 'groups', Sports: 'sports_score', Obituaries: 'local_florist', Other: 'article',
}
const LOCAL_LABELS: Record<number, string> = { 3: 'Home area', 2: 'Metro', 1: 'Oregon' }
// Not "local news" however close: they rank under Oregon & beyond.
const SIDELINED = new Set(['Sports', 'Obituaries'])
const READ_KEY = 'vertex.intel.read'
// City feeds keep weeks-old posts: "Local now" is the last week.
const LOCAL_NOW_MS = 7 * 24 * 60 * 60 * 1000
const isCurrent = (s: NewsItem) => !(Date.now() - Date.parse(s.published) > LOCAL_NOW_MS)

function formatAge(iso: string): string {
  const ts = Date.parse(iso)
  if (Number.isNaN(ts)) return ''
  const mins = Math.floor((Date.now() - ts) / 60_000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  return hrs < 24 ? `${hrs}h ago` : `${Math.floor(hrs / 24)}d ago`
}

const sourceName = (s: string) => s.replace(/_/g, ' ')

function loadRead(): Set<string> {
  try { return new Set(JSON.parse(localStorage.getItem(READ_KEY) ?? '[]')) } catch { return new Set() }
}

function StoryCard({ story, read, onOpen, compact = false }: {
  story: NewsItem
  read: boolean
  onOpen: () => void
  compact?: boolean
}) {
  const others = (story.sources ?? []).filter((s) => s.source !== story.source)
  const local = LOCAL_LABELS[story.local ?? 0]
  const urgent = !!story.emergency
  return (
    <article className={`border transition-colors ${urgent
      ? 'border-amber-gold bg-amber-gold-muted/20'
      : 'border-white/10 bg-surface-container/40 hover:border-amber-gold/50'} ${read ? 'opacity-55' : ''}`}>
      <a href={story.link} target="_blank" rel="noreferrer noopener" onClick={onOpen}
         className="block p-3 focus:outline-none focus-visible:ring-1 focus-visible:ring-amber-gold">
        <h4 className={`leading-snug text-on-surface ${compact ? 'text-[13px] font-medium' : 'text-[15px] lg:text-[14px] font-semibold'}`}>
          {urgent && <span className="ms ms-fill text-[16px] leading-none text-amber-gold align-[-3px] mr-1" aria-hidden="true">priority_high</span>}
          {story.title}
        </h4>
        {!compact && story.summary && (
          <p className="text-[13px] text-on-surface-variant leading-relaxed line-clamp-2 mt-1">{story.summary}</p>
        )}
        <div className="flex items-center gap-2 mt-2 font-mono text-[11px] text-on-surface-variant min-w-0">
          <span className="uppercase tracking-widest truncate">{sourceName(story.source)}</span>
          {others.length > 0 && <span className="shrink-0 text-amber-gold">+{others.length}</span>}
          {story.published && <><span aria-hidden="true">·</span><span className="shrink-0">{formatAge(story.published)}</span></>}
          <span className="ml-auto flex items-center gap-1.5 shrink-0">
            {local && <span className="uppercase tracking-widest border border-white/15 px-1">{local}</span>}
            {story.topic && <span className="ms text-[14px] leading-none" title={story.topic} aria-label={story.topic}>{TOPIC_ICONS[story.topic] ?? 'article'}</span>}
          </span>
        </div>
      </a>
      {!compact && others.length > 0 && (
        <div className="px-3 pb-2 -mt-1 flex flex-wrap gap-x-3 gap-y-1 font-mono text-[11px] uppercase tracking-widest">
          <span className="text-on-surface-variant/70">Also:</span>
          {others.map((o) => (
            <a key={o.link} href={o.link} target="_blank" rel="noreferrer noopener" onClick={onOpen}
               className="text-on-surface-variant hover:text-amber-gold">{sourceName(o.source)}</a>
          ))}
        </div>
      )}
    </article>
  )
}

export function IntelPanel() {
  const { alerts, news } = useCivicPick('alerts', 'news')
  const [topic, setTopic] = useState<string>('all')
  const [query, setQuery] = useState('')
  const [read, setRead] = useState<Set<string>>(loadRead)

  const markRead = (id: string | undefined) => {
    if (!id || read.has(id)) return
    const next = new Set(read).add(id)
    setRead(next)
    try { localStorage.setItem(READ_KEY, JSON.stringify([...next].slice(-500))) } catch { /* storage unavailable */ }
  }

  const stories = useMemo(() => news.filter((n) => n.category !== 'Tactical Resources'), [news])
  const resources = useMemo(() => news.filter((n) => n.category === 'Tactical Resources'), [news])
  const agency = alerts.filter((a: AlertItem) => a.source === 'flashalert')

  const counts = useMemo(() => {
    const c: Record<string, number> = {}
    for (const s of stories) c[s.topic ?? 'Other'] = (c[s.topic ?? 'Other'] ?? 0) + 1
    return c
  }, [stories])

  const q = query.trim().toLowerCase()
  const shown = stories.filter((s) =>
    (topic === 'all' || (s.topic ?? 'Other') === topic)
    && (!q || `${s.title} ${s.summary ?? ''} ${s.source}`.toLowerCase().includes(q)))
  // Already ranked by the server (local relevance, safety, freshness).
  const local = shown.filter((s) => (s.local ?? 0) >= 2 && !SIDELINED.has(s.topic ?? '') && isCurrent(s))
  const beyond = shown.filter((s) => !local.includes(s))
  const unread = stories.filter((s) => (s.local ?? 0) >= 2 && !SIDELINED.has(s.topic ?? '') && isCurrent(s) && !read.has(s.id ?? '')).length

  return (
    <div className="relative w-full h-full z-10 flex flex-col overflow-hidden" role="region" aria-label="Intel">
      <PageHeader
        icon="psychology"
        title="Intel"
        subtitle={`${stories.length} stories · ${unread} unread local`}
        status={<StatusDot label="Live" />}
      />
      <div className="flex-1 overflow-y-auto p-4 lg:p-6 pb-6 space-y-5" role="feed" aria-label="Local news">
        <div className="flex flex-col gap-3">
          <label className="relative block">
            <span className="sr-only">Search stories</span>
            <span className="ms text-[16px] absolute left-3 top-1/2 -translate-y-1/2 text-on-surface-variant pointer-events-none" aria-hidden="true">search</span>
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search headlines"
              className="tactical-input pl-9"
            />
          </label>
          <ChipRow>
            <Chip active={topic === 'all'} onClick={() => setTopic('all')}>All <span className="opacity-70">{stories.length}</span></Chip>
            {TOPICS.filter((t) => counts[t]).map((t) => (
              <Chip key={t} active={topic === t} onClick={() => setTopic(topic === t ? 'all' : t)}>
                {t} <span className="opacity-70">{counts[t]}</span>
              </Chip>
            ))}
          </ChipRow>
        </div>

        {stories.length === 0 && <EmptyState icon="rss_feed">Waiting for the news feeds — nothing received yet.</EmptyState>}

        {local.length > 0 && (
          <section>
            <SectionTitle>Local now</SectionTitle>
            <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
              {local.map((s) => <StoryCard key={s.id ?? s.link} story={s} read={read.has(s.id ?? '')} onOpen={() => markRead(s.id)} />)}
            </div>
          </section>
        )}

        {agency.length > 0 && topic === 'all' && !q && (
          <section>
            <SectionTitle>Agency notices</SectionTitle>
            <ul className="space-y-2">
              {agency.map((a, i) => (
                <li key={i} className="border border-white/10 bg-surface-container/40 p-3">
                  <div className="text-[13px] font-semibold text-on-surface">{a.title}</div>
                  {a.summary && <p className="text-[12px] text-on-surface-variant line-clamp-2 mt-0.5">{a.summary}</p>}
                </li>
              ))}
            </ul>
          </section>
        )}

        {beyond.length > 0 && (
          <section>
            <SectionTitle>Oregon, beyond &amp; older</SectionTitle>
            <div className="grid grid-cols-1 xl:grid-cols-2 gap-2">
              {beyond.map((s) => <StoryCard key={s.id ?? s.link} story={s} compact read={read.has(s.id ?? '')} onOpen={() => markRead(s.id)} />)}
            </div>
          </section>
        )}

        {shown.length === 0 && stories.length > 0 && (
          <EmptyState icon="search_off">No stories match.</EmptyState>
        )}

        {resources.length > 0 && topic === 'all' && !q && (
          <section>
            <SectionTitle>Resources</SectionTitle>
            <ul className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              {resources.map((r) => (
                <li key={r.link}>
                  <a href={r.link} target="_blank" rel="noreferrer noopener"
                     className="block p-3 border border-white/10 hover:border-amber-gold/60 transition-colors">
                    <div className="text-[13px] font-semibold text-on-surface">{r.title}</div>
                    {r.summary && <p className="text-[12px] text-on-surface-variant mt-0.5">{r.summary}</p>}
                  </a>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </div>
  )
}
