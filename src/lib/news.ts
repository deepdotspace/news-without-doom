/**
 * News pipeline — RSS fetching, LLM enrichment, brief generation.
 *
 * Ported from the old widget. The only substantial change vs. the old impl:
 * `mcapi.post('/generate-text', …)` is now
 * `integration.post('openai/chat-completion', { messages, model, … })`,
 * and we read `data.choices[0].message.content` instead of `data.text`.
 */

import { integration } from 'deepspace'

// ─── Types ───────────────────────────────────────────────────────────────

export interface RawHeadline {
  id: string
  title: string
  link: string
  source: string
  topic: string
  publishedAt: string
  publishedAtISO: string
  timestamp: number
  descriptionSnippet: string
  sourceName: string
  rssFeedUrlUsed: string
  fetchedAtISO: string
  itemUrl: string
  originalTitle: string
  originalDescriptionSnippet: string
}

export interface EnrichedHeadline extends RawHeadline {
  contextLine: string
  shortSummary: string
  negativity: 'low' | 'medium' | 'high'
  /**
   * Whether the LLM judged this item to genuinely fit the requested
   * topic. Used to filter off-topic noise from catch-all feeds (e.g.
   * The Verge's all-content feed leaks gaming / film / random into
   * the Science topic).
   *
   * Defaults to true on fallback so we never accidentally drop
   * everything when the LLM call is unavailable.
   */
  relevant: boolean
}

export interface BriefBullet {
  id: string
  text: string
}

export interface TopicBrief {
  themeLabel: string
  takeaway: string
  nowBullets: BriefBullet[]
  stakeholdersBullets: BriefBullet[]
  watchNextBullets: BriefBullet[]
  whyItMattersBullets: BriefBullet[]
  viewpointsBullets: BriefBullet[]
  bulletArticleMap: Record<string, EnrichedHeadline[]>
}

export interface SavedHeadline extends EnrichedHeadline {
  savedAt: number
}

// ─── Static config ───────────────────────────────────────────────────────

export const TOPICS = ['Tech', 'Business', 'Science', 'Markets', 'Sports', 'Local'] as const

/**
 * Tone filter labels:
 *   - "All"        → no filter, show everything
 *   - "Lighter"    → hide highly-negative items (medium + low pass)
 *   - "Calm only"  → only show items the LLM scored as low-negativity
 *
 * The filter is applied at DISPLAY TIME on enriched items, not in
 * `selectHeadlines`. This avoids accidentally filtering away every raw
 * pre-enrichment item (which has no `negativity` set yet) when the user
 * picks the strictest setting.
 */
export const FILTER_OPTIONS = ['All', 'Lighter', 'Calm only'] as const
export type FilterOption = (typeof FILTER_OPTIONS)[number]

/**
 * Trusted source set.
 *
 *   • Reuters: removed. They retired their public RSS in June 2020
 *     (every URL on `feeds.reuters.com` and `reutersagency.com/feed/...`
 *     returns DNS-fail or 404). Reuters Connect is paid-only.
 *   • AP: not added. They also dropped public RSS — apnews.com/hub/<x>/rss
 *     returns 404, feeds.apnews.com DNS-fails, apnews.com/index.rss is
 *     401. AP Newsroom is paid-only.
 *   • Bloomberg: added — they still ship working RSS at
 *     `feeds.bloomberg.com/<section>/news.rss` for technology, business,
 *     markets, economics, politics, and green. Fills the wire-agency
 *     slot Reuters used to occupy.
 */
export const LOCKED_SOURCES = [
  'BBC', 'Bloomberg', 'TechCrunch', 'The Verge', 'Wired', 'ESPN', 'CNN', 'CNBC',
] as const

/**
 * RSS feed URLs per (topic, source). `null` means that source doesn't
 * cover the topic and we skip it.
 *
 * The Verge no longer publishes per-section RSS feeds — every section
 * URL (`/tech/rss`, `/policy/rss`, `/science/rss`) returns 404. We use
 * their single all-content feed (`/rss/index.xml`) on every topic;
 * topical drift is filtered downstream by the LLM relevance pass.
 *
 * Wired retired the `/feed/tag/tech/latest/rss` URL but keeps `/feed/rss`
 * and the `category/<x>/latest/rss` paths working.
 *
 * Bloomberg has no Sports/Science feeds (it's a finance-first wire) and
 * no localized US-news feed; we leave those slots `null`.
 */
