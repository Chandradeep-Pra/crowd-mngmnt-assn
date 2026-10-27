import { useId } from 'react'
import type { HTMLAttributes, ReactNode } from 'react'
import { clsx } from 'clsx'
import { CircleAlert, Info } from 'lucide-react'
import { Button } from './Controls.tsx'

interface SurfaceProps extends HTMLAttributes<HTMLElement> { heading: string; description?: string; actions?: ReactNode }
export function Surface({ heading, description, actions, children, className, ...props }: SurfaceProps) {
  const id = useId()
  return <section {...props} className={clsx('ui-surface', className)} aria-labelledby={id}>
    <div className="ui-surface-heading"><div><h2 id={id}>{heading}</h2>{description && <p className="ui-muted">{description}</p>}</div>{actions}</div>{children}
  </section>
}
type Tone = 'neutral' | 'success' | 'warning' | 'danger'
export function StatusBadge({ tone = 'neutral', children }: { tone?: Tone; children: ReactNode }) {
  return <span className={clsx('ui-badge', `ui-badge--${tone}`)}>{children}</span>
}
export function Notice({ tone = 'info', heading, children }: { tone?: 'info' | 'error'; heading: string; children: ReactNode }) {
  const Icon = tone === 'error' ? CircleAlert : Info
  return <div className={clsx('ui-notice', `ui-notice--${tone}`)}><Icon size={20} aria-hidden="true" /><div><strong>{heading}</strong><p>{children}</p></div></div>
}
export function Metric({ label, value, detail }: { label: string; value: ReactNode; detail: string }) {
  return <div className="ui-metric"><p>{label}</p><strong>{value}</strong><p className="ui-muted">{detail}</p></div>
}
export function EmptyState({ heading, children, action }: { heading: string; children: ReactNode; action?: ReactNode }) {
  return <div className="ui-empty"><Info size={26} aria-hidden="true" /><h3>{heading}</h3><p className="ui-muted">{children}</p>{action}</div>
}
export function Skeleton({ label = 'Loading' }: { label?: string }) {
  return <div className="ui-skeleton-group" role="status"><span className="sr-only">{label}</span><span className="ui-skeleton" /><span className="ui-skeleton ui-skeleton--short" /></div>
}
export function TableFrame({ label, children }: { label: string; children: ReactNode }) {
  return <div className="ui-table-frame" role="region" aria-label={label} tabIndex={0}>{children}</div>
}
export function Pagination({ page, totalPages, onChange }: { page: number; totalPages: number; onChange: (page: number) => void }) {
  const empty = totalPages <= 0
  return <nav className="ui-pagination" aria-label="Table pagination"><p aria-live="polite">{empty ? 'No pages' : `Page ${page} of ${totalPages}`}</p><div className="ui-row"><Button variant="secondary" disabled={empty || page <= 1} onClick={() => onChange(page - 1)}>Previous</Button><Button variant="secondary" disabled={empty || page >= totalPages} onClick={() => onChange(page + 1)}>Next</Button></div></nav>
}
