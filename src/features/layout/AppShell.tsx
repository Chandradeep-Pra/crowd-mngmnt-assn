import { Select } from '../../components/ui/Select.tsx'
import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { Bell, CircleUserRound, LayoutDashboard, LogOut, MapPin, Menu, ScanLine, X } from 'lucide-react'
import type { Site } from '../../api/contracts.ts'
import { Button, IconButton } from '../../components/ui/Controls.tsx'
import { EmptyState, StatusBadge } from '../../components/ui/Display.tsx'
import { brandAssets } from '../../theme/brand.ts'
import type { LiveState } from '../shared/use-realtime.ts'
import { MovementList } from '../shared/MovementList.tsx'

export type Page = 'overview' | 'entries'
export function AppShell({ page, site, sites, onSiteChange, onLogout, live, children }: {
  page: Page; site?: Site; sites: Site[]; onSiteChange: (id: string) => void; onLogout: () => void; live?: LiveState; children: ReactNode
}) {
  const drawer = useRef<HTMLDialogElement>(null)
  const activity = useRef<HTMLDialogElement>(null)
  const account = useRef<HTMLDetailsElement>(null)
  const content = useRef<HTMLElement>(null)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [activityOpen, setActivityOpen] = useState(false)
  useEffect(() => {
    content.current?.focus({ preventScroll: true })
    window.scrollTo({ top: 0, behavior: 'instant' })
    document.title = `${page === 'overview' ? 'Overview' : 'Crowd Entries'} | Kloudspot`
  }, [page])
  useEffect(() => {
    const details = account.current
    const outside = (event: Event) => {
      if (details?.open && event.target instanceof Node && !details.contains(event.target)) details.open = false
    }
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && details?.open) {
        details.open = false
        details.querySelector('summary')?.focus()
        event.stopPropagation()
      }
    }
    document.addEventListener('pointerdown', outside)
    document.addEventListener('focusin', outside)
    details?.addEventListener('keydown', escape)
    return () => {
      document.removeEventListener('pointerdown', outside)
      document.removeEventListener('focusin', outside)
      details?.removeEventListener('keydown', escape)
    }
  }, [])
  const links = <nav aria-label="Main navigation">{([{ page: 'overview', label: 'Overview', icon: LayoutDashboard }, { page: 'entries', label: 'Crowd Entries', icon: ScanLine }] as const).map(({ page: target, label, icon: Icon }) => <a href={`#/${target}`} key={target} aria-current={page === target ? 'page' : undefined} onClick={() => drawer.current?.close()}><Icon size={21} aria-hidden="true" />{label}</a>)}</nav>
  return <div className="app-shell">
    <a className="app-skip" href="#main-content">Skip to content</a>
    <aside className="app-sidebar" style={{ backgroundImage: `url(${brandAssets.sidebarBackground})` }}><a className="app-brand" href="#/overview" aria-label="Kloudspot overview"><img className="ui-brand-logo" src={brandAssets.logoWhite} alt="Kloudspot" width="160" height="48" /></a>{links}<div className="sidebar-bottom"><p>{site?.name || 'Crowd Management'}<span>{site?.timezone || 'Workspace'}</span></p><button className="sidebar-logout" onClick={onLogout}><LogOut size={20} aria-hidden="true" />Logout</button></div></aside>
    <dialog className="app-nav-dialog" ref={drawer} aria-label="Navigation" onClose={() => setDrawerOpen(false)}><div className="app-mobile-sidebar" style={{ backgroundImage: `url(${brandAssets.sidebarBackground})` }}><div className="app-drawer-heading"><img src={brandAssets.logoWhite} className="ui-brand-logo" alt="Kloudspot" width="160" height="48" /><IconButton label="Close navigation" onClick={() => drawer.current?.close()}><X size={22} /></IconButton></div>{links}<button className="sidebar-logout" onClick={onLogout}><LogOut size={20} aria-hidden="true" />Logout</button></div></dialog>
    <div className="app-workspace"><header className="app-header"><div className="app-header-main"><IconButton className="app-mobile-menu" label="Open navigation" aria-haspopup="dialog" aria-expanded={drawerOpen} onClick={() => { drawer.current?.showModal(); setDrawerOpen(true) }}><Menu size={22} /></IconButton><strong className="app-product-name">Crowd Solutions</strong><span className="app-header-rule" aria-hidden="true" />{sites.length > 0 && <Select id="site-selector" className="app-site-picker" label="Site" hideLabel icon={<MapPin size={17} />} value={site?.siteId ?? ''} onValueChange={onSiteChange} options={sites.filter(item => item.siteId).map(item => ({ value: item.siteId!, label: item.name || 'Unnamed site', description: [item.city, item.country].filter(Boolean).join(', ') }))} />}</div><div className="app-header-actions">{live && <StatusBadge tone={live.status === 'connected' ? 'success' : 'neutral'}>{live.status === 'connected' ? 'Connected' : live.status === 'connecting' ? 'Connecting' : 'Offline'}</StatusBadge>}<IconButton label={`Recent movement${live ? `, ${live.alerts.length} retained events` : ''}`} disabled={!site} onClick={() => { setActivityOpen(true); activity.current?.showModal() }}><Bell size={22} />{Boolean(live?.alerts.length) && <span className="app-notification-dot" />}</IconButton><details ref={account} className="account-menu"><summary aria-label="Account actions"><CircleUserRound size={28} aria-hidden="true" /></summary><div><p>Account</p><Button variant="ghost" icon={<LogOut size={17} aria-hidden="true" />} onClick={onLogout}>Sign out</Button></div></details></div></header>
      <main ref={content} id="main-content" className="app-content" tabIndex={-1}>{children}</main>
    </div>
    <dialog className="activity-dialog" ref={activity} aria-labelledby="activity-heading" onClose={() => setActivityOpen(false)}><div className="activity-dialog-header"><div><h2 id="activity-heading">Recent movement</h2><p className="ui-muted">{site?.name} · latest {live?.alerts.length ?? 0} received events, maximum 50</p></div><IconButton label="Close recent movement" onClick={() => activity.current?.close()}><X size={22} /></IconButton></div>{activityOpen && (live && live.alerts.length ? <MovementList events={live.alerts} timezone={site?.timezone || 'UTC'} /> : <EmptyState heading="No movement received">Events appear here while this site is connected. This is not a historical alert count.</EmptyState>)}<p className="activity-disclaimer">Severity is supplied by the source; it does not establish crowd congestion.</p></dialog>
  </div>
}