const RSS_FEEDS_BY_TOPIC: Record<string, Record<string, string | null>> = {
  Tech: {
    BBC: 'https://feeds.bbci.co.uk/news/technology/rss.xml',
    Bloomberg: 'https://feeds.bloomberg.com/technology/news.rss',
    TechCrunch: 'https://techcrunch.com/feed/',
    'The Verge': 'https://www.theverge.com/rss/index.xml',
    Wired: 'https://www.wired.com/feed/rss',
    ESPN: null,
    CNN: 'http://rss.cnn.com/rss/cnn_tech.rss',
    CNBC: 'https://www.cnbc.com/id/19854910/device/rss/rss.html',
  },
  Business: {
    BBC: 'https://feeds.bbci.co.uk/news/business/rss.xml',
    Bloomberg: 'https://feeds.bloomberg.com/business/news.rss',
    TechCrunch: 'https://techcrunch.com/category/startups/feed/',
    'The Verge': 'https://www.theverge.com/rss/index.xml',
    Wired: 'https://www.wired.com/feed/category/business/latest/rss',
    ESPN: null,
    CNN: 'http://rss.cnn.com/rss/money_latest.rss',
    CNBC: 'https://www.cnbc.com/id/10001147/device/rss/rss.html',
  },
  Markets: {
    BBC: 'https://feeds.bbci.co.uk/news/business/rss.xml',
    Bloomberg: 'https://feeds.bloomberg.com/markets/news.rss',
    TechCrunch: 'https://techcrunch.com/category/venture/feed/',
    'The Verge': null,
    Wired: null,
    ESPN: null,
    CNN: 'http://rss.cnn.com/rss/money_markets.rss',
    CNBC: 'https://www.cnbc.com/id/15839135/device/rss/rss.html',
  },
  Science: {
    BBC: 'https://feeds.bbci.co.uk/news/science_and_environment/rss.xml',
    // Bloomberg green is the closest analog to Science (climate,
    // environment) — keeps Bloomberg in the lineup for this topic.
    Bloomberg: 'https://feeds.bloomberg.com/green/news.rss',
    TechCrunch: null,
    'The Verge': 'https://www.theverge.com/rss/index.xml',
    Wired: 'https://www.wired.com/feed/category/science/latest/rss',
    ESPN: null,
    CNN: null,
    CNBC: null,
  },
  Sports: {
    BBC: 'https://feeds.bbci.co.uk/sport/rss.xml',
    Bloomberg: null,
    TechCrunch: null,
    'The Verge': null,
    Wired: null,
    ESPN: 'https://www.espn.com/espn/rss/news',
    CNN: 'http://rss.cnn.com/rss/edition_sport.rss',
    CNBC: null,
  },
  Local: {
    BBC: 'https://feeds.bbci.co.uk/news/england/rss.xml',
    // Bloomberg politics is US-centric — closest analog to Local for
    // a finance-first wire that has no city/region feeds.
    Bloomberg: 'https://feeds.bloomberg.com/politics/news.rss',
    TechCrunch: null,
    'The Verge': null,
    Wired: null,
    ESPN: null,
    CNN: 'http://rss.cnn.com/rss/cnn_us.rss',
    CNBC: 'https://www.cnbc.com/id/15837362/device/rss/rss.html',
  },
}

// ─── RSS parsing ─────────────────────────────────────────────────────────

const sanitizeSources = (_sources: unknown): string[] => [...LOCKED_SOURCES]

const getPublishedAtMs = (item: Element): number | null => {
  const fields = ['isoDate', 'pubDate', 'published', 'updated', 'dc:date', 'dcdate', 'date']
  for (const field of fields) {
    let dateString: string | null = null
    const element = item.querySelector(field)
    if (element) dateString = element.textContent?.trim() ?? null

    if (!dateString && field.includes(':')) {
      const variations = [field.replace(':', '\\:'), field.split(':')[1]]
      for (const v of variations) {
        const el = item.querySelector(v)
        if (el) {
          dateString = el.textContent?.trim() ?? null
          break
        }
      }
    }

    if (dateString) {
      const ts = new Date(dateString).getTime()
      if (!isNaN(ts) && ts > 0) {
        const now = Date.now()
        const twoYearsAgo = now - 2 * 365 * 24 * 60 * 60 * 1000
        const oneWeekFuture = now + 7 * 24 * 60 * 60 * 1000
        if (ts > twoYearsAgo && ts < oneWeekFuture) return ts
      }
    }
  }
  return null
}

