/**
 * NewsHeader — masthead-style header for the news page.
 *
 * Editorial newspaper masthead vibe:
 *   - Row 1: serif wordmark + small tagline (left)   |   actions + avatar (right)
 *   - Topic-colored hairline rule (animated on topic change)
 *   - Row 2: topic chips (left)                      |   filter pills (right)
 *
 * Settings + Sign-out live in the avatar dropdown so we keep one row of
 * meta-chrome and one row of content controls. Framer Motion handles the
 * subtle entrance + topic-color transition on the hairline rule.
 */

import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { signOut, useAuth, useUser } from 'deepspace'
import { getTopicTheme } from '../lib/topic-colors'

interface NewsHeaderProps {
  topics: readonly string[]
  selectedTopic: string
  onSelectTopic: (topic: string) => void

  filterOptions: readonly string[]
  negativityFilter: string
  onChangeFilter: (option: string) => void

  updating: boolean
  onRefresh: () => void

  savedCount: number
  onToggleSaved: () => void

  /** When falsy, header swaps Saved + UserMenu for a single Sign-in pill. */
  isSignedIn: boolean
  onSignIn: () => void
}

const SOFT_EASE = [0.16, 1, 0.3, 1] as const

export default function NewsHeader({
  topics,
  selectedTopic,
  onSelectTopic,
  filterOptions,
  negativityFilter,
  onChangeFilter,
  updating,
  onRefresh,
  savedCount,
  onToggleSaved,
  isSignedIn,
  onSignIn,
}: NewsHeaderProps) {
  const theme = getTopicTheme(selectedTopic)

  return (
    <header className="sticky top-0 z-30 bg-background/80 backdrop-blur-xl">
      {/* Masthead row */}
      <div className="mx-auto flex max-w-5xl items-center justify-between gap-6 px-5 py-4 sm:px-8 sm:py-5">
        <Link
          to="/news"
          className="group inline-flex items-baseline font-serif text-[22px] leading-none tracking-tight text-foreground sm:text-[26px]"
          aria-label="News Without Doom — home"
        >
          <span className="font-bold">News</span>
          <span
            aria-hidden
            className="mx-[0.25em] font-normal italic text-muted-foreground transition-colors group-hover:text-[color:var(--color-primary)]"
          >
            without
          </span>
          <span className="font-bold">Doom</span>
        </Link>
        <div className="flex shrink-0 items-center gap-2">
          <RefreshButton updating={updating} onClick={onRefresh} />
          {isSignedIn ? (
            <>
              <SavedButton count={savedCount} onClick={onToggleSaved} />
              <UserMenu />
            </>
          ) : (
            <SignInPill onClick={onSignIn} />
          )}
        </div>
      </div>

      {/* Topic-colored hairline — animates color on topic change */}
      <motion.div
        className="mx-auto h-px max-w-5xl px-5 sm:px-8"
        animate={{}}
      >
        <motion.div
          className="h-px w-full"
          animate={{ backgroundColor: theme.primary }}
          transition={{ duration: 0.6, ease: SOFT_EASE }}
        />
      </motion.div>

      {/* Controls row */}
      <div className="mx-auto flex max-w-5xl items-center gap-4 overflow-x-auto px-5 py-3 sm:px-8 [&::-webkit-scrollbar]:hidden">
        <nav className="flex shrink-0 items-center gap-0.5">
          {topics.map((topic) => {
            const isActive = topic === selectedTopic
            const topicAccent = getTopicTheme(topic).primary
            return (
              <button
                key={topic}
                onClick={() => onSelectTopic(topic)}
                className="relative shrink-0 rounded-full px-3 py-1.5 text-[12.5px] font-medium transition-colors"
                style={{
                  color: isActive ? '#fff' : 'var(--color-muted-foreground)',
                }}
              >
                {isActive && (
                  <motion.span
                    layoutId="topic-pill"
                    className="absolute inset-0 rounded-full"
                    style={{ backgroundColor: topicAccent }}
                    transition={{ type: 'spring', stiffness: 280, damping: 30, mass: 0.9 }}
                  />
                )}
                <span className="relative">{topic}</span>
              </button>
            )
          })}
        </nav>

        {isSignedIn && (
          <div
            className="ml-auto flex shrink-0 items-center gap-0.5 rounded-full bg-secondary p-0.5"
            role="radiogroup"
            aria-label="Tone filter"
          >
            {filterOptions.map((option) => {
              const isActive = negativityFilter === option
              return (
                <button
                  key={option}
                  onClick={() => onChangeFilter(option)}
                  role="radio"
                  aria-checked={isActive}
                  title={
                    option === 'All'
                      ? 'Show every headline'
                      : option === 'Lighter'
                        ? 'Hide highly-negative items'
                        : 'Only show light, neutral items'
                  }
                  className="relative shrink-0 rounded-full px-3 py-0.5 text-[11px] font-medium transition-colors"
                  style={{
                    color: isActive ? 'var(--color-foreground)' : 'var(--color-muted-foreground)',
                  }}
                >
                  {isActive && (
                    <motion.span
                      layoutId="filter-pill"
                      className="absolute inset-0 rounded-full bg-card shadow-sm"
                      transition={{ type: 'spring', stiffness: 280, damping: 30, mass: 0.9 }}
                    />
                  )}
                  <span className="relative">{option}</span>
                </button>
              )
            })}
          </div>
        )}
      </div>
    </header>
  )
}

