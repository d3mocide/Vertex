/**
 * Live P25 listening from every OP25 receiver (backend /ws/radio).
 *
 * OP25 hands each call to whichever receiver is free, so a talkgroup can show
 * up on either one. This player works per call instead of per receiver: it
 * keeps only the talkgroups the listener picked, plays one call at a time, and
 * holds an overlapping call (buffered, lossless) to play right after the
 * current one, highest priority first. Two calls are never mixed together.
 *
 * Wire format (poller/pollers/p25_recorder.py):
 *   "A" | receiver u8 | tgid u32 LE | int16 PCM @ 8 kHz   (tgid 0 = not known yet)
 *   "J" | JSON {"ev": "label", ch, tgid, tag} | {"ev": "end", ch}
 */
import { WS_URL } from '../config'
import { wsTokenParam } from '../auth'
import { Upsampler } from './upsample'

const RATE = 8000
const GAP_MS = 2500          // no frames this long ends a call (backup to "end")
const LABEL_WAIT_MS = 1500   // still no talkgroup: decide as unknown
const MAX_HOLD_MS = 90_000   // a call held longer than this is stale: drop it
const LEAD_S = 0.15          // jitter buffer at the start of each call
const TICK_MS = 100

export type LiveCall = {
  id: number
  ch: number            // OP25 receiver
  tgid: number
  tag: string           // OP25's talkgroup tag
  startedAt: number     // epoch ms of the first frame
}

type Call = LiveCall & {
  chunks: Float32Array<ArrayBuffer>[]   // received, not yet scheduled
  ended: boolean
  firstMono: number
  lastMono: number
  decision: 'pending' | 'keep' | 'skip'
}

export type LiveState = {
  connected: boolean
  nowPlaying: LiveCall | null
  /** true when the playing call started before playback did (it was held) */
  delayed: boolean
  held: LiveCall[]
}

export class P25LivePlayer {
  /** Talkgroup filter; tgid 0 means the talkgroup never became known. */
  wants: (tgid: number) => boolean = () => true
  /** Lower plays first when calls are held. */
  priorityOf: (tgid: number) => number = () => 3
  onChange: (s: LiveState) => void = () => {}

  private ctx: AudioContext | null = null
  private gain: GainNode | null = null
  private ws: WebSocket | null = null
  private timer: ReturnType<typeof setInterval> | null = null
  private retry: ReturnType<typeof setTimeout> | null = null
  private running = false
  private volume = 0.7
  private seq = 0
  private live = new Map<number, Call>()   // receiver → call in progress
  private queue: Call[] = []               // kept calls waiting their turn
  private current: Call | null = null
  private currentDelayed = false
  // The playing call's audio, upsampled to the context rate (see upsample.ts)
  // and scheduled back to back in whole context sample frames.
  private up: Upsampler | null = null
  private flushed = false
  private nextFrame = 0
  private sources = new Set<AudioBufferSourceNode>()
  private connected = false

  /** Call from a user gesture: iOS only unlocks audio inside one. */
  start() {
    if (this.running) return
    this.running = true
    if (!this.ctx) {
      this.ctx = new AudioContext()
      this.gain = this.ctx.createGain()
      this.gain.connect(this.ctx.destination)
    }
    this.gain!.gain.value = this.volume
    void this.ctx.resume()
    this.connect()
    this.timer = setInterval(() => this.tick(), TICK_MS)
  }

  stop() {
    this.running = false
    if (this.timer) clearInterval(this.timer)
    if (this.retry) clearTimeout(this.retry)
    this.timer = this.retry = null
    if (this.ws) {
      this.ws.onclose = null
      this.ws.close()
      this.ws = null
    }
    this.silence()
    this.live.clear()
    this.queue = []
    this.current = null
    this.connected = false
    void this.ctx?.suspend()
    this.emit()
  }

  setVolume(v: number) {
    this.volume = v
    if (this.gain) this.gain.gain.value = v
  }

  /** Drop the playing call and move on to the next held one. */
  skip() {
    const c = this.current
    if (!c) return
    this.silence()
    c.decision = 'skip'
    c.chunks = []
    this.current = null
    this.pump()
    this.emit()
  }

  /** Re-apply the talkgroup filter to calls not yet playing. */
  refilter() {
    for (const c of [...this.live.values(), ...this.queue]) {
      if (c === this.current || !c.tgid) continue
      c.decision = 'pending'
      this.decide(c)
    }
    this.queue = this.queue.filter((c) => c.decision === 'keep')
    this.pump()
    this.emit()
  }

  // ── connection ────────────────────────────────────────────────────────────

  private connect() {
    const ws = new WebSocket(`${WS_URL}/radio${wsTokenParam()}`)
    ws.binaryType = 'arraybuffer'
    ws.onopen = () => { this.connected = true; this.emit() }
    ws.onmessage = (e) => { if (e.data instanceof ArrayBuffer) this.onMessage(e.data) }
    ws.onclose = () => {
      this.connected = false
      this.ws = null
      this.emit()
      if (this.running) this.retry = setTimeout(() => this.connect(), 3000)
    }
    this.ws = ws
  }