const generateId = (source: string, title: string, timestamp: number): string => {
  const str = `${source}-${title}-${timestamp}`
  let hash = 0
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash) + str.charCodeAt(i)
    hash = hash & hash
  }
  return `rss-${Math.abs(hash)}`
}

const fetchText = async (
  url: string,
  signal: AbortSignal,
): Promise<{ success: true; text: string } | { success: false; error: string }> => {
  // Always go through the worker's /api/rss proxy. It handles CORS, runs
  // the upstream fetch from a Cloudflare data-center IP (which avoids most
  // anti-bot blocks), and serves a 10-minute edge cache so popular feeds
  // don't get re-fetched per user.
  const proxied = `/api/rss?url=${encodeURIComponent(url)}`
  try {
    const response = await fetch(proxied, { signal })
    if (response.ok) return { success: true, text: await response.text() }
    let detail = `HTTP ${response.status}`
    try {
      const body = (await response.json()) as { error?: string }
      if (body?.error) detail = body.error
    } catch {
      /* response wasn't JSON, keep the status */
    }
    return { success: false, error: detail }
  } catch (err: any) {
    if (err?.name === 'AbortError') throw err
    return { success: false, error: err?.message ?? 'rss proxy failed' }
  }
}

const parseRSSFeed = async (
  url: string,
  sourceName: string,
  topic: string,
  signal: AbortSignal,
): Promise<{ items: RawHeadline[]; error: string | null; url: string }> => {
  try {
    const fetchedAtISO = new Date().toISOString()
    const result = await fetchText(url, signal)
    if (!result.success) return { items: [], error: result.error, url }

    const parser = new DOMParser()
    const xml = parser.parseFromString(result.text, 'text/xml')
    if (xml.querySelector('parsererror')) return { items: [], error: 'XML parse error', url }

    const items = xml.querySelectorAll('item, entry')
    const parsed: RawHeadline[] = []
    const nowMs = Date.now()
    const cutoffMs = nowMs - 24 * 60 * 60 * 1000
    const futureBufferMs = nowMs + 5 * 60 * 1000

    for (let i = 0; i < Math.min(items.length, 50); i++) {
      const item = items[i]
      const title = item.querySelector('title')?.textContent?.trim()

      let link = item.querySelector('link')?.textContent?.trim() ?? undefined
      if (!link) link = item.querySelector('link[rel="alternate"]')?.getAttribute('href') ?? undefined
      if (!link) link = item.querySelector('link')?.getAttribute('href') ?? undefined

      if (!title || !link) continue

      const publishedAtMs = getPublishedAtMs(item)
      if (!publishedAtMs) continue

      const inWindow = publishedAtMs >= cutoffMs && publishedAtMs <= futureBufferMs
      if (!inWindow) continue

      let description =
        item.querySelector('description')?.textContent?.trim() ??
        item.querySelector('summary')?.textContent?.trim() ??
        item.querySelector('content')?.textContent?.trim() ??
        item.querySelector('content\\:encoded')?.textContent?.trim() ??
        ''

      const cleanDescription = description
        ? description.replace(/<[^>]*>/g, '').replace(/&[^;]+;/g, ' ').substring(0, 300).trim()
        : ''

      const diff = nowMs - publishedAtMs
      const hours = Math.floor(diff / (1000 * 60 * 60))
      const publishedAt =
        hours < 1 ? 'Just now'
        : hours < 24 ? `${hours} hour${hours === 1 ? '' : 's'} ago`
        : `${Math.floor(hours / 24)} day${Math.floor(hours / 24) === 1 ? '' : 's'} ago`

      parsed.push({
        id: generateId(sourceName, title, publishedAtMs),
        title,
        link,
        source: sourceName,
        topic,
        publishedAt,
        publishedAtISO: new Date(publishedAtMs).toISOString(),
        timestamp: publishedAtMs,
        descriptionSnippet: cleanDescription,
        sourceName,
        rssFeedUrlUsed: url,
        fetchedAtISO,
        itemUrl: link,
        originalTitle: title,
        originalDescriptionSnippet: cleanDescription,
      })
    }

    return { items: parsed, error: null, url }
  } catch (error: any) {
    if (error.name === 'AbortError') throw error
    return { items: [], error: error.message, url }
  }
}

