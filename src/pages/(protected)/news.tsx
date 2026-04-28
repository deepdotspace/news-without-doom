/**
 * News Without Doom — calm news brief.
 *
 * Pipeline:
 *   1. Hydrate from localStorage. Fresh (< 1h) entries render instantly,
 *      without touching the network.
 *   2. Otherwise fetch RSS via /api/rss (server-side, edge-cached, no CORS).
 *   3. Render the headlines list as soon as feeds parse.
 *   4. Run LLM enrichment + brief generation IN PARALLEL — neither blocks
 *      the other.
 *   5. Persist the result back to localStorage so reloads + recent-topic
 *      switches stay instant.
 *
 * Visual layer:
 *   - Per-topic accent color via inline `--color-primary` overrides on the
 *     wrapper (every existing token-driven accent auto-recolors).
 *   - Asymmetric 3-column brief grid: hero card (3 cols) → 2/1 split → 1/2
 *     split, with the featured card getting bigger type and padding.
 *   - Framer Motion: stagger fade-up on cards, AnimatePresence fade-through
 *     on topic transitions, soft hover lift, smooth modal/drawer.
 *
 * Auth-gated by virtue of living under (protected)/.
 */

import React, { useEffect, useMemo, useRef, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  TOPICS,
  FILTER_OPTIONS,
  fetchTopicFeeds,
  deduplicateItems,
  selectHeadlines,
  computeHeadlineSetHash,
  processHeadlineItemsWithLLM,
  applyRelevanceFilter,
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
import { getTopicTheme, topicCssVars } from '../../lib/topic-colors'
import NewsHeader from '../../components/NewsHeader'

// Soft ease-out — feels gentle, not snappy. All durations skew long-ish
// (0.4–0.6s) so the page never feels frantic.
const SOFT_EASE = [0.16, 1, 0.3, 1] as const

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
  const [negativityFilter, setNegativityFilter] = useState<string>('Less doom')

  const [items, setItems] = useState<EnrichedHeadline[]>([])
  const [brief, setBrief] = useState<TopicBrief>(EMPTY_BRIEF('Tech'))
  const [fetchedAt, setFetchedAt] = useState<number | null>(null)

  const [updating, setUpdating] = useState(false)
  const [briefLoading, setBriefLoading] = useState(false)
  const [forceRefreshNonce, setForceRefreshNonce] = useState(0)

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

  useEffect(() => {
    setExpandedBulletId(null)
    Object.values(summaryAbortRef.current).forEach((c) => c.abort())
    summaryAbortRef.current = {}
  }, [selectedTopic])

  // ─── Handlers ─────────────────────────────────────────────────────────
  const handleRefresh = () => {
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
    }, 200)
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

  const theme = getTopicTheme(selectedTopic)

  // ─── Render ───────────────────────────────────────────────────────────
  return (
    <div
      className="flex h-full flex-col bg-background transition-colors"
      style={topicCssVars(theme)}
    >
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
        <main className="mx-auto w-full max-w-5xl px-5 pt-12 pb-24 sm:px-8">
          <AnimatePresence mode="wait">
            <motion.div
              key={selectedTopic}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.5, ease: SOFT_EASE }}
            >
              {/* Date strap */}
              <div className="mb-3 flex items-center gap-2 text-[10.5px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
                <span>{today.toUpperCase()}</span>
                {ageLabel && (
                  <>
                    <span className="h-[3px] w-[3px] rounded-full bg-muted-foreground/40" />
                    <span className="text-[11px] font-normal normal-case tracking-normal">
                      Updated {ageLabel}
                    </span>
                  </>
                )}
              </div>

              {/* Hero takeaway */}
              <Hero topic={selectedTopic} brief={brief} loading={briefLoading} />

              {/* Asymmetric brief grid */}
              <BriefGrid
                brief={brief}
                briefLoading={briefLoading}
                expandedBulletId={expandedBulletId}
                loadingSummary={loadingSummary}
                bulletSummaries={bulletSummaries}
                onReadMoreToggle={handleReadMoreToggle}
              />

              {/* Top headlines */}
              <Headlines
                headlines={headlines}
                onOpenItem={setSelectedHeadline}
              />
            </motion.div>
          </AnimatePresence>
        </main>
      </div>

      <AnimatePresence>
        {savedDrawerOpen && (
          <SavedDrawer
            items={sortedSavedItems}
            onClose={() => setSavedDrawerOpen(false)}
            onOpenItem={(item) => setSelectedHeadline(item)}
            onRemove={handleSave}
          />
        )}
      </AnimatePresence>
      <AnimatePresence>
        {selectedHeadline && (
          <HeadlineModal
            key={selectedHeadline.id}
            headline={selectedHeadline}
            isSaved={isSaved(selectedHeadline.id)}
            onClose={() => setSelectedHeadline(null)}
            onToggleSave={() => handleSave(selectedHeadline)}
          />
        )}
      </AnimatePresence>
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

    const filtered = selectHeadlines(sorted as any, topic, filter).slice(0, 10) as RawHeadline[]

    const [enrichedRaw, brief] = await Promise.all([
      processHeadlineItemsWithLLM(filtered, topic, signal),
      generateTopicBrief(filtered as unknown as EnrichedHeadline[], topic, signal),
    ])
    if (!isCurrent()) return

    // Drop items the LLM judged off-topic (e.g. a film article in
    // Science from The Verge's all-content feed). Backstops to the
    // unfiltered set if too few items remain.
    const enriched = applyRelevanceFilter(enrichedRaw)

    onEnriched(enriched)
    onBrief(brief)

    onComplete({ brief, items: enriched, fetchedAt: Date.now() })
  } catch (err: any) {
    if (err?.name === 'AbortError') return
    console.error('[news-pipeline] failed:', err)
    onError()
  }
}

