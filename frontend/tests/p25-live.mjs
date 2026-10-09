import assert from 'node:assert/strict'
import { createServer } from 'vite'

// Exercise the real player with a deterministic audio clock and transport.
globalThis.location = { protocol: 'http:', host: 'localhost' }
class Node {
  gain = { value: 1, setTargetAtTime(value) { this.value = value } }
  connections = []
  connect(target) { this.connections.push(target) }
}
class Context {
  currentTime = 0
  sampleRate = 48000
  destination = new Node()
  sources = []
  compressors = []
  createGain() { return new Node() }
  createDynamicsCompressor() {
    const node = new Node()
    for (const key of ['threshold', 'knee', 'ratio', 'attack', 'release']) node[key] = { value: 0 }
    this.compressors.push(node)
    return node
  }
  createBuffer(channels, length) {
    return { length, copyToChannel(samples) { this.samples = samples.slice() } }
  }
  createBufferSource() {
    const node = new Node()
    node.start = (at) => { node.at = at }
    node.stop = () => { node.stopped = true }
    this.sources.push(node)
    return node
  }
  async resume() {}
  async suspend() {}
}
globalThis.AudioContext = Context
globalThis.WebSocket = class { close() {} }
const server = await createServer({ server: { middlewareMode: true }, appType: 'custom' })
const players = []
try {
  const { P25LivePlayer } = await server.ssrLoadModule('/src/audio/p25Live.ts')
  const { Upsampler } = await server.ssrLoadModule('/src/audio/upsample.ts')
  const make = () => {
    const player = new P25LivePlayer()
    player.start()
    clearInterval(player.timer)
    players.push(player)
    return player
  }
  const pcm = new Int16Array(160).fill(4096)
  const p = make()
  p.onAudio(0, 101, pcm)
  const first = p.current.id
  const before = p.ctx.sources.length
  const nextFrame = p.nextFrame
  p.onAudio(1, 202, pcm)
  assert.equal(p.current.id, first, 'an overlapping call cannot replace the playing call')
  assert.equal(p.queue.length, 1)
  assert.equal(p.ctx.sources.length, before, 'held audio is not mixed into playback')
  assert.equal(p.nextFrame, nextFrame)
  assert.ok(p.ctx.sources[0].at >= 0.9, 'live calls have a jitter cushion')
  assert.ok(p.ctx.sources.every(s => !s.stopped))

  // A measured 755 ms delivery stall fits the new cushion.
  p.ctx.currentTime = 0.755
  p.onAudio(0, 101, pcm)
  assert.ok(Math.abs(p.ctx.sources[1].at * p.ctx.sampleRate - nextFrame) < 1e-6, 'bursty frames remain contiguous')
  // A longer stall rebuilds the full cushion rather than repeatedly starving.
  p.ctx.currentTime = 1
  p.onAudio(0, 101, pcm)
  assert.equal(p.ctx.sources[2].at, 1.9)

  // Queued calls obey priority and cannot preempt an active call.
  p.priorityOf = tg => tg === 303 ? 1 : 3
  p.onEnd(1)
  p.onAudio(1, 303, pcm)
  p.onEnd(1)
  p.onEnd(0)
  p.ctx.currentTime = p.nextFrame / p.ctx.sampleRate + 0.01
  p.pump()
  assert.equal(p.current.tgid, 303)
  assert.ok(p.ctx.sources.at(-1).at < p.ctx.currentTime + 0.1, 'completed held calls need no network cushion')
  p.skip()
  assert.equal(p.current.tgid, 202)

  // A large transport packet / held backlog is sliced and drained losslessly.
  const large = new Int16Array(8000 * 8).fill(4096)
  const q = make()
  q.onAudio(0, 404, large)
  q.onEnd(0)
  assert.ok(q.ctx.sources.every(s => s.buffer.length <= 9601), 'conversion slices stay bounded')
  assert.ok(q.current.chunks.length > 0, 'a large packet is not converted in one pump')
  let rounds = 0
  while (q.current && rounds++ < 200) {
    q.ctx.currentTime += 0.1
    q.pump()
  }
  assert.equal(q.current, null, 'held playback eventually drains')
  const reference = new Upsampler(8000, 48000)
  const input = Float32Array.from(large, x => x / 32768)
  const expected = [...reference.push(input), ...reference.flush()]
  const actual = q.ctx.sources.flatMap(s => Array.from(s.buffer.samples))
  // Floating-point phase accumulation can move the final silent tail by one
  // output sample when the same stream is fed in different chunk sizes.
  assert.ok(Math.abs(actual.length - expected.length) <= 1)
  for (let i = 0; i < actual.length; i++) assert.ok(Math.abs(actual[i] - expected[i]) < 1e-5)

  // Expired held calls stop accumulating PCM even while the receiver is live.
  const r = make()
  r.onAudio(0, 505, pcm)
  r.onAudio(1, 606, pcm)
  const held = r.queue[0]
  held.startedAt = Date.now() - 91_000
  r.tick()
  r.onAudio(1, 606, pcm)
  assert.equal(held.decision, 'skip')
  assert.equal(held.chunks.length, 0)

  // Boost and peak compression precede the user's volume control, so mute works.
  assert.equal(p.input.gain.value, 2)
  const peaks = p.ctx.compressors[0]
  assert.equal(p.input.connections[0], peaks)
  assert.equal(peaks.connections[0], p.gain)
  assert.equal(peaks.threshold.value, -3)
  p.setVolume(0)
  assert.equal(p.gain.gain.value, 0)
  p.setVolume(2)
  assert.equal(p.gain.gain.value, 1)
  console.log('P25 live playback: overlap, priority, jitter recovery, lossless backlog, expiry and gain passed.')
} finally {
  for (const p of players) p.stop()
  await server.close()
}