export const fetchTopicFeeds = async (
  topic: string,
  signal: AbortSignal,
): Promise<{ items: RawHeadline[] }> => {
  const feedsForTopic = RSS_FEEDS_BY_TOPIC[topic] ?? {}
  const sources = sanitizeSources(null).filter(
    (s) => feedsForTopic[s] !== null && feedsForTopic[s] !== undefined,
  )

  const results = await Promise.allSettled(
    sources.map((sourceName) => {
      const feedUrl = feedsForTopic[sourceName]
      if (!feedUrl) return Promise.resolve({ items: [] as RawHeadline[], error: null, url: 'N/A' })
      return parseRSSFeed(feedUrl, sourceName, topic, signal)
    }),
  )

  const allItems: RawHeadline[] = []
  results.forEach((r) => {
    if (r.status === 'fulfilled' && r.value.items?.length > 0) allItems.push(...r.value.items)
  })
  return { items: allItems }
}

export const deduplicateItems = <T extends { id: string }>(items: T[]): T[] => {
  const seen = new Set<string>()
  return items.filter((item) => {
    if (seen.has(item.id)) return false
    seen.add(item.id)
    return true
  })
}

/** Max headlines per source in the displayed top-N. Without this, a
 *  high-frequency publisher (The Verge publishes ~hourly) drowns out
 *  lower-frequency but more topical sources like BBC Science. */
const PER_SOURCE_QUOTA = 3

export const selectHeadlines = <T extends { topic: string; source: string; timestamp: number; title: string }>(
  items: T[],
  topic: string,
): T[] => {
  let filtered = items.filter((i) => i.topic === topic)
  const sources = sanitizeSources(null)
  filtered = filtered.filter((i) => sources.includes(i.source))

  filtered.sort((a, b) => {
    if (a.timestamp !== b.timestamp) return b.timestamp - a.timestamp
    if (a.source !== b.source) return a.source.localeCompare(b.source)
    return a.title.localeCompare(b.title)
  })

  // Source diversity pass — walk the recency-sorted list, keep at most
  // PER_SOURCE_QUOTA items per source. Then append leftovers in case
  // some sources didn't have enough items, so we never drop below
  // what was available pre-quota.
  const counts: Record<string, number> = {}
  const primary: T[] = []
  const overflow: T[] = []
  for (const item of filtered) {
    const n = (counts[item.source] ?? 0) + 1
    counts[item.source] = n
    if (n <= PER_SOURCE_QUOTA) primary.push(item)
    else overflow.push(item)
  }
  return [...primary, ...overflow]
}

export const get24hWindowId = (): string => {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
}

export const computeHeadlineSetHash = (headlines: { source: string; title: string; link: string; timestamp: number }[]): string => {
  if (!headlines || headlines.length === 0) return 'empty'
  const sorted = [...headlines].sort((a, b) => {
    if (b.timestamp !== a.timestamp) return b.timestamp - a.timestamp
    return (a.link || '').localeCompare(b.link || '')
  })
  const input = sorted.map((h) => `${h.source}|${h.title}|${h.link}|${h.timestamp}`).join('::')
  let hash = 0
  for (let i = 0; i < input.length; i++) {
    hash = ((hash << 5) - hash) + input.charCodeAt(i)
    hash = hash & hash
  }
  return `hash-${Math.abs(hash)}`
}

// ─── LLM enrichment ──────────────────────────────────────────────────────

const callOpenAI = async (
  prompt: string,
  systemPrompt: string,
  options: { model?: string; maxTokens?: number; temperature?: number } = {},
): Promise<string | null> => {
  const result = await integration.post('openai/chat-completion', {
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: prompt },
    ],
    model: options.model ?? 'gpt-4o-mini',
    max_tokens: options.maxTokens ?? 2000,
    temperature: options.temperature ?? 0.3,
  })
  if (!result.success) return null
  // Raw OpenAI Chat Completions response shape.
  const content = (result.data as any)?.choices?.[0]?.message?.content
  return typeof content === 'string' ? content.trim() : null
}

const extractJson = (text: string): any | null => {
  const match = text.match(/\{[\s\S]*\}/)
  if (!match) return null
  try {
    return JSON.parse(match[0])
  } catch {
    return null
  }
}

