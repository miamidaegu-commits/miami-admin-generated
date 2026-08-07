import { Fragment, useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from '../i18n/LocalizationProvider.jsx'
import { useLayoutMode } from '../preferences/LayoutProvider.jsx'
import { installDialogFocusContainment } from '../preferences/layout.js'
import { SettingsControl } from './SettingsPanel.jsx'

function NavigationItems({ activeKey, items, onSelect }) {
  const { t } = useTranslation()
  return items.map((item) => (
    <button
      key={item.key}
      type="button"
      onClick={() => onSelect(item.key)}
      className={`nav-item ${activeKey === item.key ? 'active' : ''}`}
      aria-current={activeKey === item.key ? 'page' : undefined}
    >
      <span className="nav-dot" aria-hidden="true" />
      {t(item.labelKey)}
    </button>
  ))
}

export default function AuthenticatedShell({
  activeKey,
  children,
  menuItems,
  onLogout,
  onSelect,
  role,
  title,
  user,
}) {
  const { isMobile, resolvedLayout } = useLayoutMode()
  const { t } = useTranslation()
  const [drawerOpen, setDrawerOpen] = useState(false)
  const drawerCloseButtonRef = useRef(null)
  const drawerRef = useRef(null)
  const menuButtonRef = useRef(null)

  const closeDrawer = useCallback(() => setDrawerOpen(false), [])

  useEffect(() => {
    if (!drawerOpen) return undefined
    return installDialogFocusContainment({
      container: drawerRef.current,
      initialFocus: drawerCloseButtonRef.current,
      returnFocus: menuButtonRef.current,
      onClose: closeDrawer,
    })
  }, [closeDrawer, drawerOpen])

  useEffect(() => {
    if (!isMobile) setDrawerOpen(false)
  }, [isMobile])

  const selectAndClose = (key) => {
    onSelect(key)
    closeDrawer()
  }

  const account = (
    <div className="user-chip">
      <div className="avatar">
        {user?.email?.[0]?.toUpperCase() || t('shell.accountInitialFallback')}
      </div>
      <div className="user-info">
        <span className="user-email">{user?.email || t('shell.emailUnavailable')}</span>
        <span className="user-role">{role || t('shell.roleUnavailable')}</span>
      </div>
    </div>
  )

  return (
    <Fragment>
      {!isMobile ? (
        <aside className="sidebar" data-testid="desktop-sidebar">
          <div className="sidebar-logo">
            <span className="logo-icon" aria-hidden="true">⬡</span>
            <span className="logo-text">{t('app.name')}</span>
          </div>
          <nav className="sidebar-nav" aria-label={t('common.navigation')}>
            <NavigationItems activeKey={activeKey} items={menuItems} onSelect={onSelect} />
          </nav>
          <div className="sidebar-footer">
            {account}
            <SettingsControl className="btn-signout" />
            <button type="button" className="btn-signout" onClick={onLogout}>
              {t('common.logout')}
            </button>
          </div>
        </aside>
      ) : (
        <>
          <header className="mobile-shell-header" data-testid="mobile-shell-header">
            <button
              ref={menuButtonRef}
              type="button"
              className="icon-button"
              aria-label={t('common.menu')}
              aria-expanded={drawerOpen}
              aria-controls="mobile-shell-drawer"
              onClick={() => setDrawerOpen(true)}
            >
              ☰
            </button>
            <strong>{title}</strong>
            <SettingsControl className="icon-button" label={t('common.settings')}>
              <span aria-hidden="true">⚙</span>
              <span className="sr-only">{t('common.settings')}</span>
            </SettingsControl>
          </header>
          {drawerOpen ? (
            <div className="mobile-drawer-backdrop" onPointerDown={(event) => {
              if (event.target === event.currentTarget) closeDrawer()
            }}>
              <aside
                ref={drawerRef}
                id="mobile-shell-drawer"
                className="mobile-drawer"
                role="dialog"
                aria-modal="true"
                aria-label={t('common.navigation')}
                tabIndex={-1}
                data-testid="mobile-shell-drawer"
              >
                <div className="mobile-drawer-header">
                  <span className="logo-text">{t('app.name')}</span>
                  <button
                    ref={drawerCloseButtonRef}
                    type="button"
                    className="icon-button"
                    onClick={closeDrawer}
                    aria-label={t('common.close')}
                  >
                    ×
                  </button>
                </div>
                <nav className="sidebar-nav" aria-label={t('common.navigation')}>
                  <NavigationItems
                    activeKey={activeKey}
                    items={menuItems}
                    onSelect={selectAndClose}
                  />
                </nav>
                <div className="sidebar-footer">
                  {account}
                  <SettingsControl className="btn-signout" />
                  <button type="button" className="btn-signout" onClick={onLogout}>
                    {t('common.logout')}
                  </button>
                </div>
              </aside>
            </div>
          ) : null}
        </>
      )}
      <span className="sr-only" data-layout={resolvedLayout}>
        {t('shell.currentLayout', {
          layout: t(`settings.layout.${resolvedLayout}`),
        })}
      </span>
      {children}
    </Fragment>
  )
}
