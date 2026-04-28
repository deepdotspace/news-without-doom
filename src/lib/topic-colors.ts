/**
 * Per-topic color themes.
 *
 * Each topic gets its own primary accent — applied by overriding the
 * `--color-primary` family of CSS vars on the news-page wrapper, so every
 * existing token-driven accent (bullet dots, source chips, hero label,
 * active topic chip, ring focus, etc.) auto-recolors per topic.
 *
 * All hues are warm/earthy to stay coherent with the cream Warm Editorial
 * background — no clashing pop colors.
 */

import type { CSSProperties } from 'react'

export interface TopicTheme {
  primary: string
  primaryHover: string
  primaryMuted: string
  primaryBorder: string
  ring: string
  /** Optional one-word vibe label (debug / future tooltip use). */
  vibe: string
}

export const TOPIC_THEMES: Record<string, TopicTheme> = {
  Tech: {
    primary: '#d97706',
    primaryHover: '#b45309',
    primaryMuted: 'rgba(217, 119, 6, 0.12)',
    primaryBorder: 'rgba(217, 119, 6, 0.25)',
    ring: 'rgba(217, 119, 6, 0.4)',
    vibe: 'amber',
  },
  Business: {
    primary: '#4d7c0f',
    primaryHover: '#3f6212',
    primaryMuted: 'rgba(77, 124, 15, 0.12)',
    primaryBorder: 'rgba(77, 124, 15, 0.25)',
    ring: 'rgba(77, 124, 15, 0.4)',
    vibe: 'olive',
  },
  Science: {
    primary: '#6d28d9',
    primaryHover: '#5b21b6',
    primaryMuted: 'rgba(109, 40, 217, 0.12)',
    primaryBorder: 'rgba(109, 40, 217, 0.25)',
    ring: 'rgba(109, 40, 217, 0.4)',
    vibe: 'violet',
  },
  Markets: {
    primary: '#92400e',
    primaryHover: '#78350f',
    primaryMuted: 'rgba(146, 64, 14, 0.12)',
    primaryBorder: 'rgba(146, 64, 14, 0.25)',
    ring: 'rgba(146, 64, 14, 0.4)',
    vibe: 'bronze',
  },
  Sports: {
    primary: '#b91c1c',
    primaryHover: '#991b1b',
    primaryMuted: 'rgba(185, 28, 28, 0.12)',
    primaryBorder: 'rgba(185, 28, 28, 0.25)',
    ring: 'rgba(185, 28, 28, 0.4)',
    vibe: 'terracotta',
  },
  Local: {
    primary: '#0d9488',
    primaryHover: '#0f766e',
    primaryMuted: 'rgba(13, 148, 136, 0.12)',
    primaryBorder: 'rgba(13, 148, 136, 0.25)',
    ring: 'rgba(13, 148, 136, 0.4)',
    vibe: 'teal',
  },
}

export const getTopicTheme = (topic: string): TopicTheme =>
  TOPIC_THEMES[topic] ?? TOPIC_THEMES.Tech

/**
 * Build the inline-style object that overrides the relevant `--color-*`
 * tokens just for the news page subtree. Keeps the rest of the app on its
 * default theme.
 */
export const topicCssVars = (theme: TopicTheme): CSSProperties =>
  ({
    '--color-primary': theme.primary,
    '--color-primary-hover': theme.primaryHover,
    '--color-primary-muted': theme.primaryMuted,
    '--color-primary-border': theme.primaryBorder,
    '--color-ring': theme.ring,
  }) as CSSProperties
