import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from '../i18n/LocalizationProvider.jsx'
import { useLayoutMode } from '../preferences/LayoutProvider.jsx'
import { installDialogFocusContainment } from '../preferences/layout.js'

const LANGUAGE_OPTIONS = ['ko', 'en']
const LAYOUT_OPTIONS = ['auto', 'mobile', 'desktop']

export function SettingsPanel({ open, onClose, returnFocusRef }) {
  const { language, setLanguage, t } = useTranslation()
  const { layoutMode, setLayoutMode } = useLayoutMode()
  const closeButtonRef = useRef(null)
  const panelRef = useRef(null)

  useEffect(() => {
    if (!open) return undefined
    return installDialogFocusContainment({
      container: panelRef.current,
      initialFocus: closeButtonRef.current,
      returnFocus: returnFocusRef?.current,
      onClose,
    })
  }, [onClose, open, returnFocusRef])

  if (!open) return null

  return (
    <div className="settings-backdrop" onPointerDown={(event) => {
      if (event.target === event.currentTarget) onClose()
    }}>
      <section
        ref={panelRef}
        className="settings-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-title"
        tabIndex={-1}
        data-testid="settings-panel"
      >
        <header className="settings-panel-header">
          <h2 id="settings-title">{t('settings.title')}</h2>
          <button
            ref={closeButtonRef}
            type="button"
            className="icon-button"
            onClick={onClose}
            aria-label={t('common.close')}
          >
            ×
          </button>
        </header>

        <fieldset className="settings-group">
          <legend>{t('settings.language')}</legend>
          <p>{t('settings.languageDescription')}</p>
          <div className="settings-option-grid">
            {LANGUAGE_OPTIONS.map((option) => (
              <button
                key={option}
                type="button"
                className={`settings-option ${language === option ? 'selected' : ''}`}
                aria-pressed={language === option}
                data-testid={`settings-language-${option}`}
                onClick={() => setLanguage(option)}
              >
                {t(`settings.language.${option}`)}
              </button>
            ))}
          </div>
        </fieldset>

        <fieldset className="settings-group">
          <legend>{t('settings.layout')}</legend>
          <p>{t('settings.layoutDescription')}</p>
          <div className="settings-option-grid settings-option-grid--layout">
            {LAYOUT_OPTIONS.map((option) => (
              <button
                key={option}
                type="button"
                className={`settings-option ${layoutMode === option ? 'selected' : ''}`}
                aria-pressed={layoutMode === option}
                data-testid={`settings-layout-${option}`}
                onClick={() => setLayoutMode(option)}
              >
                <span>{t(`settings.layout.${option}`)}</span>
                <small>{t(`settings.layout.${option}Description`)}</small>
              </button>
            ))}
          </div>
        </fieldset>
      </section>
    </div>
  )
}

export function SettingsControl({ className = '', label, children }) {
  const [open, setOpen] = useState(false)
  const triggerRef = useRef(null)
  const { t } = useTranslation()
  const close = useCallback(() => setOpen(false), [])

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className={className || 'settings-trigger'}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen(true)}
        data-testid="settings-trigger"
      >
        {children || label || t('common.settings')}
      </button>
      <SettingsPanel
        open={open}
        onClose={close}
        returnFocusRef={triggerRef}
      />
    </>
  )
}
