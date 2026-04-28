/**
 * NewsHeader — sticky glass-blur header for the news page.
 *
 * Replaces the SDK's default <Navigation> on /news. Holds:
 *   - serif wordmark (left)
 *   - topic chips (center, scroll-x on mobile)
 *   - filter pills, refresh, saved counter, avatar dropdown (right)
 *
 * Settings + Sign out live in the avatar dropdown so we keep one row of
 * chrome. Gear icon is intentionally absent — the user menu is the
 * single entry point to everything outside the news view.
 */

import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { signOut, useUser } from 'deepspace'

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
}

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
}: NewsHeaderProps) {
  return (
    <header className="sticky top-0 z-30 border-b border-border/60 bg-background/80 backdrop-blur-xl">
      {/* Row 1 — wordmark + user menu */}
      <div className="mx-auto flex max-w-5xl items-center justify-between px-5 py-3 sm:px-8">
        <Link
          to="/news"
          className="font-serif text-[17px] font-semibold tracking-tight text-foreground hover:text-primary transition-colors"
        >
          News Without Doom
        </Link>
        <div className="flex items-center gap-3">
          <RefreshButton updating={updating} onClick={onRefresh} />
          <SavedButton count={savedCount} onClick={onToggleSaved} />
          <UserMenu />
        </div>
      </div>

      {/* Row 2 — topics + filter */}
      <div className="mx-auto flex max-w-5xl items-center gap-4 overflow-x-auto px-5 pb-3 sm:px-8 [&::-webkit-scrollbar]:hidden">
        <nav className="flex items-center gap-1">
          {topics.map((topic) => {
            const isActive = topic === selectedTopic
            return (
              <button
                key={topic}
                onClick={() => onSelectTopic(topic)}
                className={`relative shrink-0 rounded-full px-3 py-1 text-[13px] font-medium transition-colors ${
                  isActive
                    ? 'bg-foreground text-background'
                    : 'text-muted-foreground hover:bg-secondary hover:text-foreground'
                }`}
              >
                {topic}
              </button>
            )
          })}
        </nav>

        <div className="ml-auto flex shrink-0 items-center gap-1 rounded-full bg-secondary p-0.5">
          {filterOptions.map((option) => (
            <button
              key={option}
              onClick={() => onChangeFilter(option)}
              className={`shrink-0 rounded-full px-2.5 py-0.5 text-[11px] font-medium transition-colors ${
                negativityFilter === option
                  ? 'bg-card text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
              title={
                option === 'Off'
                  ? 'Show all headlines'
                  : option === 'Light'
                    ? 'Hide highly negative items'
                    : 'Only show calm items'
              }
            >
              {option}
            </button>
          ))}
        </div>
      </div>
    </header>
  )
}

// ─── Refresh ─────────────────────────────────────────────────────────────

function RefreshButton({ updating, onClick }: { updating: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      title="Refresh headlines"
      className="group flex h-8 w-8 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
    >
      <svg
        className={`h-3.5 w-3.5 ${updating ? 'animate-spin text-primary' : ''}`}
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
    </button>
  )
}

// ─── Saved ───────────────────────────────────────────────────────────────

function SavedButton({ count, onClick }: { count: number; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      title="Saved for later"
      className="relative flex h-8 items-center gap-1.5 rounded-full px-2.5 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
    >
      <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
        <path d="m19 21-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" />
      </svg>
      {count > 0 && (
        <span className="text-[11px] font-medium tabular-nums text-foreground">{count}</span>
      )}
    </button>
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
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex h-8 w-8 items-center justify-center overflow-hidden rounded-full bg-secondary text-[12px] font-medium text-foreground transition-colors hover:bg-muted"
        aria-label="Account menu"
      >
        {user?.imageUrl ? (
          <img src={user.imageUrl} alt="" referrerPolicy="no-referrer" className="h-8 w-8 rounded-full object-cover" />
        ) : (
          initial
        )}
      </button>
      {open && (
        <div className="absolute right-0 top-full z-40 mt-2 w-56 overflow-hidden rounded-xl border border-border bg-popover shadow-lg">
          {user && (
            <div className="border-b border-border/60 px-4 py-3">
              <div className="truncate text-[13px] font-medium text-foreground">{user.name ?? user.email}</div>
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
        </div>
      )}
    </div>
  )
}