// ─── Refresh ─────────────────────────────────────────────────────────────

function RefreshButton({ updating, onClick }: { updating: boolean; onClick: () => void }) {
  return (
    <motion.button
      onClick={onClick}
      title="Refresh headlines"
      whileHover={{ scale: 1.06 }}
      whileTap={{ scale: 0.94 }}
      transition={{ duration: 0.25, ease: SOFT_EASE }}
      className="flex h-9 w-9 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
    >
      <svg
        className={`h-3.5 w-3.5 ${updating ? 'animate-spin text-[var(--color-primary)]' : ''}`}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={2.2}
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M21 12a9 9 0 0 0-15.5-6.4L3 8" />
        <path d="M3 3v5h5" />
        <path d="M3 12a9 9 0 0 0 15.5 6.4L21 16" />
        <path d="M21 21v-5h-5" />
      </svg>
    </motion.button>
  )
}

// ─── Sign-in pill (anonymous users) ──────────────────────────────────────

function SignInPill({ onClick }: { onClick: () => void }) {
  return (
    <motion.button
      onClick={onClick}
      whileHover={{ scale: 1.03 }}
      whileTap={{ scale: 0.97 }}
      transition={{ duration: 0.25, ease: SOFT_EASE }}
      className="flex h-9 items-center gap-1.5 rounded-full px-4 text-[12.5px] font-semibold text-primary-foreground shadow-sm transition-opacity hover:opacity-90"
      style={{ backgroundColor: 'var(--color-primary)' }}
    >
      Sign in
    </motion.button>
  )
}

// ─── Saved ───────────────────────────────────────────────────────────────

function SavedButton({ count, onClick }: { count: number; onClick: () => void }) {
  return (
    <motion.button
      onClick={onClick}
      title="Saved for later"
      whileHover={{ scale: 1.04 }}
      whileTap={{ scale: 0.96 }}
      transition={{ duration: 0.25, ease: SOFT_EASE }}
      className="relative flex h-9 items-center gap-1.5 rounded-full px-3 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
    >
      <svg
        className="h-3.5 w-3.5"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={2.2}
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="m19 21-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" />
      </svg>
      <AnimatePresence>
        {count > 0 && (
          <motion.span
            key="count"
            initial={{ opacity: 0, scale: 0.7 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.7 }}
            transition={{ duration: 0.3, ease: SOFT_EASE }}
            className="text-[11px] font-medium tabular-nums text-foreground"
          >
            {count}
          </motion.span>
        )}
      </AnimatePresence>
    </motion.button>
  )
}

// ─── User menu (avatar dropdown) ─────────────────────────────────────────

function UserMenu() {
  const { user } = useUser()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!open) return
    const handler = (event: MouseEvent) => {
      if (!ref.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  const initial = user?.name?.[0]?.toUpperCase() ?? user?.email?.[0]?.toUpperCase() ?? '?'

  return (
    <div ref={ref} className="relative">
      <motion.button
        onClick={() => setOpen((v) => !v)}
        whileHover={{ scale: 1.04 }}
        whileTap={{ scale: 0.96 }}
        transition={{ duration: 0.25, ease: SOFT_EASE }}
        className="flex h-9 w-9 items-center justify-center overflow-hidden rounded-full bg-secondary text-[12px] font-medium text-foreground transition-colors hover:bg-muted"
        aria-label="Account menu"
      >
        {user?.imageUrl ? (
          <img
            src={user.imageUrl}
            alt=""
            referrerPolicy="no-referrer"
            className="h-9 w-9 rounded-full object-cover"
          />
        ) : (
          initial
        )}
      </motion.button>
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -4, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -4, scale: 0.97 }}
            transition={{ duration: 0.32, ease: SOFT_EASE }}
            className="absolute right-0 top-full z-40 mt-2 w-56 origin-top-right overflow-hidden rounded-xl border border-border bg-popover shadow-lg"
          >
            {user && (
              <div className="border-b border-border/60 px-4 py-3">
                <div className="truncate text-[13px] font-medium text-foreground">
                  {user.name ?? user.email}
                </div>
                {user.email && user.name && (
                  <div className="truncate text-[11px] text-muted-foreground">{user.email}</div>
                )}
              </div>
            )}
            <Link
              to="/settings"
              onClick={() => setOpen(false)}
              className="block w-full px-4 py-2 text-left text-[13px] text-foreground transition-colors hover:bg-secondary"
            >
              Settings
            </Link>
            <button
              onClick={() => {
                setOpen(false)
                signOut()
              }}
              className="block w-full px-4 py-2 text-left text-[13px] text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
            >
              Sign out
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