// ─── Hero takeaway ───────────────────────────────────────────────────────

function Hero({ topic, brief, loading }: { topic: string; brief: TopicBrief; loading: boolean }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.55, ease: SOFT_EASE, delay: 0.05 }}
    >
      <div className="mb-3 flex items-center gap-2.5">
        <motion.span
          layoutId="hero-accent-bar"
          className="block h-[2px] w-8 rounded-full"
          style={{ backgroundColor: 'var(--color-primary)' }}
          transition={{ duration: 0.6, ease: SOFT_EASE }}
        />
        <span
          className="text-[10.5px] font-medium uppercase tracking-[0.22em]"
          style={{ color: 'var(--color-primary)' }}
        >
          {brief.themeLabel || topic}
        </span>
      </div>
      {loading && !brief.takeaway ? (
        <div className="space-y-2">
          <div className="h-8 w-11/12 animate-pulse rounded bg-muted/60" />
          <div className="h-8 w-9/12 animate-pulse rounded bg-muted/60" />
        </div>
      ) : (
        <h1 className="font-serif text-[30px] leading-tight text-foreground sm:text-[40px]">
          {brief.takeaway || `A calm read on ${topic.toLowerCase()}.`}
        </h1>
      )}
    </motion.div>
  )
}

// ─── Brief grid (asymmetric) ─────────────────────────────────────────────

function BriefGrid({
  brief,
  briefLoading,
  expandedBulletId,
  loadingSummary,
  bulletSummaries,
  onReadMoreToggle,
}: {
  brief: TopicBrief
  briefLoading: boolean
  expandedBulletId: string | null
  loadingSummary: string | null
  bulletSummaries: Record<string, string>
  onReadMoreToggle: (bulletId: string, articles: EnrichedHeadline[], event: React.MouseEvent) => void
}) {
  // Asymmetric layout — desktop 3-col grid:
  //   Row 1: 01 What's happening    [span 3]   ← featured, bigger
  //   Row 2: 02 Key players [span 2] · 03 What to watch [span 1]
  //   Row 3: 04 Why it matters [span 1] · 05 Viewpoints [span 2]
  // Mobile: each card stacks naturally to span 1.

  const sections: Array<{
    index: string
    title: string
    bullets: { id: string; text: string }[]
    span: 'full' | 'wide' | 'narrow'
    featured?: boolean
  }> = [
    { index: '01', title: "What's happening", bullets: brief.nowBullets, span: 'full', featured: true },
    { index: '02', title: 'Key players', bullets: brief.stakeholdersBullets, span: 'wide' },
    { index: '03', title: 'What to watch', bullets: brief.watchNextBullets, span: 'narrow' },
    { index: '04', title: 'Why it matters', bullets: brief.whyItMattersBullets, span: 'narrow' },
    { index: '05', title: 'Viewpoints', bullets: brief.viewpointsBullets, span: 'wide' },
  ]

  if (briefLoading && brief.nowBullets.length === 0) {
    return (
      <section className="mt-10 grid grid-cols-1 gap-5 sm:grid-cols-3">
        <SkeletonCard span="full" featured />
        <SkeletonCard span="wide" />
        <SkeletonCard span="narrow" />
        <SkeletonCard span="narrow" />
        <SkeletonCard span="wide" />
      </section>
    )
  }

  return (
    <motion.section
      className="mt-10 grid grid-cols-1 gap-5 sm:grid-cols-3"
      initial="hidden"
      animate="visible"
      variants={{
        hidden: { opacity: 0 },
        visible: {
          opacity: 1,
          transition: {
            staggerChildren: 0.08,
            delayChildren: 0.1,
          },
        },
      }}
    >
      {sections.map((section) => (
        <BriefSection
          key={section.index}
          {...section}
          bulletArticleMap={brief.bulletArticleMap}
          expandedBulletId={expandedBulletId}
          loadingSummary={loadingSummary}
          bulletSummaries={bulletSummaries}
          onReadMoreToggle={onReadMoreToggle}
        />
      ))}
    </motion.section>
  )
}

