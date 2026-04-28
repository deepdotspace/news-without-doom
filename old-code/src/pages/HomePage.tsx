import React, { useState, useEffect, useMemo, useRef } from 'react'
import { mcapi } from '@spaces/sdk'

// VERSION: 5.3 - Inline right actions + read-more accordion
// Migrated to new widget pattern: uses mcapi instead of miyagiAPI, Tailwind via CSS system

// LOCKED SOURCE SET
const LOCKED_SOURCES = [
  'BBC',
  'Reuters',
  'TechCrunch',
  'The Verge',
  'Wired',
  'ESPN',
  'CNN',
  'CNBC'
]

const sanitizeSources = (_sources: any) => {
  return LOCKED_SOURCES
}

const getPublishedAtMs = (item: Element): number | null => {
  const fields = ['isoDate', 'pubDate', 'published', 'updated', 'dc:date', 'dcdate', 'date']

  for (const field of fields) {
    let dateString: string | null = null

    const element = item.querySelector(field)
    if (element) {
      dateString = element.textContent?.trim() ?? null
    }

    if (!dateString && field.includes(':')) {
      const nsVariations = [field.replace(':', '\\:'), field.split(':')[1]]
      for (const variation of nsVariations) {
        const el = item.querySelector(variation)
        if (el) {
          dateString = el.textContent?.trim() ?? null
          break
        }
      }
    }

    if (dateString && typeof dateString === 'string' && dateString.length > 0) {
      try {
        const date = new Date(dateString)
        const timestamp = date.getTime()
        if (!isNaN(timestamp) && timestamp > 0) {
          const now = Date.now()
          const twoYearsAgo = now - (2 * 365 * 24 * 60 * 60 * 1000)
          const oneWeekFuture = now + (7 * 24 * 60 * 60 * 1000)
          if (timestamp > twoYearsAgo && timestamp < oneWeekFuture) {
            return timestamp
          }
        }
      } catch (e) {
        continue
      }
    }
  }
  return null
}

const RSS_FEEDS_BY_TOPIC: Record<string, Record<string, string | null>> = {
  'Tech': {
    'BBC': 'https://feeds.bbci.co.uk/news/technology/rss.xml',
    'Reuters': 'https://www.reutersagency.com/feed/?taxonomy=best-topics&post_type=best',
    'TechCrunch': 'https://techcrunch.com/feed/',
    'The Verge': 'https://www.theverge.com/tech/rss',
    'Wired': 'https://www.wired.com/feed/tag/tech/latest/rss',
    'ESPN': null,
    'CNN': 'http://rss.cnn.com/rss/cnn_tech.rss',
    'CNBC': 'https://www.cnbc.com/id/19854910/device/rss/rss.html'
  },
  'Business': {
    'BBC': 'https://feeds.bbci.co.uk/news/business/rss.xml',
    'Reuters': 'https://www.reutersagency.com/feed/?best-topics=business-finance&post_type=best',
    'TechCrunch': 'https://techcrunch.com/category/startups/feed/',
    'The Verge': 'https://www.theverge.com/policy/rss',
    'Wired': 'https://www.wired.com/feed/category/business/latest/rss',
    'ESPN': null,
    'CNN': 'http://rss.cnn.com/rss/money_latest.rss',
    'CNBC': 'https://www.cnbc.com/id/10001147/device/rss/rss.html'
  },
  'Markets': {
    'BBC': 'https://feeds.bbci.co.uk/news/business/rss.xml',
    'Reuters': 'https://www.reutersagency.com/feed/?best-topics=business-finance&post_type=best',
    'TechCrunch': 'https://techcrunch.com/category/venture/feed/',
    'The Verge': null,
    'Wired': null,
    'ESPN': null,
    'CNN': 'http://rss.cnn.com/rss/money_markets.rss',
    'CNBC': 'https://www.cnbc.com/id/15839135/device/rss/rss.html'
  },
  'Science': {
    'BBC': 'https://feeds.bbci.co.uk/news/science_and_environment/rss.xml',
    'Reuters': 'https://www.reutersagency.com/feed/?best-topics=science&post_type=best',
    'TechCrunch': null,
    'The Verge': 'https://www.theverge.com/science/rss',
    'Wired': 'https://www.wired.com/feed/category/science/latest/rss',
    'ESPN': null,
    'CNN': null,
    'CNBC': null
  },
  'Sports': {
    'BBC': 'https://feeds.bbci.co.uk/sport/rss.xml',
    'Reuters': 'https://www.reutersagency.com/feed/?best-topics=sports&post_type=best',
    'TechCrunch': null,
    'The Verge': null,
    'Wired': null,
    'ESPN': 'https://www.espn.com/espn/rss/news',
    'CNN': 'http://rss.cnn.com/rss/edition_sport.rss',
    'CNBC': null
  },
  'Local': {
    'BBC': 'https://feeds.bbci.co.uk/news/england/rss.xml',
    'Reuters': 'https://www.reutersagency.com/feed/?best-regions=united-states&post_type=best',
    'TechCrunch': null,
    'The Verge': null,
    'Wired': null,
    'ESPN': null,
    'CNN': 'http://rss.cnn.com/rss/cnn_us.rss',
    'CNBC': 'https://www.cnbc.com/id/15837362/device/rss/rss.html'
  }
}

