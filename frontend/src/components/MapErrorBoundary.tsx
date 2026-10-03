import { Component, type ErrorInfo, type ReactNode } from 'react'
import { useCivicStore } from '../store'

interface State { error: Error | null }

/**
 * Keeps a map failure (WebGL unavailable, a layer or terrain bug) from unmounting the whole dashboard: the panels and
 * feeds keep working and the operator gets a way back, including switching off 3D terrain, which is saved with the
 * user's preferences and would otherwise fail again on every load.
 */
export class MapErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State { return { error } }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('[map] failed to render:', error, info.componentStack)
  }

  private retry = (disableTerrain: boolean) => {
    if (disableTerrain) useCivicStore.getState().setTerrainEnabled(false)
    this.setState({ error: null })
  }

  render() {
    if (!this.state.error) return this.props.children
    return (
      <div className="h-full w-full flex items-center justify-center bg-onyx-black p-6">
        <div className="hud-panel border border-amber-gold/30 max-w-md w-full p-5 space-y-3" role="alert">
          <div className="flex items-center gap-2">
            <span className="ms text-amber-gold" aria-hidden="true">map</span>
            <h2 className="section-heading !mb-0">The map could not start</h2>
          </div>
          <p className="text-[13px] text-on-surface-variant leading-relaxed">
            The rest of the dashboard is unaffected. This is usually a graphics problem or a map layer failing.
            Turning off 3D terrain fixes the most common cause.
          </p>
          <p className="font-mono text-[11px] text-on-surface-variant break-words">{this.state.error.message}</p>
          <div className="flex flex-wrap gap-2">
            <button type="button" className="btn-primary" onClick={() => this.retry(true)}>Turn off 3D terrain and retry</button>
            <button type="button" className="btn-ghost" onClick={() => this.retry(false)}>Retry</button>
          </div>
        </div>
      </div>
    )
  }
}
