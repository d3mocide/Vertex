/**
 * Rolling frame-time sampler for the Developer tools' live readout. It runs a requestAnimationFrame loop only while
 * the tools are open (start/stop are reference-counted) and keeps the last few seconds of frame intervals.
 */
import { summarizeFrames, type PerfSummary } from '../perfRecorder'

const CAPACITY = 300          // about 5 s at 60 Hz

export interface LiveSnapshot {
  /** Most recent frame intervals in ms, oldest first (for the sparkline). */
  recent: number[]
  stats: Pick<PerfSummary, 'frames' | 'vsyncMs' | 'frameMs' | 'droppedPct' | 'hitches'>
  fps: number
}

class LiveFrameSampler {
  private buf: number[] = []
  private raf = 0
  private last = 0
  private users = 0

  start(): void {
    if (this.users++ > 0) return
    this.buf = []
    this.last = 0
    const tick = (now: number) => {
      if (this.last) {
        this.buf.push(now - this.last)
        if (this.buf.length > CAPACITY) this.buf.shift()
      }
      this.last = now
      this.raf = requestAnimationFrame(tick)
    }
    this.raf = requestAnimationFrame(tick)
  }

  stop(): void {
    if (--this.users > 0) return
    this.users = 0
    cancelAnimationFrame(this.raf)
  }

  snapshot(): LiveSnapshot {
    const stats = summarizeFrames(this.buf)
    const total = this.buf.reduce((a, b) => a + b, 0)
    return { recent: this.buf.slice(-120), stats, fps: total > 0 ? Math.round((this.buf.length / total) * 10000) / 10 : 0 }
  }
}

export const liveSampler = new LiveFrameSampler()