const generateId = (source: string, title: string, timestamp: number) => {
  const str = `${source}-${title}-${timestamp}`
  let hash = 0
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i)
    hash = ((hash << 5) - hash) + char
    hash = hash & hash
  }
  return `rss-${Math.abs(hash)}`
}

const fetchText = async (url: string, signal: AbortSignal) => {
  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: { 'Accept': 'application/rss+xml, application/xml, text/xml' },
      signal
    })
    if (response.ok) {
      return { success: true, text: await response.text() }
    }
    throw new Error(`HTTP ${response.status}`)
  } catch (directError: any) {
    if (directError.name === 'AbortError') throw directError

    try {
      const proxyUrl = `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`
      const response = await fetch(proxyUrl, { signal })
      if (response.ok) {
        return { success: true, text: await response.text() }
      }
    } catch (proxyError: any) {
      if (proxyError.name === 'AbortError') throw proxyError
      return { success: false, error: directError.message.includes('CORS') ? 'CORS blocked' : directError.message }
    }
  }
  return { success: false, error: 'Unknown error' }
}

const parseRSSFeed = async (url: string, sourceName: string, topic: string, signal: AbortSignal) => {
  try {
    const fetchedAtISO = new Date().toISOString()
    const result = await fetchText(url, signal)

    if (!result.success) {
      return { items: [], error: result.error, url }
    }

    const parser = new DOMParser()
    const xml = parser.parseFromString(result.text!, 'text/xml')

    const parseError = xml.querySelector('parsererror')
    if (parseError) {
      return { items: [], error: 'XML parse error', url }
    }

    const items = xml.querySelectorAll('item, entry')
    const parsed: any[] = []

    const nowMs = Date.now()
    const cutoffMs = nowMs - (24 * 60 * 60 * 1000)
    const futureBufferMs = nowMs + (5 * 60 * 1000)

    for (let i = 0; i < Math.min(items.length, 50); i++) {
      const item = items[i]
      const title = item.querySelector('title')?.textContent?.trim()

      let link = item.querySelector('link')?.textContent?.trim()
      if (!link) {
        const linkEl = item.querySelector('link[rel="alternate"]')
        link = linkEl?.getAttribute('href') ?? undefined
      }
      if (!link) {
        link = item.querySelector('link')?.getAttribute('href') ?? undefined
      }

      if (!title || !link) continue

      const publishedAtMs = getPublishedAtMs(item)
      if (!publishedAtMs) continue

      const isIn24h = publishedAtMs >= cutoffMs && publishedAtMs <= futureBufferMs
      if (!isIn24h) continue

      let description = item.querySelector('description')?.textContent?.trim()
      if (!description) description = item.querySelector('summary')?.textContent?.trim()
      if (!description) description = item.querySelector('content')?.textContent?.trim()
      if (!description) description = item.querySelector('content\\:encoded')?.textContent?.trim()

      const publishedAtISO = new Date(publishedAtMs).toISOString()
      const id = generateId(sourceName, title, publishedAtMs)

      const cleanDescription = description
        ? description.replace(/<[^>]*>/g, '').replace(/&[^;]+;/g, ' ').substring(0, 300).trim()
        : ''

      const diff = nowMs - publishedAtMs
      const hours = Math.floor(diff / (1000 * 60 * 60))
      const publishedAt = hours < 1 ? 'Just now'
        : hours < 24 ? `${hours} hour${hours === 1 ? '' : 's'} ago`
        : `${Math.floor(hours / 24)} day${Math.floor(hours / 24) === 1 ? '' : 's'} ago`

      parsed.push({
        id, title, link, source: sourceName, topic, publishedAt, publishedAtISO,
        timestamp: publishedAtMs, descriptionSnippet: cleanDescription, sourceName,
        rssFeedUrlUsed: url, fetchedAtISO, itemUrl: link, originalTitle: title,
        originalDescriptionSnippet: cleanDescription
      })
    }

    return { items: parsed, error: null, url }
  } catch (error: any) {
    if (error.name === 'AbortError') throw error
    return { items: [], error: error.message, url }
  }
}

