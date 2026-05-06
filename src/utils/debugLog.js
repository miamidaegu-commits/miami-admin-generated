const debugFlag = String(import.meta.env.VITE_DEBUG_LOGS || '').trim().toLowerCase()

export const debugLogsEnabled =
  debugFlag === 'true' || debugFlag === '1' || debugFlag === 'yes' || import.meta.env.DEV === true

export function debugLog(...args) {
  if (debugLogsEnabled) console.log(...args)
}

export function debugWarn(...args) {
  if (debugLogsEnabled) console.warn(...args)
}

export function debugError(...args) {
  if (debugLogsEnabled) console.error(...args)
}
