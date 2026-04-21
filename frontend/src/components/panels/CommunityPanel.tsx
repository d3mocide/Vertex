import { useCivicStore, AlertItem, NewsItem } from '../../store'

type FeedItem = {
  key:       string
  source:    string
  title:     string
  summary?:  string
  link:      string
  published: string
  priority:  'high' | 'normal'
}

function formatAge(iso: string): string {
  const diff = Date.now() - Date.parse(iso)
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
  }
}

export function CommunityPanel() {
  const { alerts, news } = useCivicStore()

  // Merge and sort by published date descending
  const feed: FeedItem[] = [
    ...alerts.map((a, i) => toFeedItem(a, i, true)),
    ...news.map((n, i) => toFeedItem(n, i, false)),
  ].sort((a, b) => Date.parse(b.published) - Date.parse(a.published))

  // If both are empty, show placeholder items
  const displayFeed: FeedItem[] = feed.length > 0 ? feed : [
    {
      key: 'placeholder-1',
      source: 'FLASHALERT',
      title: 'Awaiting FlashAlert Newswire feed…',
      published: new Date().toISOString(),
      link: '',
      priority: 'normal',
    },
    {
      key: 'placeholder-2',
      source: 'TUALATIN LIFE',
      title: 'Awaiting local news feed…',
      published: new Date(Date.now() - 3600_000).toISOString(),
      link: '',
      priority: 'normal',
    },
  ]

  return (
    <div
      className="relative w-full h-full bg-onyx-black/95 backdrop-blur-sm z-10 flex flex-col overflow-hidden"
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

      {/* Source legend */}
      <div className="px-4 py-2 border-b border-amber-gold-muted/20 flex items-center gap-4 shrink-0 bg-surface-container/30">
        <div className="flex items-center gap-1.5">
          <span className="w-2 h-2 bg-amber-gold shrink-0" aria-hidden="true" />
          <span className="font-mono text-[9px] text-on-surface-variant uppercase tracking-widest">FlashAlert Emergency</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="w-2 h-2 bg-on-surface-variant shrink-0" aria-hidden="true" />
          <span className="font-mono text-[9px] text-on-surface-variant uppercase tracking-widest">Local News</span>
        </div>
      </div>

      {/* Feed */}
      <div
        className="flex-1 overflow-y-auto p-4"
        role="feed"
        aria-label="Community news and alert feed"
        aria-live="polite"
      >
        {displayFeed.map((item) => (
          <FeedCard key={item.key} item={item} />
        ))}
      </div>
    </div>
  )
}
