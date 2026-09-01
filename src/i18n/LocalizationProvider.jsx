import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { useAuth } from '../../AuthContext.jsx'
import { debugWarn } from '../utils/debugLog.js'
import {
  DEFAULT_LANGUAGE,
  parseLanguage,
  persistLanguage,
  readStoredLanguage,
  synchronizeDocumentLanguage,
  translate,
} from './core.js'
import {
  readAccountLanguage,
} from '../preferences/accountLanguage.js'
import { persistAccountLanguageToFirestore } from '../preferences/accountLanguageFirestore.js'

const LocalizationContext = createContext(null)

function getBrowserStorage() {
  if (typeof window === 'undefined') return null
  return window.localStorage
}

export function LocalizationProvider({ children }) {
  const { globalUserProfile, user } = useAuth()
  const [language, setLanguageState] = useState(() => readStoredLanguage(getBrowserStorage()))
  const accountLanguage = readAccountLanguage(globalUserProfile)

  useEffect(() => {
    if (!accountLanguage) return
    setLanguageState(accountLanguage)
    persistLanguage(getBrowserStorage(), accountLanguage)
  }, [accountLanguage])

  useEffect(() => {
    if (typeof document === 'undefined') return undefined
    return synchronizeDocumentLanguage(document, language)
  }, [language])

  const setLanguage = useCallback(
    async (nextLanguage, { syncAccount = true } = {}) => {
      const parsed = parseLanguage(nextLanguage)
      setLanguageState(parsed)
      persistLanguage(getBrowserStorage(), parsed)

      if (syncAccount && user?.uid) {
        try {
          await persistAccountLanguageToFirestore({ uid: user.uid, language: parsed })
        } catch (error) {
          // Local preference remains authoritative for this device if the guarded self-update is denied.
          debugWarn('[LocalizationProvider] preferredLanguage 저장 실패:', error)
        }
      }
      return parsed
    },
    [user?.uid]
  )

  const t = useCallback(
    (key, params) => translate(language, key, params),
    [language]
  )

  const value = useMemo(
    () => ({
      language,
      setLanguage,
      supportedLanguages: ['ko', 'en'],
      t,
    }),
    [language, setLanguage, t]
  )

  return (
    <LocalizationContext.Provider value={value}>
      {children}
    </LocalizationContext.Provider>
  )
}

export function useTranslation() {
  const context = useContext(LocalizationContext)
  if (!context) {
    throw new Error('useTranslation must be used within LocalizationProvider')
  }
  return context
}

export { DEFAULT_LANGUAGE }
