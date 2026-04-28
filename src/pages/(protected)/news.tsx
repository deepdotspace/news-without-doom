/**
 * News Without Doom — calm news brief.
 *
 * Ported from the old widget's HomePage.tsx. Same UX: topic tabs, negativity
 * filter, AI-summarised brief, top headlines, save-for-later drawer, headline
 * detail modal. RSS fetched client-side (with allorigins.win CORS fallback);
 * LLM calls go through `integration.post('openai/chat-completion', …)`.
 *
 * Auth-gated by virtue of living under (protected)/. The new SDK requires
 * auth for `integration.post()` to avoid leaking the owner's billing.
 */

import React, { useState, useEffect, useMemo, useRef } from 'react'
import {
  TOPICS,
  FILTER_OPTIONS,
  fetchTopicFeeds,
  deduplicateItems,
  selectHeadlines,
  computeHeadlineSetHash,
  get24hWindowId,
  processHeadlineItemsWithLLM,
  generateTopicBrief,
  generateDetailedSummary,
  type EnrichedHeadline,
  type RawHeadline,
  type TopicBrief,
  type SavedHeadline,
} from '../../lib/news'

const EMPTY_BRIEF = (topic: string): TopicBrief => ({
  themeLabel: topic, takeaway: '', nowBullets: [], stakeholdersBullets: [],
  watchNextBullets: [], whyItMattersBullets: [], viewpointsBullets: [], bulletArticleMap: {},
})

interface CachedContext {
  brief: TopicBrief
  hash: string
  generatedAt: string
  windowId: string
}