const processHeadlineItemsWithLLM = async (items: any[], signal: AbortSignal) => {
  if (items.length === 0) return []

  const itemsToEnrich = items.slice(0, 15)
  const batchSize = 6
  const batches: any[][] = []
  for (let i = 0; i < itemsToEnrich.length; i += batchSize) {
    batches.push(itemsToEnrich.slice(i, i + batchSize))
  }

  const enrichedBatches = await Promise.allSettled(
    batches.map(async (batch) => {
      try {
        const itemsText = batch.map((item: any, idx: number) =>
          `Item ${idx + 1}:\nTitle: ${item.title}\nSource: ${item.source}\nDescription: ${item.descriptionSnippet || 'No description'}`
        ).join('\n\n')

        const prompt = `Analyze these ${batch.length} news headlines and provide calm, neutral rewrites.

${itemsText}

Return ONLY valid JSON:
{
  "items": [
    {
      "contextLine": "Calm sentence (max 120 chars)",
      "shortSummary": "Brief summary (max 320 chars)",
      "negativity": "low or medium or high"
    }
  ]
}

Rules: Never invent facts. Use calm language. If no description, say "Details limited". Return ${batch.length} items in same order.`

        const response = await mcapi.post('/generate-text', {
          prompt,
          model: 'gpt-4o-mini',
          temperature: 0.3,
          max_tokens: 2000,
          system_prompt: 'You are a calm news assistant. Return valid JSON only.'
        })

        if (response.success && response.data?.text) {
          const text = response.data.text.trim()
          const jsonMatch = text.match(/\{[\s\S]*\}/)
          if (jsonMatch) {
            const parsed = JSON.parse(jsonMatch[0])
            return batch.map((item: any, idx: number) => {
              const llmData = parsed.items?.[idx] || {}
              return {
                ...item,
                contextLine: (llmData.contextLine || item.descriptionSnippet || 'Read more for details').substring(0, 120),
                shortSummary: (llmData.shortSummary || item.descriptionSnippet || 'Details limited from source preview.').substring(0, 320),
                negativity: llmData.negativity || 'medium'
              }
            })
          }
        }

        return batch.map((item: any) => ({
          ...item,
          contextLine: (item.descriptionSnippet || 'Read more for details').substring(0, 120),
          shortSummary: (item.descriptionSnippet || 'Details limited from source preview.').substring(0, 320),
          negativity: 'medium'
        }))
      } catch (error: any) {
        if (error.name === 'AbortError') throw error
        return batch.map((item: any) => ({
          ...item,
          contextLine: (item.descriptionSnippet || 'Read more for details').substring(0, 120),
          shortSummary: (item.descriptionSnippet || 'Details limited from source preview.').substring(0, 320),
          negativity: 'medium'
        }))
      }
    })
  )

  const allEnriched: any[] = []
  enrichedBatches.forEach((result: any) => {
    if (result.status === 'fulfilled' && Array.isArray(result.value)) {
      allEnriched.push(...result.value)
    }
  })
  return allEnriched
}

const fetchTopicFeeds = async (topic: string, sources: string[], signal: AbortSignal) => {
  const feedsForTopic = RSS_FEEDS_BY_TOPIC[topic] || {}
  const sanitizedSources = sanitizeSources(sources)
  const sourcesToFetch = sanitizedSources.filter((s: string) => feedsForTopic[s] !== null && feedsForTopic[s] !== undefined)

  const results = await Promise.allSettled(
    sourcesToFetch.map((sourceName: string) => {
      const feedUrl = feedsForTopic[sourceName]
      if (!feedUrl) {
        return Promise.resolve({ items: [], error: 'No category feed available', url: 'N/A', source: sourceName })
      }
      return parseRSSFeed(feedUrl, sourceName, topic, signal)
    })
  )

  const allItems: any[] = []
  results.forEach((result: any) => {
    if (result.status === 'fulfilled' && result.value.items?.length > 0) {
      allItems.push(...result.value.items)
    }
  })
  return { items: allItems }
}

