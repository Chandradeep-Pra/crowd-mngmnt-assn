import { useState } from 'react'
import type { FormEvent } from 'react'
import { ArrowRight, ShieldCheck } from 'lucide-react'
import { useSession } from '../../auth/use-session.ts'
import { Button, PasswordField, TextField } from '../../components/ui/Controls.tsx'
import { brandAssets } from '../../theme/brand.ts'

export default function LoginPage() {
  const { state, signIn } = useSession()
  const [validation, setValidation] = useState('')
  const busy = state.status === 'signing-in'
  const message = validation || (state.status === 'signed-out' ? state.message : null)
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = event.currentTarget
    const data = new FormData(form)
    const email = String(data.get('email') ?? '').trim()
    const password = String(data.get('password') ?? '')
    if (!email || !password) { setValidation('Enter your email and password.'); return }
    setValidation('')
    // Credentials never enter React state, query caches or persistent storage.
    const passwordInput = form.elements.namedItem('password') as HTMLInputElement
    passwordInput.value = ''
    try { await signIn({ email, password }) } catch { /* Safe failure is already in session state. */ }
  }
  return <main className="login-page">
    <img className="login-background" src={brandAssets.loginBackground} alt="" fetchPriority="high" />
    <div className="login-shade" />
    <div className="login-layout"><div className="login-welcome"><p className="login-eyebrow">CROWD SOLUTIONS</p><h1>Welcome to the<br />Crowd Management System</h1><p>Understand every movement.<br />See your venue clearly.</p></div>
      <section className="login-card" aria-labelledby="login-heading"><div className="login-brand" style={{ backgroundImage: `url(${brandAssets.sidebarBackground})` }}><img src={brandAssets.logoWhite} className="ui-brand-logo" alt="Kloudspot" width="160" height="48" /></div><div className="login-form-body"><h2 id="login-heading">Sign in to your workspace</h2><p className="ui-muted">Use your account to access your sites.</p><form onSubmit={submit} className="app-stack" aria-busy={busy}>
        <TextField label="Email" name="email" type="email" autoComplete="username" required disabled={busy} placeholder="you@company.com" aria-describedby={message ? 'login-error' : undefined} />
        <PasswordField label="Password" name="password" autoComplete="current-password" required disabled={busy} aria-describedby={message ? 'login-error' : undefined} />
        {message && <p id="login-error" className="login-error" role="alert">{message}</p>}
        <Button type="submit" loading={busy} icon={!busy ? <ArrowRight size={18} aria-hidden="true" /> : undefined}>{busy ? 'Signing in…' : 'Sign in'}</Button>
      </form><p className="login-security"><ShieldCheck size={15} aria-hidden="true" />Protected access to your crowd data</p></div></section>
    </div>
  </main>
}
