/**
 * App — global providers + shell.
 *
 * Generouted renders this around all routes.
 * Providers → auth gate → nav + page outlet.
 */

import { Suspense, type ReactNode } from 'react'
import { Outlet, useLocation } from 'react-router-dom'
import { DeepSpaceAuthProvider, useAuth } from 'deepspace'
import { RecordProvider, RecordScope } from 'deepspace'
import { ToastProvider } from '../components/ui'
import Navigation from '../components/Navigation'
import { APP_NAME, SCOPE_ID } from '../constants'
import { schemas } from '../schemas'

export default function App() {
  // The news page ships its own custom header (NewsHeader.tsx) — hide the
  // SDK's default <Navigation> on /news (and the / redirect that lands
  // there) so we don't stack two header bars on top of the page.
  const { pathname } = useLocation()
  const isNewsPage = pathname === '/news' || pathname === '/'

  return (
    <ToastProvider>
      <DeepSpaceAuthProvider>
        <AuthBoot>
          <div className="flex h-screen flex-col bg-background overflow-hidden">
            {!isNewsPage && <Navigation />}
            <main className="flex-1 overflow-y-auto min-h-0">
              <Suspense fallback={<div className="flex items-center justify-center h-full text-muted-foreground">Loading...</div>}>
                <Outlet />
              </Suspense>
            </main>
          </div>
        </AuthBoot>
      </DeepSpaceAuthProvider>
    </ToastProvider>
  )
}

/** Waits for auth to resolve, then mounts the data layer. Distinct from the SDK's `AuthGate`. */
function AuthBoot({ children }: { children: ReactNode }) {
  const { isLoaded } = useAuth()

  if (!isLoaded) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-background text-muted-foreground">
        Loading...
      </div>
    )
  }

  return (
    <RecordProvider allowAnonymous>
      <RecordScope roomId={SCOPE_ID} schemas={schemas} appId={APP_NAME}>
        {children}
      </RecordScope>
    </RecordProvider>
  )
}
