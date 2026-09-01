export const LAYOUT_MODES = Object.freeze(['auto', 'mobile', 'desktop'])
export const DEFAULT_LAYOUT_MODE = 'auto'
export const LAYOUT_STORAGE_KEY = 'miami.layoutMode'
export const LEGACY_LAYOUT_STORAGE_KEY = 'studentBookingPreferredViewMode'
export const LEGACY_LAYOUT_MODES = Object.freeze(['auto', 'mobile', 'desktop'])
export const MOBILE_BREAKPOINT_PX = 720
export const MOBILE_MEDIA_QUERY = `(max-width: ${MOBILE_BREAKPOINT_PX}px)`

export function parseLayoutMode(value) {
  return LAYOUT_MODES.includes(value) ? value : DEFAULT_LAYOUT_MODE
}

export function migrateLegacyLayoutMode(storage) {
  if (!storage || typeof storage.getItem !== 'function') return DEFAULT_LAYOUT_MODE

  try {
    const currentValue = storage.getItem(LAYOUT_STORAGE_KEY)
    if (LAYOUT_MODES.includes(currentValue)) return currentValue

    const legacyValue = storage.getItem(LEGACY_LAYOUT_STORAGE_KEY)
    if (!LEGACY_LAYOUT_MODES.includes(legacyValue)) return DEFAULT_LAYOUT_MODE

    try {
      storage.setItem(LAYOUT_STORAGE_KEY, legacyValue)
    } catch {
      return legacyValue
    }

    try {
      storage.removeItem?.(LEGACY_LAYOUT_STORAGE_KEY)
    } catch {
      // The new authoritative value was written successfully; stale legacy cleanup can retry later.
    }
    return legacyValue
  } catch {
    return DEFAULT_LAYOUT_MODE
  }
}

export function readStoredLayoutMode(storage) {
  return migrateLegacyLayoutMode(storage)
}

export function persistLayoutMode(storage, mode) {
  const parsed = parseLayoutMode(mode)
  if (!storage || typeof storage.setItem !== 'function') return parsed
  try {
    storage.setItem(LAYOUT_STORAGE_KEY, parsed)
    try {
      storage.removeItem?.(LEGACY_LAYOUT_STORAGE_KEY)
    } catch {
      // The current key is already authoritative; legacy cleanup is best effort.
    }
  } catch {
    // Keep the in-memory preference when browser storage is unavailable.
  }
  return parsed
}

export function resolveLayoutMode(mode, autoMatchesMobile) {
  const parsed = parseLayoutMode(mode)
  if (parsed === 'mobile') return 'mobile'
  if (parsed === 'desktop') return 'desktop'
  return autoMatchesMobile ? 'mobile' : 'desktop'
}

export function subscribeToMediaQuery(mediaQueryList, onChange) {
  if (!mediaQueryList || typeof onChange !== 'function') return () => {}
  const handleChange = (event) => onChange(Boolean(event?.matches))
  if (typeof mediaQueryList.addEventListener === 'function') {
    mediaQueryList.addEventListener('change', handleChange)
    return () => mediaQueryList.removeEventListener('change', handleChange)
  }
  if (typeof mediaQueryList.addListener === 'function') {
    mediaQueryList.addListener(handleChange)
    return () => mediaQueryList.removeListener(handleChange)
  }
  return () => {}
}

export const DIALOG_FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',')

function isVisibleFocusableElement(element) {
  if (!element || element.disabled || element.hidden) return false
  if (element.getAttribute?.('aria-hidden') === 'true') return false

  const view = element.ownerDocument?.defaultView
  const style = view?.getComputedStyle?.(element)
  if (style?.display === 'none' || style?.visibility === 'hidden') return false

  if (typeof element.getClientRects === 'function' && element.getClientRects().length === 0) {
    return false
  }
  return typeof element.focus === 'function'
}

export function getDialogFocusableElements(container) {
  if (!container || typeof container.querySelectorAll !== 'function') return []
  return [...container.querySelectorAll(DIALOG_FOCUSABLE_SELECTOR)].filter(
    isVisibleFocusableElement
  )
}

function isTopmostModalDialog(container, documentRef) {
  if (!documentRef || typeof documentRef.querySelectorAll !== 'function') return true
  const dialogs = [...documentRef.querySelectorAll('[role="dialog"][aria-modal="true"]')].filter(
    (dialog) => isVisibleFocusableElement(dialog) || dialog === container
  )
  return dialogs.length === 0 || dialogs[dialogs.length - 1] === container
}

function isolateDialogBackground(container, documentRef) {
  const records = []
  let current = container
  const body = documentRef?.body

  while (current?.parentElement && current !== body) {
    const parent = current.parentElement
    for (const sibling of parent.children || []) {
      if (sibling === current) continue
      records.push({
        element: sibling,
        ariaHidden: sibling.getAttribute?.('aria-hidden') ?? null,
        inert: Boolean(sibling.inert),
        inertAttribute: Boolean(sibling.hasAttribute?.('inert')),
      })
      sibling.inert = true
      sibling.setAttribute?.('inert', '')
      sibling.setAttribute?.('aria-hidden', 'true')
    }
    current = parent
  }

  return () => {
    for (const record of records.reverse()) {
      if (record.inertAttribute) record.element.setAttribute?.('inert', '')
      else record.element.removeAttribute?.('inert')
      record.element.inert = record.inert

      if (record.ariaHidden === null) record.element.removeAttribute?.('aria-hidden')
      else record.element.setAttribute?.('aria-hidden', record.ariaHidden)
    }
  }
}

export function installDialogFocusContainment({
  container,
  initialFocus,
  returnFocus,
  onClose,
  documentRef = globalThis.document,
}) {
  if (!container || !documentRef || typeof documentRef.addEventListener !== 'function') {
    return () => {}
  }

  const returnTarget = returnFocus || documentRef.activeElement
  const restoreBackground = isolateDialogBackground(container, documentRef)
  const focusables = getDialogFocusableElements(container)
  const initialTarget =
    initialFocus && container.contains?.(initialFocus) && isVisibleFocusableElement(initialFocus)
      ? initialFocus
      : focusables[0] || container
  initialTarget.focus?.()

  const handleKeyDown = (event) => {
    if (!isTopmostModalDialog(container, documentRef)) return

    if (event.key === 'Escape') {
      event.preventDefault()
      onClose?.()
      return
    }
    if (event.key !== 'Tab') return

    const available = getDialogFocusableElements(container)
    if (available.length === 0) {
      event.preventDefault()
      container.focus?.()
      return
    }

    const first = available[0]
    const last = available[available.length - 1]
    const activeElement = documentRef.activeElement
    const activeInside = container.contains?.(activeElement)

    if (event.shiftKey && (activeElement === first || !activeInside)) {
      event.preventDefault()
      last.focus()
    } else if (!event.shiftKey && (activeElement === last || !activeInside)) {
      event.preventDefault()
      first.focus()
    }
  }

  documentRef.addEventListener('keydown', handleKeyDown)
  return () => {
    documentRef.removeEventListener?.('keydown', handleKeyDown)
    restoreBackground()
    if (returnTarget?.isConnected !== false) returnTarget?.focus?.()
  }
}