export const processHeadlineItemsWithLLM = async (
  items: RawHeadline[],
  topic: string,
  signal: AbortSignal,
): Promise<EnrichedHeadline[]> => {
  if (items.length === 0) return []

  const itemsToEnrich = items.slice(0, 15)
  const batchSize = 6
  const batches: RawHeadline[][] = []
  for (let i = 0; i < itemsToEnrich.length; i += batchSize) {
    batches.push(itemsToEnrich.slice(i, i + batchSize))
  }

  const fallback = (item: RawHeadline): EnrichedHeadline => ({
    ...item,
    contextLine: (item.descriptionSnippet || 'Read more for details').substring(0, 120),
    shortSummary: (item.descriptionSnippet || 'Details limited from source preview.').substring(0, 320),
    negativity: 'medium',
    // Default true on fallback — better to show off-topic items than to
    // hide everything when the LLM call fails.
    relevant: true,
  })

  const enrichedBatches = await Promise.allSettled(
    batches.map(async (batch) => {
      if (signal.aborted) throw Object.assign(new Error('Aborted'), { name: 'AbortError' })
      const itemsText = batch
        .map(
          (item, idx) =>
            `Item ${idx + 1}:\nTitle: ${item.title}\nSource: ${item.source}\nDescription: ${
              item.descriptionSnippet || 'No description'
            }`,
        )
        .join('\n\n')

      const prompt = `Analyze these ${batch.length} news headlines for the "${topic}" topic and provide calm, neutral rewrites plus a strict topic-relevance judgment.

${itemsText}

Return ONLY valid JSON:
{
  "items": [
    {
      "contextLine": "Calm sentence (max 120 chars)",
      "shortSummary": "Brief summary (max 320 chars)",
      "negativity": "low or medium or high",
      "relevant": true or false
    }
  ]
}

Rules:
- Never invent facts. Use calm language. If no description, say "Details limited".
- "relevant": be STRICT. The "${topic}" topic means:
  - Tech: software, hardware, internet platforms, AI, startups, dev tools.
  - Business: companies, earnings, deals, strategy, commerce.
  - Science: research, physics, biology, medicine, climate, space, environment, peer-reviewed findings.
  - Markets: stocks, bonds, commodities, FX, central banks, trading, IPOs.
  - Sports: athletes, teams, leagues, games, tournaments.
  - Local: US national or regional news, civic affairs, courts, policy.
  Mark relevant=true ONLY if the item is PRIMARILY about ${topic}. Mark false for celebrity/entertainment news, gaming, consumer reviews, legal/political stories that aren't ${topic}, and anything that just tangentially mentions ${topic}.
- Return ${batch.length} items in same order.`

      try {
        const text = await callOpenAI(prompt, 'You are a calm news assistant. Return valid JSON only.', {
          model: 'gpt-4o-mini',
          temperature: 0.3,
          maxTokens: 2000,
        })
        if (!text) return batch.map(fallback)
        const parsed = extractJson(text)
        if (!parsed) return batch.map(fallback)
        return batch.map((item, idx) => {
          const llmData = parsed.items?.[idx] ?? {}
          // Default relevant=true if the LLM omitted the field (be lenient).
          const relevant = typeof llmData.relevant === 'boolean' ? llmData.relevant : true
          return {
            ...item,
            contextLine: (llmData.contextLine || item.descriptionSnippet || 'Read more for details').substring(0, 120),
            shortSummary: (llmData.shortSummary || item.descriptionSnippet || 'Details limited from source preview.').substring(0, 320),
            negativity: (llmData.negativity ?? 'medium') as EnrichedHeadline['negativity'],
            relevant,
          }
        })
      } catch (error: any) {
        if (error?.name === 'AbortError') throw error
        return batch.map(fallback)
      }
    }),
  )

  const allEnriched: EnrichedHeadline[] = []
  for (const r of enrichedBatches) {
    if (r.status === 'fulfilled' && Array.isArray(r.value)) allEnriched.push(...r.value)
  }
  return allEnriched
}

/**
 * Drop items the LLM marked as off-topic. Fallback only kicks in if
 * literally everything got filtered out — we'd rather show 3 truly
 * on-topic items than dilute with off-topic ones.
 */