const deduplicateItems = (items: any[]) => {
  const seen = new Set()
  return items.filter((item: any) => {
    if (seen.has(item.id)) return false
    seen.add(item.id)
    return true
  })
}

const selectHeadlines = (items: any[], topic: string, negativityFilter: string, selectedSources: string[]) => {
  let filtered = items.filter((item: any) => item.topic === topic)
  const sanitizedSources = sanitizeSources(selectedSources)
  filtered = filtered.filter((item: any) => sanitizedSources.includes(item.source))

  if (negativityFilter === 'Light') {
    filtered = filtered.filter((item: any) => item.negativity !== 'high')
  } else if (negativityFilter === 'Strict') {
    filtered = filtered.filter((item: any) => item.negativity === 'low')
  }

  filtered.sort((a: any, b: any) => {
    if (a.timestamp !== b.timestamp) return b.timestamp - a.timestamp
    if (a.source !== b.source) return a.source.localeCompare(b.source)
    return a.title.localeCompare(b.title)
  })
  return filtered
}

const get24hWindowId = () => {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
}

const computeHeadlineSetHash = (headlines: any[]) => {
  if (!headlines || headlines.length === 0) return 'empty'
  const sortedHeadlines = [...headlines].sort((a: any, b: any) => {
    if (b.timestamp !== a.timestamp) return b.timestamp - a.timestamp
    return (a.link || '').localeCompare(b.link || '')
  })
  const hashInput = sortedHeadlines.map((h: any) => `${h.source}|${h.title}|${h.link}|${h.timestamp}`).join('::')
  let hash = 0
  for (let i = 0; i < hashInput.length; i++) {
    const char = hashInput.charCodeAt(i)
    hash = ((hash << 5) - hash) + char
    hash = hash & hash
  }
  return `hash-${Math.abs(hash)}`
}

const generateTopicBrief = async (carouselItems: any[], topic: string, signal: AbortSignal) => {
  if (!carouselItems || carouselItems.length === 0) {
    return {
      themeLabel: topic, takeaway: `Select a topic to see your ${topic} brief.`,
      nowBullets: [], stakeholdersBullets: [], watchNextBullets: [],
      whyItMattersBullets: [], viewpointsBullets: [], bulletArticleMap: {}
    }
  }

  try {
    const briefItems = carouselItems.slice(0, 10)
    const itemsText = briefItems.map((item: any, idx: number) =>
      `${idx + 1}. [${item.source}] ${item.title}\n   ${item.descriptionSnippet || 'No description'}`
    ).join('\n\n')

    const prompt = `Analyze these ${briefItems.length} ${topic} news items and create a structured brief.

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

Section requirements:
- nowBullets: 5-7 bullets on distinct current developments
- stakeholdersBullets: 3-6 bullets on key players
- watchNextBullets: 3-5 bullets on what to watch
- whyItMattersBullets: 3-5 bullets on implications
- viewpointsBullets: 2-4 bullets contrasting perspectives
- sourceIndexes: 0-based indexes (0-${briefItems.length - 1})

Rules: Use ONLY provided titles. Never invent facts. Keep calm, neutral tone.`

    const response = await mcapi.post('/generate-text', {
      prompt,
      model: 'gpt-4o',
      temperature: 0.4,
      max_tokens: 3000,
      system_prompt: 'You are a calm news briefing assistant. Return valid JSON only.'
    })

    if (response.success && response.data?.text) {
      const text = response.data.text.trim()
      const jsonMatch = text.match(/\{[\s\S]*\}/)
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0])
        const bulletArticleMap: Record<string, any[]> = {}
        let bulletId = 0

        const processBullets = (bullets: any[]) => {
          return bullets.map((bullet: any) => {
            const bText = typeof bullet === 'string' ? bullet : bullet.text
            const sourceIdxs = typeof bullet === 'object' ? (bullet.sourceIndexes || []) : []
            const bid = `bullet-${bulletId++}`
            const articles = sourceIdxs
              .filter((idx: number) => idx >= 0 && idx < briefItems.length)
              .map((idx: number) => briefItems[idx])
            if (articles.length > 0) bulletArticleMap[bid] = articles
            return { id: bid, text: bText.substring(0, 120) }
          })
        }

        return {
          themeLabel: (parsed.themeLabel || topic).substring(0, 30),
          takeaway: (parsed.takeaway || '').substring(0, 150),
          nowBullets: processBullets(parsed.nowBullets || []).slice(0, 7),
          stakeholdersBullets: processBullets(parsed.stakeholdersBullets || []).slice(0, 6),
          watchNextBullets: processBullets(parsed.watchNextBullets || []).slice(0, 5),
          whyItMattersBullets: processBullets(parsed.whyItMattersBullets || []).slice(0, 5),
          viewpointsBullets: processBullets(parsed.viewpointsBullets || []).slice(0, 4),
          bulletArticleMap
        }
      }
    }
  } catch (error: any) {
    if (error.name === 'AbortError') throw error
  }

  const bulletArticleMap: Record<string, any[]> = {}
  const fallbackBullets = carouselItems.slice(0, 5).map((item: any, idx: number) => {
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
    bulletArticleMap
  }
}