// ─── Brief section card ──────────────────────────────────────────────────

const SPAN_CLASS: Record<'full' | 'wide' | 'narrow', string> = {
  full: 'sm:col-span-3',
  wide: 'sm:col-span-2',
  narrow: 'sm:col-span-1',
}

interface BriefSectionProps {
  index: string
  title: string
  bullets: { id: string; text: string }[]
  bulletArticleMap: Record<string, EnrichedHeadline[]>
  expandedBulletId: string | null
  loadingSummary: string | null
  bulletSummaries: Record<string, string>
  onReadMoreToggle: (bulletId: string, articles: EnrichedHeadline[], event: React.MouseEvent) => void
  span: 'full' | 'wide' | 'narrow'
  featured?: boolean
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
  span,
  featured,
}: BriefSectionProps) {
  if (!bullets || bullets.length === 0) return null

  return (
    <motion.article
      variants={{
        hidden: { opacity: 0, y: 16 },
        visible: { opacity: 1, y: 0, transition: { duration: 0.55, ease: SOFT_EASE } },
      }}
      whileHover={{ y: -2, boxShadow: '0 6px 24px rgba(26, 22, 20, 0.08)' }}
      transition={{ duration: 0.35, ease: SOFT_EASE }}
      className={`rounded-2xl border border-border/60 bg-card ${
        featured ? 'p-7 sm:p-8' : 'p-5 sm:p-6'
      } ${SPAN_CLASS[span]}`}
    >
      <header className="mb-4 flex items-baseline gap-3">
        <span className="font-serif text-[12px] font-medium tabular-nums italic text-muted-foreground/70">
          {index}
        </span>
        <h4
          className={`uppercase tracking-[0.18em] text-foreground ${
            featured ? 'text-[12px] font-semibold' : 'text-[10.5px] font-medium'
          }`}
        >
          {title}
        </h4>
      </header>
      <ul className={featured ? 'space-y-4' : 'space-y-3'}>
        {bullets.map((bullet) => {
          const articles = bulletArticleMap?.[bullet.id]
          const isExpanded = expandedBulletId === bullet.id
          const cacheKey = articles ? articles.map((a) => a.link).sort().join('::') : null
          const cachedSummary = cacheKey ? bulletSummaries[cacheKey] : null

          return (
            <li key={bullet.id || bullet.text} className={featured ? 'text-[15px] leading-relaxed' : 'text-[13.5px] leading-relaxed'}>
              <div className="flex items-start gap-3">
                <span
                  className={`shrink-0 rounded-full ${featured ? 'mt-[9px] h-[5px] w-[5px]' : 'mt-[7px] h-1 w-1'}`}
                  style={{ backgroundColor: 'var(--color-primary)' }}
                />
                <div className="min-w-0 flex-1">
                  <span className="text-foreground">{bullet.text}</span>
                  {articles && articles.length > 0 && (
                    <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[11px]">
                      {articles.map((article) => (
                        <a
                          key={article.id}
                          href={article.link}
                          target="_blank"
                          rel="noopener noreferrer"
                          title={article.title}
                          className="rounded-full border border-border bg-secondary/60 px-2 py-0.5 font-medium text-muted-foreground transition-all hover:border-[color:var(--color-primary-border)] hover:text-[color:var(--color-primary)]"
                          style={{
                            transitionTimingFunction: 'cubic-bezier(0.16, 1, 0.3, 1)',
                            transitionDuration: '300ms',
                          }}
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

              <AnimatePresence>
                {isExpanded && articles && articles.length > 0 && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: 'auto' }}
                    exit={{ opacity: 0, height: 0 }}
                    transition={{ duration: 0.4, ease: SOFT_EASE }}
                    className="overflow-hidden"
                  >
                    <div
                      className="ml-4 mt-3 border-l-2 pl-3"
                      style={{ borderColor: 'var(--color-primary-border)' }}
                    >
                      {loadingSummary === bullet.id ? (
                        <div className="flex items-center gap-2 py-1 text-[12px] text-muted-foreground">
                          <span
                            className="h-3 w-3 animate-spin rounded-full border-2 border-t-transparent"
                            style={{ borderColor: 'var(--color-primary-border)', borderTopColor: 'transparent' }}
                          />
                          Generating summary…
                        </div>
                      ) : cachedSummary ? (
                        <p className="text-[12.5px] leading-relaxed text-muted-foreground">{cachedSummary}</p>
                      ) : (
                        <p className="text-[12.5px] italic text-muted-foreground">Unable to load summary.</p>
                      )}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </li>
          )
        })}
      </ul>
    </motion.article>
  )
}

// ─── Headlines list ──────────────────────────────────────────────────────

function Headlines({
  headlines,
  onOpenItem,
}: {
  headlines: EnrichedHeadline[]
  onOpenItem: (item: EnrichedHeadline) => void
}) {
  return (
    <motion.section
      className="mt-14"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.5, ease: SOFT_EASE, delay: 0.4 }}
    >
      <h3 className="mb-4 text-[10.5px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
        Top headlines
      </h3>
      {headlines.length === 0 ? (
        <SkeletonHeadlines />
      ) : (
        <ul className="divide-y divide-border/60 border-y border-border/60">
          {headlines.map((headline, i) => (
            <motion.li
              key={headline.id}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.45, ease: SOFT_EASE, delay: 0.45 + i * 0.04 }}
              onClick={() => onOpenItem(headline)}
              whileHover={{ x: 4 }}
              className="group cursor-pointer py-4 transition-colors hover:bg-secondary/30"
            >
              <div className="mb-1 flex items-center gap-2 text-[10.5px] uppercase tracking-[0.14em]">
                <span className="font-semibold" style={{ color: 'var(--color-primary)' }}>
                  {headline.source}
                </span>
                <span className="h-[3px] w-[3px] rounded-full bg-muted-foreground/40" />
                <span className="text-muted-foreground">{headline.publishedAt}</span>
              </div>
              <p
                className="font-serif text-[16px] leading-snug text-foreground transition-colors"
                style={{ color: undefined }}
              >
                {headline.title}
              </p>
              {headline.contextLine && (
                <p className="mt-1 line-clamp-2 text-[13px] leading-relaxed text-muted-foreground">
                  {headline.contextLine}
                </p>
              )}
            </motion.li>
          ))}
        </ul>
      )}
    </motion.section>
  )
}