export const applyRelevanceFilter = (
  enriched: EnrichedHeadline[],
  minKeep = 1,
): EnrichedHeadline[] => {
  const relevant = enriched.filter((item) => item.relevant)
  if (relevant.length >= minKeep) return relevant
  return enriched
}

/**
 * Tone (doom) filter — applied at display time on enriched items.
 *
 * If the result would leave fewer than `minKeep` items, we silently fall
 * back to the unfiltered list. This prevents the "stuck on Calm only"
 * behaviour where a strict filter could empty a topic entirely (e.g.
 * pre-enrichment items have no `negativity` yet, or the LLM happens to
 * score every item as medium/high).
 */
export const applyToneFilter = <T extends { negativity?: string }>(
  items: T[],
  filter: string,
  minKeep = 3,
): T[] => {
  if (filter === 'All' || items.length === 0) return items

  // Items still missing a negativity score (pre-enrichment, or the
  // anonymous render path) can't be tone-filtered — let them through.
  const scored = items.filter((i) => i.negativity !== undefined)
  if (scored.length === 0) return items

  let kept: T[] = items
  if (filter === 'Lighter') {
    kept = items.filter((i) => i.negativity === undefined || i.negativity !== 'high')
  } else if (filter === 'Calm only') {
    kept = items.filter((i) => i.negativity === 'low')
  }

  if (kept.length >= minKeep) return kept
  return items
}

export const generateTopicBrief = async (
  carouselItems: EnrichedHeadline[],
  topic: string,
  signal: AbortSignal,
): Promise<TopicBrief> => {
  const empty = (msg: string): TopicBrief => ({
    themeLabel: topic, takeaway: msg,
    nowBullets: [], stakeholdersBullets: [], watchNextBullets: [],
    whyItMattersBullets: [], viewpointsBullets: [], bulletArticleMap: {},
  })

  if (!carouselItems || carouselItems.length === 0) {
    return empty(`Select a topic to see your ${topic} brief.`)
  }

  try {
    if (signal.aborted) throw Object.assign(new Error('Aborted'), { name: 'AbortError' })
    const briefItems = carouselItems.slice(0, 10)
    const itemsText = briefItems
      .map((item, idx) => `${idx + 1}. [${item.source}] ${item.title}\n   ${item.descriptionSnippet || 'No description'}`)
      .join('\n\n')

    const prompt = `Analyze these ${briefItems.length} candidate news items and create a structured brief about "${topic}".

Some items may be off-topic — they came from catch-all feeds. SKIP them.

The "${topic}" topic means:
- Tech: software, hardware, internet platforms, AI, startups, dev tools.
- Business: companies, earnings, deals, strategy, commerce.
- Science: research, physics, biology, medicine, climate, space, environment, peer-reviewed findings.
- Markets: stocks, bonds, commodities, FX, central banks, trading, IPOs.
- Sports: athletes, teams, leagues, games, tournaments.
- Local: US national or regional news, civic affairs, courts, policy.

If an item is celebrity/entertainment, gaming, consumer reviews, or unrelated legal/political stories, EXCLUDE it from every section. Build the brief only from items genuinely about ${topic}. If after excluding off-topic items you have very little content, return shorter sections rather than padding with off-topic items.

${itemsText}

Return ONLY valid JSON:
{
  "themeLabel": "Brief theme (max 25 chars like ${topic} Today)",
  "takeaway": "One sentence key takeaway (max 150 chars)",
  "nowBullets": [{ "text": "bullet text (max 120 chars)", "sourceIndexes": [0, 1] }],
  "stakeholdersBullets": [{ "text": "bullet text", "sourceIndexes": [2] }],
  "watchNextBullets": [{ "text": "bullet text", "sourceIndexes": [0] }],
  "whyItMattersBullets": [{ "text": "bullet text", "sourceIndexes": [1, 3] }],
  "viewpointsBullets": [{ "text": "bullet text", "sourceIndexes": [2, 4] }]
}

Section requirements (max — go shorter if there isn't enough on-topic content):
- nowBullets: up to 5-7 bullets on distinct current developments
- stakeholdersBullets: up to 3-6 bullets on key players
- watchNextBullets: up to 3-5 bullets on what to watch
- whyItMattersBullets: up to 3-5 bullets on implications
- viewpointsBullets: up to 2-4 bullets contrasting perspectives
- sourceIndexes: 0-based indexes (0-${briefItems.length - 1}) of the ON-TOPIC source items used.

Rules: Use ONLY provided titles. Never invent facts. Keep calm, neutral tone. SKIP off-topic items.`

    const text = await callOpenAI(prompt, 'You are a calm news briefing assistant. Return valid JSON only.', {
      // gpt-4o-mini is 5-10× faster than gpt-4o and good enough for this
      // synthesis task (titles + descriptions in, structured JSON out).
      model: 'gpt-4o-mini',
      temperature: 0.4,
      maxTokens: 3000,
    })

    if (text) {
      const parsed = extractJson(text)
      if (parsed) {
        const bulletArticleMap: Record<string, EnrichedHeadline[]> = {}
        let bulletId = 0
        const processBullets = (bullets: any[]): BriefBullet[] =>
          (bullets ?? []).map((bullet) => {
            const bText = typeof bullet === 'string' ? bullet : bullet.text
            const sourceIdxs = typeof bullet === 'object' ? bullet.sourceIndexes ?? [] : []
            const bid = `bullet-${bulletId++}`
            const articles = sourceIdxs
              .filter((idx: number) => idx >= 0 && idx < briefItems.length)
              .map((idx: number) => briefItems[idx])
            if (articles.length > 0) bulletArticleMap[bid] = articles
            return { id: bid, text: String(bText ?? '').substring(0, 120) }
          })

        return {
          themeLabel: String(parsed.themeLabel ?? topic).substring(0, 30),
          takeaway: String(parsed.takeaway ?? '').substring(0, 150),
          nowBullets: processBullets(parsed.nowBullets).slice(0, 7),
          stakeholdersBullets: processBullets(parsed.stakeholdersBullets).slice(0, 6),
          watchNextBullets: processBullets(parsed.watchNextBullets).slice(0, 5),
          whyItMattersBullets: processBullets(parsed.whyItMattersBullets).slice(0, 5),
          viewpointsBullets: processBullets(parsed.viewpointsBullets).slice(0, 4),
          bulletArticleMap,
        }
      }
    }
  } catch (error: any) {
    if (error?.name === 'AbortError') throw error
  }

  // Fallback: bullets from titles only.
  const bulletArticleMap: Record<string, EnrichedHeadline[]> = {}
  const fallbackBullets: BriefBullet[] = carouselItems.slice(0, 5).map((item, idx) => {
    const bid = `bullet-${idx}`
    bulletArticleMap[bid] = [item]
    return { id: bid, text: item.title.substring(0, 120) }
  })

  return {
    themeLabel: topic,
    takeaway: `${carouselItems.length} ${topic} developments tracked across sources.`,
    nowBullets: fallbackBullets,
    stakeholdersBullets: [],
    watchNextBullets: [],
    whyItMattersBullets: [],
    viewpointsBullets: [],
    bulletArticleMap,
  }
}

