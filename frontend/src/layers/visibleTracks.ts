import type { EntityTypeFilter, RangeFilter, Track } from '../store'
import { isSupplementSource } from '../storeTypes'

/** Cache map filtering between reports; hidden-only updates preserve identity. */
export class VisibleTrackCache {
  private inputs: unknown[] = []
  private visible: Record<string, Track> = {}

  get(tracks: Record<string, Track>, filter: EntityTypeFilter, query: string,
      altitude: RangeFilter, speed: RangeFilter): Record<string, Track> {
    const inputs = [tracks, filter, query, altitude, speed]
    if (inputs.every((value, i) => Object.is(value, this.inputs[i]))) return this.visible
    this.inputs = inputs
    const q = query.toLowerCase()
    const next: Record<string, Track> = {}
    for (const [uid, track] of Object.entries(tracks)) {
      if (track.type === 'air' && (!filter.aircraft ||
          (isSupplementSource(track.source) ? !filter.adsbSupplement : !filter.adsbLocal))) continue
      if (track.type === 'sea' && !filter.vessel) continue
      if (track.type === 'ground' && !filter.aprs) continue
      if (track.type === 'hazard' && !filter.fire_incident) continue
      if (track.type === 'rail' && !filter.train) continue
      if (track.type === 'bus' && !filter.bus) continue
      if (track.type === 'sensor' && !filter.rf_sensor) continue
      if (q && !(track.callsign ?? uid).toLowerCase().includes(q) && !uid.toLowerCase().includes(q)) continue
      const altFt = track.altMeters * 3.28084
      if (track.type === 'air' && (altFt < altitude[0] || altFt > altitude[1])) continue
      const speedKt = track.speedMs * 1.94384
      if (speedKt < speed[0] || speedKt > speed[1]) continue
      next[uid] = track
    }
    const keys = Object.keys(next)
    if (keys.length !== Object.keys(this.visible).length || keys.some(uid => this.visible[uid] !== next[uid])) {
      this.visible = next
    }
    return this.visible
  }
}
