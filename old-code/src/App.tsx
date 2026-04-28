/**
 * News Without Doom — Main App
 *
 * Navigation shell with routing.
 * News logic lives in src/pages/HomePage.tsx
 * Permissions page in src/pages/PermissionsPage.tsx
 */

import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { useUser } from '@spaces/sdk/storage'

import HomePage from './pages/HomePage'
import PermissionsPage from './pages/PermissionsPage'

// ============================================================================
// App
// ============================================================================

export default function App() {
  const { isLoading } = useUser()

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-background" style={{ fontFamily: 'sans-serif' }}>
        <div className="w-8 h-8 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
      </div>
    )
  }

  return (
    <BrowserRouter>
      <div className="bg-background h-screen overflow-hidden">
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/permissions" element={<PermissionsPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </div>
    </BrowserRouter>
  )
}