export const generateDetailedSummary = async (
  articles: EnrichedHeadline[],
  signal: AbortSignal,
): Promise<string> => {
  if (signal.aborted) throw Object.assign(new Error('Aborted'), { name: 'AbortError' })

  const itemsText = articles
    .map(
      (article, idx) =>
        `Article ${idx + 1}:\nTitle: ${article.title}\nSource: ${article.source}\nSnippet: ${
          article.descriptionSnippet || article.contextLine || 'No description'
        }`,
    )
    .join('\n\n')

  const prompt = `Provide a comprehensive 6-8 line summary of these news items.

${itemsText}

Return ONLY valid JSON:
{
  "summary": "A detailed 6-8 line paragraph synthesizing the key information. Be specific, factual, and calm."
}

Rules:
- Write 6-8 lines (~400-500 characters)
- Synthesize information from all provided articles
- Never invent facts
- Use calm, neutral language`

  try {
    const text = await callOpenAI(prompt, 'You are a calm news assistant. Return valid JSON only.', {
      model: 'gpt-4o-mini',
      temperature: 0.3,
      maxTokens: 800,
    })
    if (text) {
      const parsed = extractJson(text)
      if (parsed?.summary) return String(parsed.summary)
    }
    const fallback = articles.map((a) => a.descriptionSnippet || a.contextLine || 'No details available').join(' ')
    return fallback.substring(0, 500) || 'Details limited from source previews.'
  } catch (error: any) {
    if (error?.name === 'AbortError') throw error
    return 'Unable to generate summary at this time.'
  }
}
