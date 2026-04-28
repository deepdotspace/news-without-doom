/**
 * News Without Doom — calm news brief.
 *
 * Pipeline (per topic switch / refresh):
 *   1. Hydrate from localStorage. If fresh (< 1h), show it instantly and
 *      skip the network entirely. Otherwise fall through:
 *   2. Fetch RSS via /api/rss proxy (server-side, edge-cached, no CORS).
 *   3. As soon as feeds parse, render the headlines list immediately.
 *   4. Run LLM enrichment + LLM brief generation IN PARALLEL — both
 *      consume the raw items, neither blocks the other.
 *   5. Once both complete, persist to localStorage so the next visit
 *      (and the next reload) is instant.
 *
 * Refresh button busts the cached entry for the current topic.
 *
 * Auth-gated by virtue of living under (protected)/. The new SDK requires
 * auth for `integration.post()` to avoid leaking the owner's billing.
 */

import React, { useEffect, useMemo, useRef, useState } from 'react'
import {
  TOPICS,
  FILTER_OPTIONS,
  fetchTopicFeeds,
  deduplicateItems,
  selectHeadlines,
  computeHeadlineSetHash,
  processHeadlineItemsWithLLM,
  generateTopicBrief,
  generateDetailedSummary,
  type EnrichedHeadline,
  type RawHeadline,
  type TopicBrief,
  type SavedHeadline,
} from '../../lib/news'
import {
  loadCache,
  saveCache,
  isCacheFresh,
  formatAge,
  type TopicCache,
  type CachedTopic,
} from '../../lib/storage'
import NewsHeader from '../../components/NewsHeader'

const EMPTY_BRIEF = (topic: string): TopicBrief => ({
  themeLabel: topic,
  takeaway: '',
  nowBullets: [],
  stakeholdersBullets: [],
  watchNextBullets: [],
  whyItMattersBullets: [],
  viewpointsBullets: [],
  bulletArticleMap: {},
})

