import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import {
  MOBILE_MEDIA_QUERY,
  parseLayoutMode,
  persistLayoutMode,
  readStoredLayoutMode,
  resolveLayoutMode,
  subscribeToMediaQuery,
} from './layout.js'

const LayoutContext = createContext(null)

function getBrowserStorage() {
  return typeof window === 'undefined' ? null : window.localStorage
}

function getInitialAutoMatch() {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false
  return window.matchMedia(MOBILE_MEDIA_QUERY).matches
}

export function LayoutProvider({ children }) {
  const [layoutMode, setLayoutModeState] = useState(() =>
    readStoredLayoutMode(getBrowserStorage())
  )
  const [autoMatchesMobile, setAutoMatchesMobile] = useState(getInitialAutoMatch)

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return undefined
    const mediaQueryList = window.matchMedia(MOBILE_MEDIA_QUERY)
    setAutoMatchesMobile(mediaQueryList.matches)
    return subscribeToMediaQuery(mediaQueryList, setAutoMatchesMobile)
  }, [])

  const setLayoutMode = useCallback((nextMode) => {
    const parsed = parseLayoutMode(nextMode)
    setLayoutModeState(parsed)
    persistLayoutMode(getBrowserStorage(), parsed)
    return parsed
  }, [])

  const resolvedLayout = resolveLayoutMode(layoutMode, autoMatchesMobile)
  const value = useMemo(
    () => ({
      isMobile: resolvedLayout === 'mobile',
      layoutMode,
      resolvedLayout,
      setLayoutMode,
    }),
    [layoutMode, resolvedLayout, setLayoutMode]
  )

  return <LayoutContext.Provider value={value}>{children}</LayoutContext.Provider>
}

export function useLayoutMode() {
  const context = useContext(LayoutContext)
  if (!context) throw new Error('useLayoutMode must be used within LayoutProvider')
  return context
}
