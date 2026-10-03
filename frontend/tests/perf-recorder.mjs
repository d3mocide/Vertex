import assert from 'node:assert/strict'
import { createServer } from 'vite'

// Load the actual TypeScript module through the existing Vite toolchain.
const server = await createServer({ server: { middlewareMode: true }, appType: 'custom' })
try {
  const { percentile, summarizeFrames, summarizeBuilds, summarizePhases } = await server.ssrLoadModule('/src/perfRecorder.ts')

  // percentile: nearest rank, safe on empty input
  assert.equal(percentile([], 95), 0)
  assert.equal(percentile([5], 99), 5)
  const hundred = Array.from({ length: 100 }, (_, i) => i + 1)
  assert.equal(percentile(hundred, 50), 50)
  assert.equal(percentile(hundred, 95), 95)
  assert.equal(percentile(hundred, 100), 100)

  // A steady 60 Hz display: nothing dropped, no hitches
  const steady = Array.from({ length: 600 }, () => 16.67)
  const s = summarizeFrames(steady)
  assert.equal(s.frames, 600)
  assert.equal(s.vsyncMs, 16.67)
  assert.equal(s.droppedPct, 0)
  assert.equal(s.hitches, 0)
  assert.equal(s.frameMs.p99, 16.67)

  // 5% of frames miss a refresh (33 ms) and two stutter badly (80 ms)
  const rough = [...steady.slice(0, 570), ...Array.from({ length: 28 }, () => 33.3), 80, 80]
  const r = summarizeFrames(rough)
  assert.equal(r.droppedPct, 5)
  assert.equal(r.hitches, 2)
  assert.equal(r.frameMs.max, 80)
  assert.ok(r.frameMs.p99 >= 33.3)

  // A 120 Hz display is judged against its own refresh interval, not 60 Hz
  const fast = summarizeFrames([...Array.from({ length: 95 }, () => 8.33), ...Array.from({ length: 5 }, () => 16.7)])
  assert.equal(fast.vsyncMs, 8.33)
  assert.equal(fast.droppedPct, 5)

  // Layer rebuild cadence: every 33 ms with one 100 ms gap
  const marks = [0, 33, 66, 99, 199, 232]
  const b = summarizeBuilds(marks)
  assert.equal(b.n, 6)
  assert.equal(b.p50, 33)
  assert.equal(b.p95, 100)
  assert.deepEqual(summarizeBuilds([]), { n: 0, p50: 0, p95: 0 })

  // Phase stats become means; empty phases are omitted
  const p = summarizePhases({ filter: { n: 4, total: 2, max: 1.2 }, empty: { n: 0, total: 0, max: 0 } })
  assert.deepEqual(p, { filter: { n: 4, meanMs: 0.5, maxMs: 1.2 } })
  console.log('Perf recorder summary checks passed.')
} finally {
  await server.close()
}
