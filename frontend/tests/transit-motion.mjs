import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { transformWithOxc } from 'vite'

async function load(name) {
  const code = (await transformWithOxc(
    await readFile(new URL(`../src/layers/${name}.ts`, import.meta.url), 'utf8'), `${name}.ts`)).code
  return import('data:text/javascript;base64,' + Buffer.from(code).toString('base64'))
}
const { projectTransit } = await load('transitProjection')
const { smoothTransitPosition } = await load('transitMotion')
const lon = meters => meters / 111_320
const lat = meters => meters / 110_540
const track = overrides => ({ type: 'bus', lon: 0, lat: 0, courseTrue: 90,
  speedMs: 10, fixTimeMs: 1_000, lastSeen: 'first', positionStale: false,
  transitMotionPath: [[0, 0], [lon(500), 0]], ...overrides })
const near = (value, target, tolerance = 0.01) => assert(Math.abs(value - target) < tolerance,
  `${value} should be close to ${target}`)

test('a matching new report preserves position and cruising speed', () => {
  let p = projectTransit(track(), 1_000)
  p = projectTransit(track(), 11_000, p.state)
  const next = track({ lon: lon(100), fixTimeMs: 11_000, lastSeen: 'next',
    transitMotionPath: [[lon(100), 0], [lon(500), 0]] })
  p = projectTransit(next, 11_000, p.state)
  near(p.track.lon * 111_320, 100)
  p = projectTransit(next, 11_033, p.state)
  near(p.track.lon * 111_320, 100.33)
})

test('a small correction keeps moving forward at handoff instead of rushing', () => {
  let p = projectTransit(track(), 1_000)
  p = projectTransit(track(), 11_000, p.state)
  const next = track({ lon: lon(90), fixTimeMs: 10_000, lastSeen: 'next', speedMs: 12,
    transitMotionPath: [[lon(90), 0], [lon(500), 0]] })
  const initial = p.track.lon
  p = projectTransit(next, 11_000, p.state)
  near(p.track.lon, initial, 1e-10)
  p = projectTransit(next, 11_033, p.state)
  const velocity = (p.track.lon - initial) * 111_320 / 0.033
  assert(velocity > 10 && velocity < 14)
})

test('an overshot prediction does not reverse along a moving route', () => {
  let p = projectTransit(track(), 1_000)
  p = projectTransit(track(), 16_000, p.state)
  const next = track({ lon: lon(100), fixTimeMs: 16_000, lastSeen: 'next',
    transitMotionPath: [[lon(100), 0], [lon(500), 0]] })
  p = projectTransit(next, 16_000, p.state)
  let last = p.track.lon
  for (let time = 16_033; time <= 30_000; time += 33) {
    p = projectTransit(next, time, p.state)
    assert(p.track.lon >= last - 1e-12)
    last = p.track.lon
  }
})

test('motion and correction follow the route around a corner', () => {
  const curved = track({ transitMotionPath: [[0, 0], [lon(100), 0], [lon(100), lat(200)]] })
  let p = projectTransit(curved, 1_000)
  p = projectTransit(curved, 10_800, p.state)
  assert(p.track.courseTrue > 0 && p.track.courseTrue < 90)
  p = projectTransit(curved, 12_000, p.state)
  near(p.track.lon * 111_320, 100)
  near(p.track.lat * 110_540, 10)
  const next = track({ lon: lon(100), lat: lat(5), courseTrue: 0,
    fixTimeMs: 12_000, lastSeen: 'corner-report',
    transitMotionPath: [[lon(100), lat(5)], [lon(100), lat(200)]] })
  p = projectTransit(next, 12_000, p.state)
  near(p.track.lat * 110_540, 10)
  p = projectTransit(next, 13_000, p.state)
  near(p.track.lon * 111_320, 100)
  assert(p.track.lat > lat(10))
})

test('the prediction window slows smoothly to a bounded stop', () => {
  let p = projectTransit(track(), 1_000)
  p = projectTransit(track(), 25_900, p.state)
  const earlier = p.track.lon
  p = projectTransit(track(), 26_000, p.state)
  assert((p.track.lon - earlier) * 111_320 / 0.1 < 0.3)
  near(p.track.lon * 111_320, 225)
  const stopped = p.track.lon
  p = projectTransit(track(), 60_000, p.state)
  near(p.track.lon, stopped, 1e-12)
})

test('projection and measured-fix transitions preserve the displayed position', () => {
  let p = projectTransit(track(), 1_000)
  p = projectTransit(track(), 11_000, p.state)
  const stationary = track({ lon: lon(95), speedMs: 0, transitMotionPath: undefined })
  assert.equal(projectTransit(stationary, 11_000, p.state), null)
  const handoff = { fromLon: p.state.shownLon, toLon: p.state.shownLon,
    fromLat: p.state.shownLat, toLat: p.state.shownLat,
    fromCourse: p.state.shownCourse, toCourse: p.state.shownCourse, startedAt: 11_000 }
  const moving = smoothTransitPosition(stationary, handoff, 11_000)
  near(moving.lon, p.track.lon, 1e-12)
  const resumed = projectTransit(track({ lastSeen: 'resumed' }), 11_000, undefined, moving)
  near(resumed.track.lon, moving.lon, 1e-12)
})

test('speed changes on a repeated position create a correction handoff', () => {
  const p = projectTransit(track(), 1_000)
  const next = projectTransit(track({ speedMs: 12 }), 2_000, p.state)
  assert.notEqual(next.state.report, p.state.report)
})

test('stale, stationary and missing-shape fixes do not project', () => {
  assert.equal(projectTransit(track({ positionStale: true }), 2_000), null)
  assert.equal(projectTransit(track({ speedMs: 0 }), 2_000), null)
  assert.equal(projectTransit(track({ transitMotionPath: undefined }), 2_000), null)
})

const geoCode = (await transformWithOxc(await readFile(
  new URL('../src/layers/geoUtils.ts', import.meta.url), 'utf8'), 'geoUtils.ts')).code
const geoUrl = 'data:text/javascript;base64,' + Buffer.from(geoCode).toString('base64')
const entitySource = (await readFile(new URL('../src/entityUtils.ts', import.meta.url), 'utf8'))
  .replace("'./layers/geoUtils'", JSON.stringify(geoUrl))
const entityCode = (await transformWithOxc(entitySource, 'entityUtils.ts')).code
const { entityToTrack } = await import('data:text/javascript;base64,' + Buffer.from(entityCode).toString('base64'))

test('a new measured transit fix refreshes its clock even at the same coordinates', t => {
  let now = 20_000
  t.mock.method(Date, 'now', () => now)
  const entity = { entity_id: 'synthetic-bus', entity_type: 'bus', source: 'gtfs_example',
    lat: 0, lon: 0, speed: 0, position_age_s: 5, last_seen: '2026-01-01T00:00:00Z' }
  const first = entityToTrack(entity)
  assert.equal(first.fixTimeMs, 15_000)
  now = 25_000
  const fresh = entityToTrack({ ...entity, position_age_s: 0, last_seen: '2026-01-01T00:00:10Z' }, first)
  assert.equal(fresh.fixTimeMs, 25_000)
  now = 30_000
  const duplicate = entityToTrack({ ...entity, position_age_s: 5, last_seen: fresh.lastSeen }, fresh)
  assert.equal(duplicate.fixTimeMs, 25_000)
})
