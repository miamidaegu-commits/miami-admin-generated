import en from './resources/en.js'
import ko from './resources/ko.js'

export const SUPPORTED_LANGUAGES = Object.freeze(['ko', 'en'])
export const DEFAULT_LANGUAGE = 'ko'
export const LANGUAGE_STORAGE_KEY = 'miami.language'
export const TRANSLATION_RESOURCES = Object.freeze({ ko, en })

export function parseLanguage(value) {
  return SUPPORTED_LANGUAGES.includes(value) ? value : DEFAULT_LANGUAGE
}

export function resolveLanguage({ accountLanguage, localLanguage } = {}) {
  if (SUPPORTED_LANGUAGES.includes(accountLanguage)) return accountLanguage
  return parseLanguage(localLanguage)
}

export function readStoredLanguage(storage) {
  if (!storage || typeof storage.getItem !== 'function') return DEFAULT_LANGUAGE
  try {
    return parseLanguage(storage.getItem(LANGUAGE_STORAGE_KEY))
  } catch {
    return DEFAULT_LANGUAGE
  }
}

export function persistLanguage(storage, language) {
  const parsed = parseLanguage(language)
  if (!storage || typeof storage.setItem !== 'function') return parsed
  try {
    storage.setItem(LANGUAGE_STORAGE_KEY, parsed)
  } catch {
    // Storage can be unavailable in private browsing; the in-memory choice still works.
  }
  return parsed
}

export function synchronizeDocumentLanguage(documentRef, language) {
  const documentElement = documentRef?.documentElement
  if (!documentElement) return () => {}

  const nextLanguage = parseLanguage(language)
  const previousLanguage = parseLanguage(documentElement.lang)
  documentElement.lang = nextLanguage

  return () => {
    if (documentElement.lang === nextLanguage) {
      documentElement.lang = previousLanguage
    }
  }
}

function interpolateText(template, params) {
  if (!params || typeof params !== 'object') return template
  return template.replace(/\{\{([a-zA-Z0-9_]+)\}\}/g, (_, name) => {
    const value = params[name]
    return value === null || value === undefined ? '' : String(value)
  })
}

export function translate(
  language,
  key,
  params,
  {
    resources = TRANSLATION_RESOURCES,
    development =
      import.meta.env?.DEV ?? globalThis.process?.env?.NODE_ENV !== 'production',
  } = {}
) {
  const parsedLanguage = parseLanguage(language)
  const template = resources[parsedLanguage]?.[key] ?? resources.ko?.[key]
  if (typeof template !== 'string') {
    return development ? `⟦missing:${key}⟧` : key
  }
  // This helper returns text only. React renders it as escaped text; raw HTML is never interpreted.
  return interpolateText(template, params)
}