export default function HomePage() {
  const [selectedTopic, setSelectedTopic] = useState('Tech')
  const [negativityFilter, setNegativityFilter] = useState('Light')
  const [itemsByTopic, setItemsByTopic] = useState<Record<string, any[]>>({})
  const [contextCache, setContextCache] = useState<Record<string, any>>({})
  const [itemsCurrent, setItemsCurrent] = useState<any[]>([])
  const [topicBrief, setTopicBrief] = useState<any>({})
  const [savedItems, setSavedItems] = useState<any[]>([])
  const [updating, setUpdating] = useState(false)
  const [generatingBrief, setGeneratingBrief] = useState(false)
  const [lastRefresh, setLastRefresh] = useState(new Date().toISOString())
  const [selectedHeadline, setSelectedHeadline] = useState<any>(null)
  const [savedDrawerOpen, setSavedDrawerOpen] = useState(false)
  const [headlinesExpanded, setHeadlinesExpanded] = useState(true)
  const [expandedBulletId, setExpandedBulletId] = useState<string | null>(null)
  const [bulletSummaries, setBulletSummaries] = useState<Record<string, string>>({})
  const [loadingSummary, setLoadingSummary] = useState<string | null>(null)

  const abortControllerRef = useRef<AbortController | null>(null)
  const requestIdRef = useRef(0)
  const topicDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const summaryAbortRef = useRef<Record<string, AbortController>>({})

  const topics = ['Tech', 'Business', 'Science', 'Markets', 'Sports', 'Local']
  const sources = LOCKED_SOURCES
  const filterOptions = ['Off', 'Light', 'Strict']

  useEffect(() => {
    const runPipeline = async () => {
      const timings: Record<string, number> = {}
      const statuses: Record<string, any> = {}

      if (abortControllerRef.current) {
        abortControllerRef.current.abort()
      }

      abortControllerRef.current = new AbortController()
      const signal = abortControllerRef.current.signal
      const currentRequestId = ++requestIdRef.current

      const windowId = get24hWindowId()
      const cacheKey = `brief:${selectedTopic}:${windowId}`
      statuses.cacheKeyUsed = cacheKey

      const cachedContext = contextCache[cacheKey]
      const cachedItems = itemsByTopic[selectedTopic]

      if (cachedContext && cachedContext.brief) {
        setTopicBrief(cachedContext.brief)
        if (cachedItems && cachedItems.length > 0) {
          const filtered = selectHeadlines(cachedItems, selectedTopic, negativityFilter, sources)
          setItemsCurrent(filtered.slice(0, 10))
        }
        statuses.cacheHit = true
      } else {
        statuses.cacheHit = false
        setItemsCurrent([])
        setTopicBrief({
          themeLabel: selectedTopic, takeaway: 'Loading...',
          nowBullets: [], stakeholdersBullets: [], watchNextBullets: [],
          whyItMattersBullets: [], viewpointsBullets: [], bulletArticleMap: {}
        })
      }

      setUpdating(true)

      try {
        const result = await fetchTopicFeeds(selectedTopic, sources, signal)
        if (currentRequestId !== requestIdRef.current) return

        let items = result.items
        if (items.length === 0) {
          setItemsByTopic(prev => ({ ...prev, [selectedTopic]: [] }))
          setItemsCurrent([])
          setTopicBrief({
            themeLabel: selectedTopic, takeaway: 'No recent headlines found',
            nowBullets: [], stakeholdersBullets: [], watchNextBullets: [],
            whyItMattersBullets: [], viewpointsBullets: [], bulletArticleMap: {}
          })
          setUpdating(false)
          return
        }

        const deduplicated = deduplicateItems(items)
        const sortedAll = [...deduplicated].sort((a: any, b: any) => {
          if (b.timestamp !== a.timestamp) return b.timestamp - a.timestamp
          if (a.source !== b.source) return a.source.localeCompare(b.source)
          return a.title.localeCompare(b.title)
        })

        const filtered = selectHeadlines(sortedAll, selectedTopic, negativityFilter, sources)
        const displayedItems = filtered.slice(0, 10)

        const enrichedDisplayed = await processHeadlineItemsWithLLM(displayedItems, signal)
        if (currentRequestId !== requestIdRef.current) return

        const currentHash = computeHeadlineSetHash(enrichedDisplayed)
        const needsRegeneration = !cachedContext || cachedContext.hash !== currentHash

        let brief: any
        if (needsRegeneration) {
          setGeneratingBrief(true)
          brief = await generateTopicBrief(enrichedDisplayed, selectedTopic, signal)
          if (currentRequestId !== requestIdRef.current) return
          setContextCache(prev => ({
            ...prev,
            [cacheKey]: { brief, hash: currentHash, generatedAt: new Date().toISOString(), windowId }
          }))
        } else {
          brief = cachedContext.brief
        }

        const enrichedMap = new Map(enrichedDisplayed.map((item: any) => [item.id, item]))
        const finalAll = sortedAll.map((item: any) => enrichedMap.get(item.id) || item)

        if (currentRequestId === requestIdRef.current) {
          setItemsByTopic(prev => ({ ...prev, [selectedTopic]: finalAll }))
          setItemsCurrent(enrichedDisplayed)
          setTopicBrief(brief)
        }
      } catch (error: any) {
        if (error.name === 'AbortError') return
        console.error('Fetch error:', error)
        if (currentRequestId === requestIdRef.current) {
          setItemsCurrent([])
        }
      } finally {
        if (currentRequestId === requestIdRef.current) {
          setUpdating(false)
          setGeneratingBrief(false)
        }
      }
    }

    runPipeline()
    return () => {
      if (abortControllerRef.current) abortControllerRef.current.abort()
    }
  }, [selectedTopic, lastRefresh, negativityFilter])

  useEffect(() => {
    setExpandedBulletId(null)
    Object.values(summaryAbortRef.current).forEach(ctrl => ctrl.abort())
    summaryAbortRef.current = {}
  }, [selectedTopic])

  const headlines = useMemo(() => (itemsCurrent || []).slice(0, 10), [itemsCurrent])
  const sortedSavedItems = useMemo(() => [...savedItems].sort((a: any, b: any) => (b.savedAt || 0) - (a.savedAt || 0)), [savedItems])

  const handleSave = (headline: any) => {
    setSavedItems(prev => {
      const exists = prev.find((h: any) => h.id === headline.id)
      if (exists) return prev.filter((h: any) => h.id !== headline.id)
      return [...prev, { ...headline, savedAt: Date.now() }]
    })
  }

  const isSaved = (headlineId: string) => savedItems.some((h: any) => h.id === headlineId)

  const generateDetailedSummary = async (articles: any[], bulletId: string) => {
    const cacheKey = articles.map((a: any) => a.link).sort().join('::')
    if (bulletSummaries[cacheKey]) return bulletSummaries[cacheKey]

    if (summaryAbortRef.current[bulletId]) summaryAbortRef.current[bulletId].abort()
    const controller = new AbortController()
    summaryAbortRef.current[bulletId] = controller

    try {
      setLoadingSummary(bulletId)
      const itemsText = articles.map((article: any, idx: number) =>
        `Article ${idx + 1}:\nTitle: ${article.title}\nSource: ${article.source}\nSnippet: ${article.descriptionSnippet || article.contextLine || 'No description'}`
      ).join('\n\n')

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

      const response = await mcapi.post('/generate-text', {
        prompt,
        model: 'gpt-4o-mini',
        temperature: 0.3,
        max_tokens: 800,
        system_prompt: 'You are a calm news assistant. Return valid JSON only.'
      })

      if (response.success && response.data?.text) {
        const text = response.data.text.trim()
        const jsonMatch = text.match(/\{[\s\S]*\}/)
        if (jsonMatch) {
          const parsed = JSON.parse(jsonMatch[0])
          const summary = parsed.summary || 'Details limited from source previews.'
          setBulletSummaries(prev => ({ ...prev, [cacheKey]: summary }))
          return summary
        }
      }

      const fallback = articles.map((a: any) => a.descriptionSnippet || a.contextLine || 'No details available').join(' ')
      return fallback.substring(0, 500) || 'Details limited from source previews.'
    } catch (error: any) {
      if (error.name === 'AbortError') return null
      return 'Unable to generate summary at this time.'
    } finally {
      setLoadingSummary(null)
      delete summaryAbortRef.current[bulletId]
    }
  }

  const handleReadMoreToggle = async (bulletId: string, articles: any[], event: React.MouseEvent) => {
    if (expandedBulletId === bulletId) {
      setExpandedBulletId(null)
    } else {
      setExpandedBulletId(bulletId)
      const cacheKey = articles.map((a: any) => a.link).sort().join('::')
      if (!bulletSummaries[cacheKey]) {
        await generateDetailedSummary(articles, bulletId)
      }
      setTimeout(() => {
        const element = (event?.target as HTMLElement)?.closest('li')
        if (element) element.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
      }, 150)
    }
  }

  const selectTopic = (topic: string) => {
    if (topicDebounceRef.current) clearTimeout(topicDebounceRef.current)
    setSelectedTopic(topic)
    topicDebounceRef.current = setTimeout(() => {
      setLastRefresh(new Date().toISOString())
    }, 300)
  }

  const handleRefresh = () => setLastRefresh(new Date().toISOString())

  const BriefSection = ({ title, bullets, bulletArticleMap }: { title: string; bullets: any[]; bulletArticleMap: Record<string, any[]> }) => {
    if (!bullets || bullets.length === 0) return null
    return (
      <div className="bg-card rounded-lg border border-border p-4 shadow-card">
        <h4 className="text-xs font-bold uppercase tracking-wider text-primary mb-3">{title}</h4>
        <ul className="space-y-2.5">
          {bullets.map((bullet: any) => {
            const bulletText = typeof bullet === 'string' ? bullet : bullet.text
            const bulletId = typeof bullet === 'object' ? bullet.id : null
            const articles = bulletId && bulletArticleMap ? bulletArticleMap[bulletId] : null
            const isExpanded = expandedBulletId === bulletId
            const cacheKey = articles ? articles.map((a: any) => a.link).sort().join('::') : null
            const cachedSummary = cacheKey ? bulletSummaries[cacheKey] : null

            return (
              <li key={bulletId || bulletText}>
                <div className="flex items-start gap-2.5">
                  <div className="w-1.5 h-1.5 bg-primary/50 rounded-full mt-[6px] flex-shrink-0"></div>
                  <div className="flex-1 min-w-0">
                    <span className="text-[13px] leading-relaxed text-foreground">{bulletText}</span>
                    {articles && articles.length > 0 && (
                      <>
                        {articles.map((article: any) => (
                          <a
                            key={article.id}
                            href={article.link}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center ml-1.5 text-primary/60 hover:text-primary transition-colors"
                            title={article.title}
                          >
                            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                            </svg>
                          </a>
                        ))}
                        <button
                          onClick={(e) => handleReadMoreToggle(bulletId!, articles, e)}
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
                    {loadingSummary === bulletId ? (
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

  const brief = topicBrief.themeLabel ? topicBrief : {
    themeLabel: selectedTopic, takeaway: '', nowBullets: [], stakeholdersBullets: [],
    watchNextBullets: [], whyItMattersBullets: [], viewpointsBullets: [], bulletArticleMap: {}
  }

  return (
    <div className="w-full h-full overflow-y-auto bg-background" style={{ fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif' }}>
      {/* Sticky toolbar */}
      <div className="sticky top-0 z-30 bg-background/95 backdrop-blur-sm border-b border-border px-4 py-2">
        <div className="max-w-3xl mx-auto flex items-center gap-2">
          <span className="text-xs font-bold text-foreground whitespace-nowrap shrink-0">News Without Doom</span>
          <div className="w-px h-3.5 bg-border shrink-0"></div>
          {topics.map(topic => (
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
          {filterOptions.map(option => (
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
          <button onClick={() => setSavedDrawerOpen(!savedDrawerOpen)} className="text-xs text-muted-foreground hover:text-foreground font-medium shrink-0">
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
            {generatingBrief && <p className="text-xs text-muted-foreground/60 mt-1">Analyzing headlines from trusted sources</p>}
          </div>
        ) : (
          <div className="space-y-3">
            {/* Hero takeaway */}
            {brief.takeaway && (
              <div className="bg-card rounded-lg border border-border p-4 shadow-card">
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-xs font-bold uppercase tracking-wider text-primary">{brief.themeLabel || selectedTopic}</span>
                  {generatingBrief && <div className="w-2.5 h-2.5 border-2 border-primary/40 border-t-transparent rounded-full animate-spin"></div>}
                </div>
                <p className="text-sm text-foreground leading-relaxed font-medium">{brief.takeaway}</p>
              </div>
            )}

            {/* Main brief: What's Happening takes full width */}
            <BriefSection title="What's Happening Now" bullets={brief.nowBullets} bulletArticleMap={brief.bulletArticleMap} />

            {/* Two-column grid for secondary sections */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <BriefSection title="Key Players" bullets={brief.stakeholdersBullets} bulletArticleMap={brief.bulletArticleMap} />
              <BriefSection title="What to Watch" bullets={brief.watchNextBullets} bulletArticleMap={brief.bulletArticleMap} />
              <BriefSection title="Why It Matters" bullets={brief.whyItMattersBullets} bulletArticleMap={brief.bulletArticleMap} />
              <BriefSection title="Viewpoints" bullets={brief.viewpointsBullets} bulletArticleMap={brief.bulletArticleMap} />
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
              <svg className={`w-3 h-3 text-muted-foreground transition-transform ${headlinesExpanded ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M19 9l-7 7-7-7" />
              </svg>
            </button>

            {headlinesExpanded && (
              <div className="bg-card rounded-lg border border-border shadow-card divide-y divide-border/50">
                {headlines.slice(0, 5).map((headline: any) => (
                  <div
                    key={headline.id}
                    className="px-4 py-3 cursor-pointer group hover:bg-muted/30 transition-colors first:rounded-t-lg last:rounded-b-lg"
                    onClick={() => setSelectedHeadline(headline)}
                  >
                    <div className="flex items-baseline gap-2 mb-0.5">
                      <span className="text-xs font-bold uppercase tracking-wide text-muted-foreground shrink-0">{headline.source}</span>
                      <span className="text-xs text-muted-foreground/60">{headline.publishedAt}</span>
                    </div>
                    <p className="text-[13px] text-foreground leading-snug group-hover:text-primary transition-colors">{headline.title}</p>
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
                <button onClick={() => setSavedDrawerOpen(false)} className="text-xs text-muted-foreground hover:text-foreground">Close</button>
              </div>
              {sortedSavedItems.length === 0 ? (
                <p className="text-xs text-muted-foreground text-center py-6">No saved articles yet</p>
              ) : (
                <div className="space-y-1">
                  {sortedSavedItems.map((item: any) => (
                    <div key={item.id} className="flex items-start justify-between gap-2 py-2 border-b border-border/50 last:border-0">
                      <div className="flex-1 cursor-pointer min-w-0" onClick={() => setSelectedHeadline(item)}>
                        <span className="text-xs font-bold uppercase text-muted-foreground mr-2">{item.source}</span>
                        <span className="text-[13px] text-foreground">{item.title}</span>
                      </div>
                      <button onClick={() => handleSave(item)} className="text-xs text-muted-foreground hover:text-destructive shrink-0">Remove</button>
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
        <div className="fixed inset-0 bg-foreground/20 flex items-center justify-center z-50 p-4 backdrop-blur-sm" onClick={() => setSelectedHeadline(null)}>
          <div className="bg-card rounded-lg shadow-2xl w-full max-w-lg max-h-[75vh] overflow-y-auto border border-border" onClick={(e) => e.stopPropagation()}>
            <div className="p-5">
              <div className="flex items-start justify-between mb-3">
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1.5">
                    <span className="text-xs font-bold uppercase text-muted-foreground">{selectedHeadline.source}</span>
                    <span className="text-xs text-muted-foreground/60">{selectedHeadline.publishedAt}</span>
                  </div>
                  <h2 className="text-base font-bold text-foreground leading-snug">{selectedHeadline.title}</h2>
                </div>
                <button onClick={() => setSelectedHeadline(null)} className="text-xs text-muted-foreground hover:text-foreground ml-3 shrink-0 mt-1">Close</button>
              </div>

              {selectedHeadline.contextLine && (
                <p className="text-[13px] text-foreground border-l-2 border-primary pl-3 mb-3 leading-relaxed">{selectedHeadline.contextLine}</p>
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