export default function NewsPage() {
  // ─── State ────────────────────────────────────────────────────────────
  const [cache, setCache] = useState<TopicCache>(() => loadCache())
  const [selectedTopic, setSelectedTopic] = useState<string>('Tech')
  const [negativityFilter, setNegativityFilter] = useState<string>('Light')

  // Live data for the *currently displayed* topic.
  const [items, setItems] = useState<EnrichedHeadline[]>([])
  const [brief, setBrief] = useState<TopicBrief>(EMPTY_BRIEF('Tech'))
  const [fetchedAt, setFetchedAt] = useState<number | null>(null)

  const [updating, setUpdating] = useState(false)
  const [briefLoading, setBriefLoading] = useState(false)
  const [forceRefreshNonce, setForceRefreshNonce] = useState(0)

  // Modal / drawer / accordion UI state.
  const [selectedHeadline, setSelectedHeadline] = useState<EnrichedHeadline | null>(null)
  const [savedItems, setSavedItems] = useState<SavedHeadline[]>([])
  const [savedDrawerOpen, setSavedDrawerOpen] = useState(false)
  const [expandedBulletId, setExpandedBulletId] = useState<string | null>(null)
  const [bulletSummaries, setBulletSummaries] = useState<Record<string, string>>({})
  const [loadingSummary, setLoadingSummary] = useState<string | null>(null)

  const abortRef = useRef<AbortController | null>(null)
  const requestIdRef = useRef(0)
  const summaryAbortRef = useRef<Record<string, AbortController>>({})

  // ─── Pipeline ─────────────────────────────────────────────────────────
  useEffect(() => {
    abortRef.current?.abort()
    abortRef.current = new AbortController()
    const signal = abortRef.current.signal
    const requestId = ++requestIdRef.current

    // 1. Cache hit — render instantly, skip the network.
    const cached = cache[selectedTopic]
    if (forceRefreshNonce === 0 && isCacheFresh(cached)) {
      const filtered = selectHeadlines(cached.items, selectedTopic, negativityFilter).slice(0, 10)
      setItems(filtered)
      setBrief(cached.brief)
      setFetchedAt(cached.fetchedAt)
      setUpdating(false)
      setBriefLoading(false)
      return
    }

    // 2. Cache miss / refresh — show skeletons while we fetch.
    setItems([])
    setBrief(EMPTY_BRIEF(selectedTopic))
    setFetchedAt(null)
    setUpdating(true)
    setBriefLoading(true)

    runPipeline({
      topic: selectedTopic,
      filter: negativityFilter,
      signal,
      isCurrent: () => requestId === requestIdRef.current,
      onItemsReady: (raw) => {
        if (requestId !== requestIdRef.current) return
        // 3. As soon as RSS is parsed, render the headlines (without
        // enriched calm rewrites yet — those land later).
        const ranked = selectHeadlines(raw as any, selectedTopic, negativityFilter).slice(0, 10) as EnrichedHeadline[]
        setItems(ranked)
        setUpdating(false)
      },
      onEnriched: (enriched) => {
        if (requestId !== requestIdRef.current) return
        setItems(enriched)
      },
      onBrief: (newBrief) => {
        if (requestId !== requestIdRef.current) return
        setBrief(newBrief)
        setBriefLoading(false)
      },
      onComplete: (cached) => {
        if (requestId !== requestIdRef.current) return
        setCache((prev) => {
          const next = { ...prev, [selectedTopic]: cached }
          saveCache(next)
          return next
        })
        setFetchedAt(cached.fetchedAt)
      },
      onError: () => {
        if (requestId !== requestIdRef.current) return
        setUpdating(false)
        setBriefLoading(false)
      },
    })

    return () => abortRef.current?.abort()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedTopic, negativityFilter, forceRefreshNonce])

  // Reset bullet expand state when topic changes.
  useEffect(() => {
    setExpandedBulletId(null)
    Object.values(summaryAbortRef.current).forEach((c) => c.abort())
    summaryAbortRef.current = {}
  }, [selectedTopic])

  // ─── Handlers ─────────────────────────────────────────────────────────
  const handleRefresh = () => {
    // Drop the cached entry for the current topic, then bump the nonce
    // to force the pipeline to actually re-run (instead of the cache hit
    // path).
    setCache((prev) => {
      const next = { ...prev }
      delete next[selectedTopic]
      saveCache(next)
      return next
    })
    setForceRefreshNonce((n) => n + 1)
  }

  const handleSave = (headline: EnrichedHeadline) => {
    setSavedItems((prev) => {
      const exists = prev.find((h) => h.id === headline.id)
      if (exists) return prev.filter((h) => h.id !== headline.id)
      return [...prev, { ...headline, savedAt: Date.now() }]
    })
  }
  const isSaved = (id: string) => savedItems.some((h) => h.id === id)

  const handleReadMoreToggle = async (
    bulletId: string,
    articles: EnrichedHeadline[],
    event: React.MouseEvent,
  ) => {
    if (expandedBulletId === bulletId) {
      setExpandedBulletId(null)
      return
    }
    setExpandedBulletId(bulletId)
    const cacheKey = articles.map((a) => a.link).sort().join('::')
    if (!bulletSummaries[cacheKey]) {
      summaryAbortRef.current[bulletId]?.abort()
      const controller = new AbortController()
      summaryAbortRef.current[bulletId] = controller
      try {
        setLoadingSummary(bulletId)
        const summary = await generateDetailedSummary(articles, controller.signal)
        setBulletSummaries((prev) => ({ ...prev, [cacheKey]: summary }))
      } catch (err: any) {
        if (err?.name !== 'AbortError') {
          setBulletSummaries((prev) => ({ ...prev, [cacheKey]: 'Unable to generate summary.' }))
        }
      } finally {
        setLoadingSummary(null)
        delete summaryAbortRef.current[bulletId]
      }
    }
    setTimeout(() => {
      const element = (event?.target as HTMLElement)?.closest('li')
      element?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
    }, 150)
  }

  // ─── Derived ──────────────────────────────────────────────────────────
  const sortedSavedItems = useMemo(
    () => [...savedItems].sort((a, b) => (b.savedAt ?? 0) - (a.savedAt ?? 0)),
    [savedItems],
  )
  const headlines = useMemo(() => items.slice(0, 10), [items])

  const ageLabel = useMemo(() => {
    if (!fetchedAt) return null
    return formatAge(Date.now() - fetchedAt)
  }, [fetchedAt, items])

  const today = useMemo(() => {
    return new Date().toLocaleDateString('en-US', {
      weekday: 'long',
      month: 'long',
      day: 'numeric',
    })
  }, [])

  // ─── Render ───────────────────────────────────────────────────────────
  return (
    <div className="flex h-full flex-col bg-background">
      <NewsHeader
        topics={TOPICS}
        selectedTopic={selectedTopic}
        onSelectTopic={setSelectedTopic}
        filterOptions={FILTER_OPTIONS}
        negativityFilter={negativityFilter}
        onChangeFilter={setNegativityFilter}
        updating={updating || briefLoading}
        onRefresh={handleRefresh}
        savedCount={savedItems.length}
        onToggleSaved={() => setSavedDrawerOpen((v) => !v)}
      />

      <div className="flex-1 overflow-y-auto">
        <main className="mx-auto w-full max-w-3xl px-5 pt-10 pb-24 sm:px-8">
          {/* Date strap */}
          <div className="mb-3 flex items-center gap-2 text-[10.5px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
            <span>{today.toUpperCase()}</span>
            {ageLabel && (
              <>
                <span className="h-[3px] w-[3px] rounded-full bg-muted-foreground/40" />
                <span className="normal-case tracking-normal text-[11px] font-normal">Updated {ageLabel}</span>
              </>
            )}
          </div>

          {/* Hero takeaway */}
          <Hero
            topic={selectedTopic}
            brief={brief}
            loading={briefLoading}
          />

          {/* Brief grid */}
          <section className="mt-10 grid grid-cols-1 gap-5 sm:grid-cols-2">
            {briefLoading && brief.nowBullets.length === 0 ? (
              <>
                <SkeletonCard />
                <SkeletonCard />
                <SkeletonCard />
                <SkeletonCard />
              </>
            ) : (
              <>
                <BriefSection
                  index="01"
                  title="What's happening"
                  bullets={brief.nowBullets}
                  bulletArticleMap={brief.bulletArticleMap}
                  expandedBulletId={expandedBulletId}
                  loadingSummary={loadingSummary}
                  bulletSummaries={bulletSummaries}
                  onReadMoreToggle={handleReadMoreToggle}
                  span="full"
                />
                <BriefSection
                  index="02"
                  title="Key players"
                  bullets={brief.stakeholdersBullets}
                  bulletArticleMap={brief.bulletArticleMap}
                  expandedBulletId={expandedBulletId}
                  loadingSummary={loadingSummary}
                  bulletSummaries={bulletSummaries}
                  onReadMoreToggle={handleReadMoreToggle}
                />
                <BriefSection
                  index="03"
                  title="What to watch"
                  bullets={brief.watchNextBullets}
                  bulletArticleMap={brief.bulletArticleMap}
                  expandedBulletId={expandedBulletId}
                  loadingSummary={loadingSummary}
                  bulletSummaries={bulletSummaries}
                  onReadMoreToggle={handleReadMoreToggle}
                />
                <BriefSection
                  index="04"
                  title="Why it matters"
                  bullets={brief.whyItMattersBullets}
                  bulletArticleMap={brief.bulletArticleMap}
                  expandedBulletId={expandedBulletId}
                  loadingSummary={loadingSummary}
                  bulletSummaries={bulletSummaries}
                  onReadMoreToggle={handleReadMoreToggle}
                />
                <BriefSection
                  index="05"
                  title="Viewpoints"
                  bullets={brief.viewpointsBullets}
                  bulletArticleMap={brief.bulletArticleMap}
                  expandedBulletId={expandedBulletId}
                  loadingSummary={loadingSummary}
                  bulletSummaries={bulletSummaries}
                  onReadMoreToggle={handleReadMoreToggle}
                />
              </>
            )}
          </section>

          {/* Top headlines */}
          <section className="mt-12">
            <h3 className="mb-4 text-[10.5px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
              Top headlines
            </h3>
            {headlines.length === 0 ? (
              <SkeletonHeadlines />
            ) : (
              <ul className="divide-y divide-border/60 border-y border-border/60">
                {headlines.map((headline) => (
                  <li
                    key={headline.id}
                    onClick={() => setSelectedHeadline(headline)}
                    className="group cursor-pointer py-4 transition-colors hover:bg-secondary/30"
                  >
                    <div className="mb-1 flex items-center gap-2 text-[10.5px] uppercase tracking-[0.14em]">
                      <span className="font-semibold text-primary">{headline.source}</span>
                      <span className="h-[3px] w-[3px] rounded-full bg-muted-foreground/40" />
                      <span className="text-muted-foreground">{headline.publishedAt}</span>
                    </div>
                    <p className="font-serif text-[16px] leading-snug text-foreground transition-colors group-hover:text-primary">
                      {headline.title}
                    </p>
                    {headline.contextLine && (
                      <p className="mt-1 line-clamp-2 text-[13px] leading-relaxed text-muted-foreground">
                        {headline.contextLine}
                      </p>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>
        </main>
      </div>

      {savedDrawerOpen && (
        <SavedDrawer
          items={sortedSavedItems}
          onClose={() => setSavedDrawerOpen(false)}
          onOpenItem={(item) => setSelectedHeadline(item)}
          onRemove={handleSave}
        />
      )}
      {selectedHeadline && (
        <HeadlineModal
          headline={selectedHeadline}
          isSaved={isSaved(selectedHeadline.id)}
          onClose={() => setSelectedHeadline(null)}
          onToggleSave={() => handleSave(selectedHeadline)}
        />
      )}
    </div>
  )
}

// ─── Pipeline ────────────────────────────────────────────────────────────

interface PipelineDeps {
  topic: string
  filter: string
  signal: AbortSignal
  isCurrent: () => boolean
  onItemsReady: (items: RawHeadline[]) => void
  onEnriched: (items: EnrichedHeadline[]) => void
  onBrief: (brief: TopicBrief) => void
  onComplete: (cached: CachedTopic) => void
  onError: () => void
}

async function runPipeline(deps: PipelineDeps) {
  const { topic, filter, signal, isCurrent, onItemsReady, onEnriched, onBrief, onComplete, onError } = deps
  try {
    const { items: raw } = await fetchTopicFeeds(topic, signal)
    if (!isCurrent()) return
    if (raw.length === 0) {
      onBrief({
        themeLabel: topic,
        takeaway: 'No recent headlines found.',
        nowBullets: [],
        stakeholdersBullets: [],
        watchNextBullets: [],
        whyItMattersBullets: [],
        viewpointsBullets: [],
        bulletArticleMap: {},
      })
      onError()
      return
    }

    const dedup = deduplicateItems(raw)
    const sorted = [...dedup].sort((a, b) => {
      if (b.timestamp !== a.timestamp) return b.timestamp - a.timestamp
      if (a.source !== b.source) return a.source.localeCompare(b.source)
      return a.title.localeCompare(b.title)
    })
    onItemsReady(sorted)

    // Top 10 (post-filter) feed both LLM passes.
    const filtered = selectHeadlines(sorted as any, topic, filter).slice(0, 10) as RawHeadline[]

    // Run enrichment + brief generation in parallel — both consume raw
    // descriptions, neither needs the other's output.
    const [enriched, brief] = await Promise.all([
      processHeadlineItemsWithLLM(filtered, signal),
      generateTopicBrief(filtered as unknown as EnrichedHeadline[], topic, signal),
    ])
    if (!isCurrent()) return

    onEnriched(enriched)
    onBrief(brief)

    onComplete({
      brief,
      items: enriched,
      fetchedAt: Date.now(),
    })
  } catch (err: any) {
    if (err?.name === 'AbortError') return
    console.error('[news-pipeline] failed:', err)
    onError()
  }
}

// ─── Hero takeaway ───────────────────────────────────────────────────────

function Hero({ topic, brief, loading }: { topic: string; brief: TopicBrief; loading: boolean }) {
  return (
    <div>
      <div className="mb-2 text-[10.5px] font-medium uppercase tracking-[0.22em] text-primary">
        {brief.themeLabel || topic}
      </div>
      {loading && !brief.takeaway ? (
        <div className="space-y-2">
          <div className="h-7 w-11/12 animate-pulse rounded bg-muted/60" />
          <div className="h-7 w-9/12 animate-pulse rounded bg-muted/60" />
        </div>
      ) : (
        <h1 className="font-serif text-[28px] leading-tight text-foreground sm:text-[34px]">
          {brief.takeaway || `A calm read on ${topic.toLowerCase()}.`}
        </h1>
      )}
    </div>
  )
}

// ─── Brief section card ──────────────────────────────────────────────────

interface BriefSectionProps {
  index: string
  title: string
  bullets: { id: string; text: string }[]
  bulletArticleMap: Record<string, EnrichedHeadline[]>
  expandedBulletId: string | null
  loadingSummary: string | null
  bulletSummaries: Record<string, string>
  onReadMoreToggle: (bulletId: string, articles: EnrichedHeadline[], event: React.MouseEvent) => void
  span?: 'half' | 'full'
}

function BriefSection({
  index,
  title,
  bullets,
  bulletArticleMap,
  expandedBulletId,
  loadingSummary,
  bulletSummaries,
  onReadMoreToggle,
  span = 'half',
}: BriefSectionProps) {
  if (!bullets || bullets.length === 0) return null
  return (
    <article
      className={`rounded-2xl border border-border/60 bg-card p-5 sm:p-6 ${
        span === 'full' ? 'sm:col-span-2' : ''
      }`}
    >
      <header className="mb-4 flex items-baseline gap-3">
        <span className="text-[10.5px] font-medium tabular-nums text-muted-foreground/70">{index}</span>
        <h4 className="text-[10.5px] font-medium uppercase tracking-[0.18em] text-foreground">{title}</h4>
      </header>
      <ul className="space-y-3">
        {bullets.map((bullet) => {
          const articles = bulletArticleMap?.[bullet.id]
          const isExpanded = expandedBulletId === bullet.id
          const cacheKey = articles ? articles.map((a) => a.link).sort().join('::') : null
          const cachedSummary = cacheKey ? bulletSummaries[cacheKey] : null

          return (
            <li key={bullet.id || bullet.text} className="text-[14px] leading-relaxed">
              <div className="flex items-start gap-2.5">
                <span className="mt-[7px] h-1 w-1 shrink-0 rounded-full bg-primary/60" />
                <div className="flex-1 min-w-0">
                  <span className="text-foreground">{bullet.text}</span>
                  {articles && articles.length > 0 && (
                    <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[11px]">
                      {articles.map((article) => (
                        <a
                          key={article.id}
                          href={article.link}
                          target="_blank"
                          rel="noopener noreferrer"
                          title={article.title}
                          className="rounded-full border border-border bg-secondary/60 px-2 py-0.5 font-medium text-muted-foreground transition-colors hover:border-primary/40 hover:bg-primary/10 hover:text-primary"
                        >
                          {article.source}
                        </a>
                      ))}
                      <button
                        onClick={(e) => onReadMoreToggle(bullet.id, articles, e)}
                        className="rounded-full px-1.5 py-0.5 font-medium text-muted-foreground transition-colors hover:text-foreground"
                      >
                        {isExpanded ? 'Hide' : 'Read more'}
                      </button>
                    </div>
                  )}
                </div>
              </div>

              {isExpanded && articles && articles.length > 0 && (
                <div className="accordion-panel ml-3.5 mt-3 border-l-2 border-primary/30 pl-3">
                  {loadingSummary === bullet.id ? (
                    <div className="flex items-center gap-2 py-1 text-[12px] text-muted-foreground">
                      <span className="h-3 w-3 animate-spin rounded-full border-2 border-primary/30 border-t-primary" />
                      Generating summary…
                    </div>
                  ) : cachedSummary ? (
                    <p className="text-[12.5px] leading-relaxed text-muted-foreground">{cachedSummary}</p>
                  ) : (
                    <p className="text-[12.5px] italic text-muted-foreground">Unable to load summary.</p>
                  )}
                </div>
              )}
            </li>
          )
        })}
      </ul>
    </article>
  )
}

// ─── Skeletons ──────────────────────────────────────────────────────────

function SkeletonCard() {
  return (
    <div className="rounded-2xl border border-border/60 bg-card p-5 sm:p-6 first:sm:col-span-2">
      <div className="mb-4 h-3 w-28 animate-pulse rounded bg-muted/60" />
      <div className="space-y-2.5">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="flex items-start gap-2.5">
            <span className="mt-[7px] h-1 w-1 rounded-full bg-muted-foreground/30" />
            <div
              className="h-3.5 animate-pulse rounded bg-muted/60"
              style={{ width: `${85 - i * 8}%` }}
            />
          </div>
        ))}
      </div>
    </div>
  )
}

function SkeletonHeadlines() {
  return (
    <ul className="divide-y divide-border/60 border-y border-border/60">
      {[0, 1, 2, 3, 4].map((i) => (
        <li key={i} className="py-4">
          <div className="mb-2 h-2.5 w-24 animate-pulse rounded bg-muted/60" />
          <div className="h-4 w-11/12 animate-pulse rounded bg-muted/60" style={{ width: `${90 - i * 6}%` }} />
        </li>
      ))}
    </ul>
  )
}

// ─── Saved drawer ───────────────────────────────────────────────────────

function SavedDrawer({
  items,
  onClose,
  onOpenItem,
  onRemove,
}: {
  items: SavedHeadline[]
  onClose: () => void
  onOpenItem: (item: SavedHeadline) => void
  onRemove: (item: SavedHeadline) => void
}) {
  return (
    <div className="fixed inset-0 z-50 bg-foreground/30 backdrop-blur-sm" onClick={onClose}>
      <div
        className="absolute bottom-0 left-0 right-0 max-h-[70vh] overflow-y-auto rounded-t-2xl border-t border-border bg-card shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mx-auto max-w-3xl px-5 py-5 sm:px-8">
          <div className="mb-4 flex items-center justify-between">
            <div>
              <h2 className="font-serif text-[20px] font-semibold text-foreground">Saved for later</h2>
              <p className="mt-0.5 text-[12px] text-muted-foreground">
                {items.length} {items.length === 1 ? 'article' : 'articles'} · ephemeral, cleared on reload
              </p>
            </div>
            <button
              onClick={onClose}
              className="rounded-full px-3 py-1 text-[12px] text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
            >
              Close
            </button>
          </div>

          {items.length === 0 ? (
            <div className="py-10 text-center text-[13px] text-muted-foreground">
              Nothing saved yet. Open any headline and tap Save for later.
            </div>
          ) : (
            <ul className="divide-y divide-border/60">
              {items.map((item) => (
                <li key={item.id} className="flex items-start justify-between gap-4 py-3">
                  <button
                    onClick={() => onOpenItem(item)}
                    className="flex-1 min-w-0 text-left"
                  >
                    <div className="mb-0.5 text-[10.5px] uppercase tracking-[0.14em] text-primary">
                      {item.source}
                    </div>
                    <div className="font-serif text-[14px] leading-snug text-foreground">{item.title}</div>
                  </button>
                  <button
                    onClick={() => onRemove(item)}
                    className="shrink-0 text-[11.5px] text-muted-foreground transition-colors hover:text-destructive"
                  >
                    Remove
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  )
}

// ─── Headline modal ─────────────────────────────────────────────────────

function HeadlineModal({
  headline,
  isSaved,
  onClose,
  onToggleSave,
}: {
  headline: EnrichedHeadline
  isSaved: boolean
  onClose: () => void
  onToggleSave: () => void
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/30 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="w-full max-w-xl overflow-hidden rounded-2xl border border-border bg-card shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-6 sm:p-7">
          <div className="mb-3 flex items-start justify-between">
            <div className="flex items-center gap-2 text-[10.5px] uppercase tracking-[0.14em]">
              <span className="font-semibold text-primary">{headline.source}</span>
              <span className="h-[3px] w-[3px] rounded-full bg-muted-foreground/40" />
              <span className="text-muted-foreground">{headline.publishedAt}</span>
            </div>
            <button
              onClick={onClose}
              className="-mr-1 -mt-1 rounded-full px-2 py-0.5 text-[11.5px] text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
            >
              Close
            </button>
          </div>

          <h2 className="font-serif text-[22px] font-semibold leading-tight text-foreground">
            {headline.title}
          </h2>

          {headline.contextLine && (
            <p className="mt-4 border-l-2 border-primary/40 pl-3 text-[14px] leading-relaxed text-foreground">
              {headline.contextLine}
            </p>
          )}

          {headline.shortSummary && headline.shortSummary !== headline.contextLine && (
            <p className="mt-4 text-[13px] leading-relaxed text-muted-foreground">
              {headline.shortSummary}
            </p>
          )}

          <div className="mt-7 flex items-center justify-between border-t border-border pt-4">
            <button
              onClick={onToggleSave}
              className="text-[12px] font-medium text-muted-foreground transition-colors hover:text-foreground"
            >
              {isSaved ? '✓ Saved' : 'Save for later'}
            </button>
            <a
              href={headline.link}
              target="_blank"
              rel="noopener noreferrer"
              className="rounded-full bg-primary px-4 py-1.5 text-[12px] font-semibold text-primary-foreground transition-opacity hover:opacity-90"
            >
              Read full article →
            </a>
          </div>
        </div>
      </div>
    </div>
  )
}