// ─── Skeletons ──────────────────────────────────────────────────────────

function SkeletonCard({
  span,
  featured,
}: {
  span: 'full' | 'wide' | 'narrow'
  featured?: boolean
}) {
  return (
    <div
      className={`rounded-2xl border border-border/60 bg-card ${
        featured ? 'p-7 sm:p-8' : 'p-5 sm:p-6'
      } ${SPAN_CLASS[span]}`}
    >
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
          <div className="h-4 animate-pulse rounded bg-muted/60" style={{ width: `${90 - i * 6}%` }} />
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
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.4, ease: SOFT_EASE }}
      className="fixed inset-0 z-50 bg-foreground/30 backdrop-blur-sm"
      onClick={onClose}
    >
      <motion.div
        initial={{ y: '100%' }}
        animate={{ y: 0 }}
        exit={{ y: '100%' }}
        transition={{ duration: 0.5, ease: SOFT_EASE }}
        className="absolute bottom-0 left-0 right-0 max-h-[70vh] overflow-y-auto rounded-t-3xl border-t border-border bg-card shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mx-auto max-w-3xl px-5 py-6 sm:px-8">
          <div className="mb-5 flex items-center justify-between">
            <div>
              <h2 className="font-serif text-[22px] font-semibold text-foreground">Saved for later</h2>
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
                  <button onClick={() => onOpenItem(item)} className="flex-1 min-w-0 text-left">
                    <div
                      className="mb-0.5 text-[10.5px] uppercase tracking-[0.14em]"
                      style={{ color: 'var(--color-primary)' }}
                    >
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
      </motion.div>
    </motion.div>
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
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.35, ease: SOFT_EASE }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/30 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.96, y: 8 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.97, y: 6 }}
        transition={{ duration: 0.4, ease: SOFT_EASE }}
        className="w-full max-w-xl overflow-hidden rounded-2xl border border-border bg-card shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-6 sm:p-7">
          <div className="mb-3 flex items-start justify-between">
            <div className="flex items-center gap-2 text-[10.5px] uppercase tracking-[0.14em]">
              <span className="font-semibold" style={{ color: 'var(--color-primary)' }}>
                {headline.source}
              </span>
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
            <p
              className="mt-4 border-l-2 pl-3 text-[14px] leading-relaxed text-foreground"
              style={{ borderColor: 'var(--color-primary)' }}
            >
              {headline.contextLine}
            </p>
          )}

          {headline.shortSummary && headline.shortSummary !== headline.contextLine && (
            <p className="mt-4 text-[13px] leading-relaxed text-muted-foreground">{headline.shortSummary}</p>
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
              className="rounded-full px-4 py-1.5 text-[12px] font-semibold text-primary-foreground transition-opacity hover:opacity-90"
              style={{ backgroundColor: 'var(--color-primary)' }}
            >
              Read full article →
            </a>
          </div>
        </div>
      </motion.div>
    </motion.div>
  )
}
