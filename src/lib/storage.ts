/**
 * Topic cache backed by localStorage.
 *
 * Stores the per-topic brief + enriched headlines so:
 *   - Reloading the page doesn't re-fetch RSS / re-call the LLM.
 *   - Switching back to a recently-viewed topic is instant.
 *   - Refresh is the only path that explicitly bypasses the cache.
 *
 * Entries auto-expire after `TTL_MS`; older entries are treated as missing.
 */

import type { EnrichedHeadline, TopicBrief } from './news'

const STORAGE_KEY = 'news-without-doom:cache:v1'

/** How long a cached topic is considered fresh. One hour matches the
 *  "Top Headlines" refresh cadence — feels live without spamming OpenAI. */
const TTL_MS = 60 * 60 * 1000

export interface CachedTopic {
  brief: TopicBrief
  items: EnrichedHeadline[]
  fetchedAt: number // ms epoch
}

export type TopicCache = Record<string, CachedTopic>

const isBrowser = () => typeof window !== 'undefined' && typeof localStorage !== 'undefined'

export const loadCache = (): TopicCache => {
  if (!isBrowser()) return {}
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as TopicCache
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

export const saveCache = (cache: TopicCache): void => {
  if (!isBrowser()) return
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(cache))
  } catch {
    // Quota exceeded or storage disabled — silently drop.
  }
}

export const isCacheFresh = (entry: CachedTopic | undefined): entry is CachedTopic => {
  return !!entry && Date.now() - entry.fetchedAt < TTL_MS
}

export const cacheAge = (entry: CachedTopic): number => Date.now() - entry.fetchedAt

export const formatAge = (ms: number): string => {
  if (ms < 60_000) return 'just now'
  const minutes = Math.floor(ms / 60_000)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  return `${hours}h ago`
}

export { TTL_MS as CACHE_TTL_MS }
