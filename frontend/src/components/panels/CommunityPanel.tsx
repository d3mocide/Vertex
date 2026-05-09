import { useCivicStore, AlertItem, NewsItem } from '../../store'

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

function FeedCard({ item }: { item: FeedItem }) {
  const isHigh = item.priority === 'high'

  return (
    <article
      className={`
        p-3 border mb-3 cursor-pointer transition-colors
        focus:outline-none focus-visible:ring-1 focus-visible:ring-amber-gold
        ${isHigh
          ? 'border-amber-gold bg-amber-gold-muted/20 hover:border-white'
          : 'border-amber-gold-muted/40 bg-surface-container/30 hover:border-amber-gold'}
      `}
      tabIndex={0}
      role="article"
      aria-label={`${item.source}: ${item.title}`}
    >
      <div className="flex items-start justify-between gap-3 mb-1.5">
        <div className="flex items-center gap-2 min-w-0">
          {isHigh && (
            <span
              className="ms text-[14px] leading-none text-amber-gold shrink-0"
              aria-hidden="true"
              style={{ fontVariationSettings: "'FILL' 1" }}
            >
              priority_high
            </span>
          )}
          <span className={`font-mono text-[9px] uppercase tracking-widest shrink-0 ${isHigh ? 'text-amber-gold' : 'text-on-surface-variant'}`}>
            {item.source}
          </span>
        </div>
        <span className="font-mono text-[9px] text-on-surface-variant shrink-0">
          {formatAge(item.published)}
        </span>
      </div>

      <h4 className={`text-[12px] leading-snug mb-1 ${isHigh ? 'text-on-surface font-semibold' : 'text-on-surface'}`}>
        {item.title}
      </h4>

      {item.summary && (
        <p className="text-[11px] text-on-surface-variant leading-relaxed line-clamp-2">
          {item.summary}
        </p>
      )}

      <div className="flex items-center gap-3 mt-2">
        {item.link && (
          <a
            href={item.link}
            target="_blank"
            rel="noreferrer noopener"
            className="font-mono text-[9px] text-amber-gold-dim hover:text-amber-gold transition-colors uppercase tracking-widest"
            aria-label={`Read more: ${item.title}`}
            onClick={(e) => e.stopPropagation()}
          >
            READ →
          </a>
        )}
      </div>
    </article>
  )
}

function toFeedItem(item: AlertItem | NewsItem, i: number, isAlert: boolean): FeedItem {
  return {
    key:       `${isAlert ? 'alert' : 'news'}-${i}`,
    source:    item.source,
    title:     item.title,
    summary:   'summary' in item ? item.summary : undefined,
    link:      item.link,
    published: item.published,
    priority:  isAlert ? 'high' : 'normal',
    category:  item.category,
  }
}

export function CommunityPanel() {
  const { alerts, news } = useCivicStore()

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

  // If live feed is empty, show placeholders in Regional News
  if (newsItems.length === 0) {
    groupedNews['Regional News'] = [
      {
        key: 'placeholder-1',
        source: 'FLASHALERT',
        title: 'Awaiting FlashAlert Newswire feed…',
        published: new Date().toISOString(),
        link: '',
        priority: 'normal',
        category: 'Regional News',
      },
      {
        key: 'placeholder-2',
        source: 'TUALATIN LIFE',
        title: 'Awaiting local news feed…',
        published: new Date(Date.now() - 3600_000).toISOString(),
        link: '',
        priority: 'normal',
        category: 'Regional News',
      },
    ]
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
      aria-label="Community feed panel"
    >

      {/* Panel header */}
      <div className="px-4 py-3 border-b border-amber-gold-muted flex items-center gap-3 shrink-0">
        <span
          className="ms text-[18px] text-amber-gold leading-none"
          aria-hidden="true"
          style={{ fontVariationSettings: "'FILL' 1" }}
        >
          groups
        </span>
        <h2 className="font-bold text-sm uppercase tracking-tight text-on-surface">
          Community Feed
        </h2>
        <div className="ml-auto flex items-center gap-3">
          <span className="font-mono text-[9px] text-on-surface-variant uppercase">
            {alerts.length} alerts · {news.length} news
          </span>
          <div className="flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-green-ais animate-pulse" aria-hidden="true" />
            <span className="font-mono text-[9px] text-green-ais uppercase">LIVE</span>
          </div>
        </div>
      </div>



      {/* Feed */}
      <div
        className="flex-1 overflow-y-auto p-4 pb-24"
        role="feed"
        aria-label="Community news and alert feed"
        aria-live="polite"
      >
        {resourceItems.length > 0 && (
          <div className="mb-10">
            <h3 className="section-heading mb-3 text-on-surface-variant/60">
              <span className="ms text-[14px] leading-none" aria-hidden="true">link</span>
              Tactical Resources
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
              {resourceItems.map((item) => (
                <a
                  key={item.key}
                  href={item.link}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="flex flex-col p-3 border border-white/5 bg-white/5 hover:bg-white/10 hover:border-amber-gold/30 transition-all group"
                >
                  <span className="font-mono text-[8px] text-amber-gold uppercase tracking-[0.2em] mb-1">{item.source.replace(/_/g, ' ')}</span>
                  <span className="text-[11px] font-bold text-on-surface group-hover:text-amber-gold transition-colors">{item.title}</span>
                  {item.summary && <span className="text-[10px] text-on-surface-variant mt-1 line-clamp-1">{item.summary}</span>}
                </a>
              ))}
            </div>
            <div className="mt-8 border-b border-white/10" />
          </div>
        )}

        {sortedCategories.map((cat) => (
          <div key={cat} className="mb-10 last:mb-0">
            <h3 className="section-heading mb-4 text-on-surface flex items-center gap-2">
              <span className="ms text-[14px] leading-none text-amber-gold" aria-hidden="true">
                {cat === 'Local Government' ? 'account_balance' : 'rss_feed'}
              </span>
              {cat}
            </h3>
            {groupedNews[cat].map((item) => (
              <FeedCard key={item.key} item={item} />
            ))}
          </div>
        ))}
      </div>
    </div>
  )
}