  private onMessage(buf: ArrayBuffer) {
    const bytes = new Uint8Array(buf)
    if (bytes[0] === 0x41 && buf.byteLength > 6) {                 // "A"
      const view = new DataView(buf)
      const pcm = new Int16Array(buf.slice(6))
      this.onAudio(bytes[1], view.getUint32(2, true), pcm)
    } else if (bytes[0] === 0x4a) {                                  // "J"
      try {
        const ev = JSON.parse(new TextDecoder().decode(bytes.subarray(1)))
        if (ev.ev === 'label') this.onLabel(ev.ch, ev.tgid, ev.tag ?? '')
        else if (ev.ev === 'end') this.onEnd(ev.ch)
      } catch { /* ignore malformed */ }
    }
  }

  // ── calls ─────────────────────────────────────────────────────────────────

  private onAudio(ch: number, tgid: number, pcm: Int16Array) {
    const now = performance.now()
    let c = this.live.get(ch)
    if (c && tgid && c.tgid && tgid !== c.tgid) {     // receiver moved on without an "end"
      this.finish(c)
      c = undefined
    }
    if (!c) {
      c = { id: ++this.seq, ch, tgid: 0, tag: '', startedAt: Date.now(), chunks: [],
            ended: false, firstMono: now, lastMono: now, decision: 'pending' }
      this.live.set(ch, c)
    }
    if (tgid && !c.tgid) c.tgid = tgid
    c.lastMono = now
    if (c.decision === 'skip') return
    const f = new Float32Array(pcm.length)
    for (let i = 0; i < pcm.length; i++) f[i] = pcm[i] / 32768
    c.chunks.push(f)
    this.decide(c)
    this.pump()
  }

  private onLabel(ch: number, tgid: number, tag: string) {
    const c = this.live.get(ch)
    if (!c) return
    if (!c.tgid) c.tgid = tgid
    c.tag = tag
    this.decide(c)
    this.pump()
    this.emit()
  }

  private onEnd(ch: number) {
    const c = this.live.get(ch)
    if (c) this.finish(c)
    this.pump()
  }

  private finish(c: Call) {
    c.ended = true
    this.live.delete(c.ch)
    this.decide(c, true)
  }

  private decide(c: Call, force = false) {
    if (c.decision !== 'pending') return
    if (c.tgid) c.decision = this.wants(c.tgid) ? 'keep' : 'skip'
    else if (force || performance.now() - c.firstMono > LABEL_WAIT_MS) c.decision = this.wants(0) ? 'keep' : 'skip'
    if (c.decision === 'keep' && c !== this.current && !this.queue.includes(c)) {
      this.queue.push(c)
      this.emit()
    } else if (c.decision === 'skip') {
      c.chunks = []
    }
  }

  // ── playback ──────────────────────────────────────────────────────────────

  private tick() {
    const now = performance.now()
    for (const c of [...this.live.values()]) {
      if (now - c.lastMono > GAP_MS) this.finish(c)
      else this.decide(c)
    }
    const before = this.queue.length
    this.queue = this.queue.filter((c) => Date.now() - c.startedAt < MAX_HOLD_MS)
    if (this.queue.length !== before) this.emit()
    this.pump()
  }

  private pump() {
    const ctx = this.ctx
    if (!ctx || !this.running) return
    const cur = this.current
    if (cur && cur.ended && cur.chunks.length === 0 && this.flushed && ctx.currentTime * ctx.sampleRate >= this.nextFrame) {
      this.current = null
      this.emit()
    }
    if (!this.current) {
      if (this.queue.length === 0) return
      this.queue.sort((a, b) =>
        this.priorityOf(a.tgid) - this.priorityOf(b.tgid) || a.startedAt - b.startedAt)
      const next = this.queue.shift()!
      this.current = next
      this.currentDelayed = Date.now() - next.startedAt > 1500
      this.up = new Upsampler(RATE, ctx.sampleRate)
      this.flushed = false
      this.nextFrame = Math.ceil((ctx.currentTime + LEAD_S) * ctx.sampleRate)
      this.emit()
    }
    const c = this.current!
    while (c.chunks.length) this.schedule(ctx, this.up!.push(c.chunks.shift()!))
    if (c.ended && !this.flushed) {
      this.flushed = true
      this.schedule(ctx, this.up!.flush())
    }
  }

  private schedule(ctx: AudioContext, samples: Float32Array<ArrayBuffer>) {
    if (samples.length === 0) return
    const buf = ctx.createBuffer(1, samples.length, ctx.sampleRate)
    buf.copyToChannel(samples, 0)
    const src = ctx.createBufferSource()
    src.buffer = buf
    src.connect(this.gain!)
    const now = Math.ceil(ctx.currentTime * ctx.sampleRate)
    if (this.nextFrame < now) this.nextFrame = now + Math.round(0.05 * ctx.sampleRate)   // underrun
    src.start(this.nextFrame / ctx.sampleRate)
    this.nextFrame += samples.length
    this.sources.add(src)
    src.onended = () => this.sources.delete(src)
  }

  private silence() {
    for (const s of this.sources) {
      try { s.stop() } catch { /* already stopped */ }
    }
    this.sources.clear()
    this.nextFrame = 0
  }

  private emit() {
    const pub = (c: Call): LiveCall => ({ id: c.id, ch: c.ch, tgid: c.tgid, tag: c.tag, startedAt: c.startedAt })
    this.onChange({
      connected: this.connected,
      nowPlaying: this.current ? pub(this.current) : null,
      delayed: this.current ? this.currentDelayed : false,
      held: this.queue.map(pub),
    })
  }
}
