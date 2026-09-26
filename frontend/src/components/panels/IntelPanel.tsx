import { useState } from 'react'
import { AlertItem, NewsItem, useCivicPick } from '../../store'

type FeedItem = {
  key:       string
  source:    string
  title:     string
  summary?:  string
  link:      string
  published: string
  priority:  'high' | 'normal'
  category?: string
}

function formatAge(iso: string): string {
  const ts = Date.parse(iso)
  if (Number.isNaN(ts)) return 'Link'
  const diff = Date.now() - ts
  const mins = Math.floor(diff / 60_000)
  if (mins < 1)  return 'Just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24)  return `${hrs}hr ago`
  return `${Math.floor(hrs / 24)}d ago`
}

/** Headline-first news card; the whole card opens the story. */
function FeedCard({ item }: { item: FeedItem }) {
  const isHigh = item.priority === 'high'
  const cls = `block p-3 border transition-colors focus:outline-none focus-visible:ring-1 focus-visible:ring-amber-gold ${isHigh
    ? 'border-amber-gold bg-amber-gold-muted/20 hover:border-white'
    : 'border-white/10 bg-surface-container/40 hover:border-amber-gold/60'}`
  const body = (
    <>
      <h4 className={`text-[15px] lg:text-[14px] leading-snug ${isHigh ? 'text-on-surface font-semibold' : 'text-on-surface font-medium'}`}>
        {isHigh && (
          <span className="ms text-[16px] leading-none text-amber-gold align-[-3px] mr-1" aria-hidden="true" style={{ fontVariationSettings: "'FILL' 1" }}>priority_high</span>
        )}
        {item.title}
      </h4>
      {item.summary && (
        <p className="text-[13px] text-on-surface-variant leading-relaxed line-clamp-2 mt-1">{item.summary}</p>
      )}
      <div className="flex items-center gap-2 mt-2 font-mono text-[11px] text-on-surface-variant">
        <span className={`uppercase tracking-widest truncate ${isHigh ? 'text-amber-gold' : ''}`}>{item.source}</span>
        <span aria-hidden="true">·</span>
        <span className="shrink-0">{formatAge(item.published)}</span>
        {item.link && <span className="ms text-[14px] leading-none ml-auto" aria-hidden="true">open_in_new</span>}
      </div>
    </>
  )
  return item.link ? (
    <a href={item.link} target="_blank" rel="noreferrer noopener" className={cls}>{body}</a>
  ) : (
    <article className={cls}>{body}</article>
  )
}

import { PageHeader, StatusDot, ChipRow, Chip, EmptyState } from '../common/Page'
import { CRITICAL_KEYWORDS } from '../../intelProcessor'

function toFeedItem(item: AlertItem | NewsItem, i: number, isAlert: boolean): FeedItem {
  const text = `${item.title} ${'summary' in item ? item.summary : ''}`.toLowerCase()
  const hasKeyword = CRITICAL_KEYWORDS.some(k => text.includes(k))

  return {
    key:       `${isAlert ? 'alert' : 'news'}-${i}`,
    source:    item.source,
    title:     item.title,
    summary:   'summary' in item ? item.summary : undefined,
    link:      item.link,
    published: item.published,
    priority:  (isAlert || hasKeyword) ? 'high' : 'normal',
    category:  item.category,
  }
}

export function IntelPanel() {
  const { alerts, news } = useCivicPick('alerts', 'news')
  const [category, setCategory] = useState<string>('all')

  // Merge and sort by published date descending
  const allItems = [
    ...alerts.map((a, i) => toFeedItem(a, i, true)),
    ...news.map((n, i) => toFeedItem(n, i, false)),
  ]

  // Separate tactical resources from the chronological news feed
  const resourceItems = allItems.filter(item => item.category === 'Tactical Resources')
  const newsItems = allItems
    .filter(item => item.category !== 'Tactical Resources')
    .sort((a, b) => {
      const bTs = Date.parse(b.published || '') || 0
      const aTs = Date.parse(a.published || '') || 0
      return bTs - aTs
    })

  // Group news by category
  const groupedNews: Record<string, FeedItem[]> = {}
  for (const item of newsItems) {
    const cat = item.category || 'Regional News'
    if (!groupedNews[cat]) groupedNews[cat] = []
    groupedNews[cat].push(item)
  }

  const categoryOrder = ['Local Government', 'Regional News']
  const sortedCategories = Object.keys(groupedNews).sort((a, b) => {
    const ai = categoryOrder.indexOf(a)
    const bi = categoryOrder.indexOf(b)
    if (ai !== -1 && bi !== -1) return ai - bi
    if (ai !== -1) return -1
    if (bi !== -1) return 1
    return a.localeCompare(b)
  })

  return (
    <div
      className="relative w-full h-full z-10 flex flex-col overflow-hidden"
      role="region"
      aria-label="Intel feed panel"
    >

      <PageHeader
        icon="psychology"
        title="Intel Feed"
        subtitle={`${alerts.length} alert${alerts.length === 1 ? '' : 's'} · ${news.length} news`}
        status={<StatusDot label="Live" />}
      />



      <div
        className="flex-1 overflow-y-auto p-4 lg:p-6 pb-6 space-y-4"
        role="feed"
        aria-label="Community news and alert feed"
        aria-live="polite"
      >
        {sortedCategories.length > 1 && (
          <ChipRow>
            <Chip active={category === 'all'} onClick={() => setCategory('all')}>All <span className="opacity-70">{newsItems.length}</span></Chip>
            {sortedCategories.map((cat) => (
              <Chip key={cat} active={category === cat} onClick={() => setCategory(cat)}>
                {cat} <span className="opacity-70">{groupedNews[cat].length}</span>
              </Chip>
            ))}
          </ChipRow>
        )}

        {newsItems.length === 0 && <EmptyState icon="rss_feed">Waiting for the news feeds — nothing received yet.</EmptyState>}

        {sortedCategories.filter((cat) => category === 'all' || cat === category).map((cat) => (
          <section key={cat}>
            <h3 className="section-heading mb-3 flex items-center gap-2">
              <span className="ms text-[16px] leading-none" aria-hidden="true">
                {cat === 'Local Government' ? 'account_balance' : 'rss_feed'}
              </span>
              {cat}
            </h3>
            <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
              {groupedNews[cat].map((item) => <FeedCard key={item.key} item={item} />)}
            </div>
          </section>
        ))}

        {resourceItems.length > 0 && (
          <details className="border-t border-white/10 pt-3 group">
            <summary className="flex items-center gap-2 h-9 cursor-pointer list-none text-on-surface-variant hover:text-on-surface">
              <span className="ms text-[18px] group-open:rotate-90 transition-transform" aria-hidden="true">chevron_right</span>
              <span className="label-caps !text-current">Alerting resources · {resourceItems.length}</span>
            </summary>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 mt-2">
              {resourceItems.map((item) => (
                <a
                  key={item.key}
                  href={item.link}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="flex flex-col p-3 border border-white/5 bg-white/5 hover:border-amber-gold/30 transition-colors group/res"
                >
                  <span className="font-mono text-[11px] text-amber-gold uppercase tracking-widest mb-1">{item.source.replace(/_/g, ' ')}</span>
                  <span className="text-[13px] font-bold text-on-surface group-hover/res:text-amber-gold transition-colors">{item.title}</span>
                  {item.summary && <span className="text-[12px] text-on-surface-variant mt-1 line-clamp-1">{item.summary}</span>}
                </a>
              ))}
            </div>
          </details>
        )}
      </div>
    </div>
  )
}