export default function NewsPage() {
  const [selectedTopic, setSelectedTopic] = useState<string>('Tech')
  const [negativityFilter, setNegativityFilter] = useState<string>('Light')
  const [itemsByTopic, setItemsByTopic] = useState<Record<string, EnrichedHeadline[]>>({})
  const [contextCache, setContextCache] = useState<Record<string, CachedContext>>({})
  const [itemsCurrent, setItemsCurrent] = useState<EnrichedHeadline[]>([])
  const [topicBrief, setTopicBrief] = useState<TopicBrief>(EMPTY_BRIEF('Tech'))
  const [savedItems, setSavedItems] = useState<SavedHeadline[]>([])
  const [updating, setUpdating] = useState(false)
  const [generatingBrief, setGeneratingBrief] = useState(false)
  const [lastRefresh, setLastRefresh] = useState(new Date().toISOString())
  const [selectedHeadline, setSelectedHeadline] = useState<EnrichedHeadline | null>(null)
  const [savedDrawerOpen, setSavedDrawerOpen] = useState(false)
  const [headlinesExpanded, setHeadlinesExpanded] = useState(true)
  const [expandedBulletId, setExpandedBulletId] = useState<string | null>(null)
  const [bulletSummaries, setBulletSummaries] = useState<Record<string, string>>({})
  const [loadingSummary, setLoadingSummary] = useState<string | null>(null)

  const abortControllerRef = useRef<AbortController | null>(null)
  const requestIdRef = useRef(0)
  const topicDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const summaryAbortRef = useRef<Record<string, AbortController>>({})

  // ─── Pipeline: fetch → dedupe → sort → enrich → brief ──────────────────
  useEffect(() => {
    const runPipeline = async () => {
      if (abortControllerRef.current) abortControllerRef.current.abort()
      abortControllerRef.current = new AbortController()
      const signal = abortControllerRef.current.signal
      const currentRequestId = ++requestIdRef.current

      const windowId = get24hWindowId()
      const cacheKey = `brief:${selectedTopic}:${windowId}`
      const cachedContext = contextCache[cacheKey]
      const cachedItems = itemsByTopic[selectedTopic]

      if (cachedContext?.brief) {
        setTopicBrief(cachedContext.brief)
        if (cachedItems && cachedItems.length > 0) {
          const filtered = selectHeadlines(cachedItems, selectedTopic, negativityFilter)
          setItemsCurrent(filtered.slice(0, 10))
        }
      } else {
        setItemsCurrent([])
        setTopicBrief({ ...EMPTY_BRIEF(selectedTopic), takeaway: 'Loading...' })
      }

      setUpdating(true)

      try {
        const result = await fetchTopicFeeds(selectedTopic, signal)
        if (currentRequestId !== requestIdRef.current) return

        const items = result.items
        if (items.length === 0) {
          setItemsByTopic((prev) => ({ ...prev, [selectedTopic]: [] }))
          setItemsCurrent([])
          setTopicBrief({ ...EMPTY_BRIEF(selectedTopic), takeaway: 'No recent headlines found' })
          setUpdating(false)
          return
        }

        const dedup = deduplicateItems(items as RawHeadline[])
        const sortedAll = [...dedup].sort((a, b) => {
          if (b.timestamp !== a.timestamp) return b.timestamp - a.timestamp
          if (a.source !== b.source) return a.source.localeCompare(b.source)
          return a.title.localeCompare(b.title)
        })

        const filtered = selectHeadlines(sortedAll as any, selectedTopic, negativityFilter) as RawHeadline[]
        const displayedItems = filtered.slice(0, 10)

        const enrichedDisplayed = await processHeadlineItemsWithLLM(displayedItems, signal)
        if (currentRequestId !== requestIdRef.current) return

        const currentHash = computeHeadlineSetHash(enrichedDisplayed)
        const needsRegeneration = !cachedContext || cachedContext.hash !== currentHash

        let brief: TopicBrief
        if (needsRegeneration) {
          setGeneratingBrief(true)
          brief = await generateTopicBrief(enrichedDisplayed, selectedTopic, signal)
          if (currentRequestId !== requestIdRef.current) return
          setContextCache((prev) => ({
            ...prev,
            [cacheKey]: { brief, hash: currentHash, generatedAt: new Date().toISOString(), windowId },
          }))
        } else {
          brief = cachedContext.brief
        }

        const enrichedMap = new Map(enrichedDisplayed.map((item) => [item.id, item]))
        const finalAll: EnrichedHeadline[] = sortedAll.map(
          (item) => enrichedMap.get(item.id) ?? ({ ...item, contextLine: '', shortSummary: '', negativity: 'medium' } as EnrichedHeadline),
        )

        if (currentRequestId === requestIdRef.current) {
          setItemsByTopic((prev) => ({ ...prev, [selectedTopic]: finalAll }))
          setItemsCurrent(enrichedDisplayed)
          setTopicBrief(brief)
        }
      } catch (error: any) {
        if (error?.name === 'AbortError') return
        console.error('Fetch error:', error)
        if (currentRequestId === requestIdRef.current) setItemsCurrent([])
      } finally {
        if (currentRequestId === requestIdRef.current) {
          setUpdating(false)
          setGeneratingBrief(false)
        }
      }
    }

    runPipeline()
    return () => { abortControllerRef.current?.abort() }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedTopic, lastRefresh, negativityFilter])

  // Reset bullet expand state on topic change.
  useEffect(() => {
    setExpandedBulletId(null)
    Object.values(summaryAbortRef.current).forEach((c) => c.abort())
    summaryAbortRef.current = {}
  }, [selectedTopic])

  const headlines = useMemo(() => (itemsCurrent ?? []).slice(0, 10), [itemsCurrent])
  const sortedSavedItems = useMemo(
    () => [...savedItems].sort((a, b) => (b.savedAt ?? 0) - (a.savedAt ?? 0)),
    [savedItems],
  )

  const handleSave = (headline: EnrichedHeadline) => {
    setSavedItems((prev) => {
      const exists = prev.find((h) => h.id === headline.id)
      if (exists) return prev.filter((h) => h.id !== headline.id)
      return [...prev, { ...headline, savedAt: Date.now() }]
    })
  }

  const isSaved = (headlineId: string) => savedItems.some((h) => h.id === headlineId)

  const fetchBulletSummary = async (articles: EnrichedHeadline[], bulletId: string) => {
    const cacheKey = articles.map((a) => a.link).sort().join('::')
    if (bulletSummaries[cacheKey]) return bulletSummaries[cacheKey]

    summaryAbortRef.current[bulletId]?.abort()
    const controller = new AbortController()
    summaryAbortRef.current[bulletId] = controller

    try {
      setLoadingSummary(bulletId)
      const summary = await generateDetailedSummary(articles, controller.signal)
      setBulletSummaries((prev) => ({ ...prev, [cacheKey]: summary }))
      return summary
    } catch (error: any) {
      if (error?.name === 'AbortError') return null
      return 'Unable to generate summary at this time.'
    } finally {
      setLoadingSummary(null)
      delete summaryAbortRef.current[bulletId]
    }
  }

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
    if (!bulletSummaries[cacheKey]) await fetchBulletSummary(articles, bulletId)
    setTimeout(() => {
      const element = (event?.target as HTMLElement)?.closest('li')
      if (element) element.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
    }, 150)
  }

  const selectTopic = (topic: string) => {
    if (topicDebounceRef.current) clearTimeout(topicDebounceRef.current)
    setSelectedTopic(topic)
    topicDebounceRef.current = setTimeout(() => {
      setLastRefresh(new Date().toISOString())
    }, 300)
  }

  const handleRefresh = () => setLastRefresh(new Date().toISOString())

  const brief = topicBrief.themeLabel ? topicBrief : EMPTY_BRIEF(selectedTopic)

  return (
    <div className="w-full h-full overflow-y-auto bg-background">
      {/* Sticky toolbar */}
      <div className="sticky top-0 z-30 bg-background/95 backdrop-blur-sm border-b border-border px-4 py-2">
        <div className="max-w-3xl mx-auto flex items-center gap-2">
          <span className="text-xs font-bold text-foreground whitespace-nowrap shrink-0">News Without Doom</span>
          <div className="w-px h-3.5 bg-border shrink-0"></div>
          {TOPICS.map((topic) => (
            <button
              key={topic}
              onClick={() => selectTopic(topic)}
              className={`px-2 py-0.5 rounded text-xs font-medium transition-all shrink-0 ${
                selectedTopic === topic
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              {topic}
            </button>
          ))}
          <div className="flex-1"></div>
          {FILTER_OPTIONS.map((option) => (
            <button
              key={option}
              onClick={() => setNegativityFilter(option)}
              className={`px-2 py-0.5 rounded text-xs font-medium transition-all shrink-0 ${
                negativityFilter === option
                  ? 'bg-foreground text-background'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              {option}
            </button>
          ))}
          <div className="w-px h-3.5 bg-border shrink-0"></div>
          {updating && <div className="w-3 h-3 border-2 border-primary border-t-transparent rounded-full animate-spin shrink-0"></div>}
          <button onClick={handleRefresh} className="text-xs text-primary hover:text-primary/80 font-medium shrink-0">Refresh</button>
          <button
            onClick={() => setSavedDrawerOpen(!savedDrawerOpen)}
            className="text-xs text-muted-foreground hover:text-foreground font-medium shrink-0"
          >
            Saved{savedItems.length > 0 && ` (${savedItems.length})`}
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="max-w-3xl mx-auto px-4 py-4">
        {/* Brief */}
        {!brief.themeLabel || brief.nowBullets?.length === 0 ? (
          <div className="py-16 text-center">
            <div className="w-6 h-6 border-2 border-primary/40 border-t-primary rounded-full animate-spin mx-auto mb-3"></div>
            <p className="text-sm text-muted-foreground">Loading {selectedTopic} brief...</p>
            {generatingBrief && (
              <p className="text-xs text-muted-foreground/60 mt-1">Analyzing headlines from trusted sources</p>
            )}
          </div>
        ) : (
          <div className="space-y-3">
            {/* Hero takeaway */}
            {brief.takeaway && (
              <div className="bg-card rounded-lg border border-border p-4 shadow-card">
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-xs font-bold uppercase tracking-wider text-primary">
                    {brief.themeLabel || selectedTopic}
                  </span>
                  {generatingBrief && (
                    <div className="w-2.5 h-2.5 border-2 border-primary/40 border-t-transparent rounded-full animate-spin"></div>
                  )}
                </div>
                <p className="text-sm text-foreground leading-relaxed font-medium">{brief.takeaway}</p>
              </div>
            )}

            <BriefSection
              title="What's Happening Now"
              bullets={brief.nowBullets}
              bulletArticleMap={brief.bulletArticleMap}
              expandedBulletId={expandedBulletId}
              loadingSummary={loadingSummary}
              bulletSummaries={bulletSummaries}
              onReadMoreToggle={handleReadMoreToggle}
            />

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <BriefSection
                title="Key Players"
                bullets={brief.stakeholdersBullets}
                bulletArticleMap={brief.bulletArticleMap}
                expandedBulletId={expandedBulletId}
                loadingSummary={loadingSummary}
                bulletSummaries={bulletSummaries}
                onReadMoreToggle={handleReadMoreToggle}
              />
              <BriefSection
                title="What to Watch"
                bullets={brief.watchNextBullets}
                bulletArticleMap={brief.bulletArticleMap}
                expandedBulletId={expandedBulletId}
                loadingSummary={loadingSummary}
                bulletSummaries={bulletSummaries}
                onReadMoreToggle={handleReadMoreToggle}
              />
              <BriefSection
                title="Why It Matters"
                bullets={brief.whyItMattersBullets}
                bulletArticleMap={brief.bulletArticleMap}
                expandedBulletId={expandedBulletId}
                loadingSummary={loadingSummary}
                bulletSummaries={bulletSummaries}
                onReadMoreToggle={handleReadMoreToggle}
              />
              <BriefSection
                title="Viewpoints"
                bullets={brief.viewpointsBullets}
                bulletArticleMap={brief.bulletArticleMap}
                expandedBulletId={expandedBulletId}
                loadingSummary={loadingSummary}
                bulletSummaries={bulletSummaries}
                onReadMoreToggle={handleReadMoreToggle}
              />
            </div>
          </div>
        )}

        {/* Top Headlines */}
        {headlines.length > 0 && (
          <div className="mt-5">
            <button
              onClick={() => setHeadlinesExpanded(!headlinesExpanded)}
              className="flex items-center gap-2 mb-3 text-left"
            >
              <h3 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Top Headlines</h3>
              <svg
                className={`w-3 h-3 text-muted-foreground transition-transform ${headlinesExpanded ? 'rotate-180' : ''}`}
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M19 9l-7 7-7-7" />
              </svg>
            </button>

            {headlinesExpanded && (
              <div className="bg-card rounded-lg border border-border shadow-card divide-y divide-border/50">
                {headlines.slice(0, 5).map((headline) => (
                  <div
                    key={headline.id}
                    className="px-4 py-3 cursor-pointer group hover:bg-muted/30 transition-colors first:rounded-t-lg last:rounded-b-lg"
                    onClick={() => setSelectedHeadline(headline)}
                  >
                    <div className="flex items-baseline gap-2 mb-0.5">
                      <span className="text-xs font-bold uppercase tracking-wide text-muted-foreground shrink-0">
                        {headline.source}
                      </span>
                      <span className="text-xs text-muted-foreground/60">{headline.publishedAt}</span>
                    </div>
                    <p className="text-[13px] text-foreground leading-snug group-hover:text-primary transition-colors">
                      {headline.title}
                    </p>
                    {headline.contextLine && (
                      <p className="text-xs text-muted-foreground mt-0.5 line-clamp-1">{headline.contextLine}</p>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Saved Drawer */}
      {savedDrawerOpen && (
        <div className="fixed inset-0 bg-foreground/20 z-50 backdrop-blur-sm" onClick={() => setSavedDrawerOpen(false)}>
          <div
            className="fixed bottom-0 left-0 right-0 bg-card rounded-t-xl max-h-[60vh] overflow-y-auto shadow-2xl border-t border-border"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="max-w-3xl mx-auto p-4">
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-sm font-bold text-foreground">Saved for Later</h2>
                <button
                  onClick={() => setSavedDrawerOpen(false)}
                  className="text-xs text-muted-foreground hover:text-foreground"
                >
                  Close
                </button>
              </div>
              {sortedSavedItems.length === 0 ? (
                <p className="text-xs text-muted-foreground text-center py-6">No saved articles yet</p>
              ) : (
                <div className="space-y-1">
                  {sortedSavedItems.map((item) => (
                    <div
                      key={item.id}
                      className="flex items-start justify-between gap-2 py-2 border-b border-border/50 last:border-0"
                    >
                      <div className="flex-1 cursor-pointer min-w-0" onClick={() => setSelectedHeadline(item)}>
                        <span className="text-xs font-bold uppercase text-muted-foreground mr-2">{item.source}</span>
                        <span className="text-[13px] text-foreground">{item.title}</span>
                      </div>
                      <button
                        onClick={() => handleSave(item)}
                        className="text-xs text-muted-foreground hover:text-destructive shrink-0"
                      >
                        Remove
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Headline Modal */}
      {selectedHeadline && (
        <div
          className="fixed inset-0 bg-foreground/20 flex items-center justify-center z-50 p-4 backdrop-blur-sm"
          onClick={() => setSelectedHeadline(null)}
        >
          <div
            className="bg-card rounded-lg shadow-2xl w-full max-w-lg max-h-[75vh] overflow-y-auto border border-border"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="p-5">
              <div className="flex items-start justify-between mb-3">
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1.5">
                    <span className="text-xs font-bold uppercase text-muted-foreground">{selectedHeadline.source}</span>
                    <span className="text-xs text-muted-foreground/60">{selectedHeadline.publishedAt}</span>
                  </div>
                  <h2 className="text-base font-bold text-foreground leading-snug">{selectedHeadline.title}</h2>
                </div>
                <button
                  onClick={() => setSelectedHeadline(null)}
                  className="text-xs text-muted-foreground hover:text-foreground ml-3 shrink-0 mt-1"
                >
                  Close
                </button>
              </div>

              {selectedHeadline.contextLine && (
                <p className="text-[13px] text-foreground border-l-2 border-primary pl-3 mb-3 leading-relaxed">
                  {selectedHeadline.contextLine}
                </p>
              )}

              {selectedHeadline.shortSummary && (
                <p className="text-xs text-muted-foreground leading-relaxed mb-4">{selectedHeadline.shortSummary}</p>
              )}

              <div className="flex items-center justify-between pt-3 border-t border-border">
                <button
                  onClick={() => handleSave(selectedHeadline)}
                  className="text-xs text-muted-foreground hover:text-foreground font-medium"
                >
                  {isSaved(selectedHeadline.id) ? 'Saved' : 'Save for Later'}
                </button>
                <a
                  href={selectedHeadline.link}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="px-3 py-1.5 bg-primary hover:bg-primary/90 text-primary-foreground rounded text-xs font-semibold transition-colors"
                >
                  Read Full Article
                </a>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Brief section ───────────────────────────────────────────────────────

interface BriefSectionProps {
  title: string
  bullets: { id: string; text: string }[]
  bulletArticleMap: Record<string, EnrichedHeadline[]>
  expandedBulletId: string | null
  loadingSummary: string | null
  bulletSummaries: Record<string, string>
  onReadMoreToggle: (bulletId: string, articles: EnrichedHeadline[], event: React.MouseEvent) => void
}

function BriefSection({
  title,
  bullets,
  bulletArticleMap,
  expandedBulletId,
  loadingSummary,
  bulletSummaries,
  onReadMoreToggle,
}: BriefSectionProps) {
  if (!bullets || bullets.length === 0) return null
  return (
    <div className="bg-card rounded-lg border border-border p-4 shadow-card">
      <h4 className="text-xs font-bold uppercase tracking-wider text-primary mb-3">{title}</h4>
      <ul className="space-y-2.5">
        {bullets.map((bullet) => {
          const articles = bulletArticleMap?.[bullet.id]
          const isExpanded = expandedBulletId === bullet.id
          const cacheKey = articles ? articles.map((a) => a.link).sort().join('::') : null
          const cachedSummary = cacheKey ? bulletSummaries[cacheKey] : null

          return (
            <li key={bullet.id || bullet.text}>
              <div className="flex items-start gap-2.5">
                <div className="w-1.5 h-1.5 bg-primary/50 rounded-full mt-[6px] flex-shrink-0"></div>
                <div className="flex-1 min-w-0">
                  <span className="text-[13px] leading-relaxed text-foreground">{bullet.text}</span>
                  {articles && articles.length > 0 && (
                    <>
                      {articles.map((article) => (
                        <a
                          key={article.id}
                          href={article.link}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center ml-1.5 text-primary/60 hover:text-primary transition-colors"
                          title={article.title}
                        >
                          <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"
                            />
                          </svg>
                        </a>
                      ))}
                      <button
                        onClick={(e) => onReadMoreToggle(bullet.id, articles, e)}
                        className="inline-flex ml-1.5 text-xs text-muted-foreground hover:text-primary transition-colors"
                      >
                        {isExpanded ? '(less)' : '(more)'}
                      </button>
                    </>
                  )}
                </div>
              </div>

              {isExpanded && articles && articles.length > 0 && (
                <div className="accordion-panel ml-4 mt-2 mb-1 pl-3 border-l-2 border-primary/20">
                  {loadingSummary === bullet.id ? (
                    <div className="flex items-center gap-2 text-xs text-muted-foreground py-1">
                      <div className="w-3 h-3 border-2 border-primary/30 border-t-transparent rounded-full animate-spin"></div>
                      <span>Generating summary...</span>
                    </div>
                  ) : cachedSummary ? (
                    <p className="text-xs text-muted-foreground leading-relaxed">{cachedSummary}</p>
                  ) : (
                    <p className="text-xs text-muted-foreground italic">Unable to load summary</p>
                  )}
                </div>
              )}
            </li>
          )
        })}
      </ul>
    </div>
  )
}
