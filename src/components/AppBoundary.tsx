import { Component } from 'react'
import type { ReactNode } from 'react'
import { Button } from './ui/Controls.tsx'

export class AppBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() { return { failed: true } }
  render() {
    if (this.state.failed) return <main className="session-loading"><h1>Unable to open the workspace</h1><p className="ui-muted">Please refresh the page. If this continues, check your connection and application configuration.</p><Button onClick={() => window.location.reload()}>Refresh page</Button></main>
    return this.props.children
  }
}
