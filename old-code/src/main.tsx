import { createRoot } from 'react-dom/client'
import { SpacesAuthProvider, PillCoordinatorProvider } from '@spaces/sdk'
import { isWidgetContext, getWidgetAuthToken } from '@spaces/sdk/auth'
import { RecordProvider, type UserProfile } from '@spaces/sdk/storage'
import { getApiUrl } from '@spaces/sdk/config'
import App from './App'
import './styles.css'

const inCanvas = isWidgetContext()

// Legacy widgets get schemas + roomId from window.__WIDGET_CONFIG__
// (injected by the parent canvas via postMessage)
const widgetConfig = typeof window !== 'undefined'
  ? (window as any).__WIDGET_CONFIG__
  : null
const roomId = widgetConfig?.roomId || 'legacy-widget'
const schemas = widgetConfig?.schemas || []

/** Fetch user profile via postMessage auth (canvas widgets). */
async function fetchUserViaPostMessage(): Promise<UserProfile> {
  const token = await getWidgetAuthToken()
  if (!token) throw new Error('No auth token from parent')
  const apiUrl = getApiUrl()
  const res = await fetch(apiUrl + '/api/users/me', {
    headers: { Authorization: 'Bearer ' + token },
  })
  if (!res.ok) throw new Error('Failed to fetch user: ' + res.status)
  return res.json()
}

function LegacyWidgetApp() {
  return (
    <RecordProvider
      roomId={roomId}
      schemas={schemas}
      fetchUser={inCanvas ? fetchUserViaPostMessage : undefined}
      allowAnonymous
    >
      <App />
    </RecordProvider>
  )
}

createRoot(document.getElementById('root')!).render(
  inCanvas ? (
    <PillCoordinatorProvider>
      <LegacyWidgetApp />
    </PillCoordinatorProvider>
  ) : (
    <SpacesAuthProvider>
      <PillCoordinatorProvider>
        <LegacyWidgetApp />
      </PillCoordinatorProvider>
    </SpacesAuthProvider>
  ),
)
