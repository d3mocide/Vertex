import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { transformWithOxc } from 'vite'

const url = code => 'data:text/javascript;base64,' + Buffer.from(code).toString('base64')
async function compile(file) {
  return (await transformWithOxc(await readFile(new URL(`../src/${file}.ts`, import.meta.url), 'utf8'), `${file}.ts`)).code
}
const geo = url(await compile('layers/geoUtils'))
const sources = url(await compile('storeTypes'))
const module = (await compile('layers/pvb')).replace("'./geoUtils'", JSON.stringify(geo)).replace('"./geoUtils"', JSON.stringify(geo))
  .replace("'../storeTypes'", JSON.stringify(sources)).replace('"../storeTypes"', JSON.stringify(sources))
const { applyPVBTrack } = await import(url(module))
const entityModule = (await compile('entityUtils')).replace(/(['"])\.\/layers\/geoUtils\1/, JSON.stringify(geo))
const { entityToTrack } = await import(url(entityModule))
const { destinationPoint } = await import(geo)
const track = (changes = {}) => ({ uid: 'synthetic', source: 'beast', type: 'air', lon: 0, lat: 0,
  speedMs: 100, courseTrue: 90, fixTimeMs: 1000, lastSeen: 'first', trail: [], predictedPath: [], ...changes })
const eastMeters = (a, b) => (b.lon - a.lon) * 111195
const near = (value, target, tolerance = 0.1) => assert(Math.abs(value - target) < tolerance, `${value} expected ${target}`)

test('local to network handoff preserves both position and displayed velocity', () => {
  const state = {}, first = track()
  applyPVBTrack(state, first, 1000)
  const before = applyPVBTrack(state, first, 6000)
  const position = destinationPoint(0, 0, 90, 450)
  const next = track({ source: 'community', lon: position[0], speedMs: 140, fixTimeMs: 6000, lastSeen: 'next' })
  const at = applyPVBTrack(state, next, 6000)
  near(eastMeters(before, at), 0, 1e-6)
  const after = applyPVBTrack(state, next, 6001)
  near(eastMeters(at, after) / 0.001, 100, 0.2)
})

test('interrupted corrections retain their current velocity', () => {
  const state = {}, first = track()
  applyPVBTrack(state, first, 1000)
  const next = track({ source: 'community', lon: destinationPoint(0, 0, 90, 450)[0], speedMs: 120, lastSeen: 'next', fixTimeMs: 6000 })
  applyPVBTrack(state, next, 6000)
  const previous = applyPVBTrack(state, next, 6990)
  const at = applyPVBTrack(state, next, 7000)
  const changed = { ...next, speedMs: 130, lastSeen: 'third' }
  applyPVBTrack(state, changed, 7000)
  const after = applyPVBTrack(state, changed, 7001)
  near(eastMeters(at, after) / 0.001, eastMeters(previous, at) / 0.01, 0.2)
})

test('heading crosses north smoothly and is independent of frame count', () => {
  const first = track({ courseTrue: 359 }), next = track({ courseTrue: 1, lastSeen: 'next' })
  const a = {}, b = {}
  applyPVBTrack(a, first, 1000); applyPVBTrack(b, first, 1000)
  applyPVBTrack(a, next, 2000); applyPVBTrack(b, next, 2000)
  for (let t = 2033; t < 3000; t += 33) applyPVBTrack(a, next, t)
  const ra = applyPVBTrack(a, next, 3000), rb = applyPVBTrack(b, next, 3000)
  near(ra.courseTrue, rb.courseTrue, 1e-9)
  assert(ra.courseTrue < 2 || ra.courseTrue > 358)
})

test('AIS has separate bow orientation and a bounded gradual stop', () => {
  const state = {}, vessel = track({ type: 'sea', source: 'aisstream', speedMs: 10, vesselCourseKnown: true, vesselHeading: 0 })
  const first = applyPVBTrack(state, vessel, 1000)
  const cruise = applyPVBTrack(state, vessel, 35000)
  const slowing = applyPVBTrack(state, vessel, 41000)
  const stopped = applyPVBTrack(state, vessel, 46000)
  const later = applyPVBTrack(state, vessel, 100000)
  near(eastMeters(first, stopped), 400)
  near(eastMeters(stopped, later), 0)
  assert(eastMeters(cruise, slowing) / 6 < 10)
  assert.equal(stopped.vesselHeading, 0)
  assert.equal(stopped.predictedPath.length, 0)
})

for (const changes of [{ vesselCourseKnown: false }, { vesselStationary: true }, { positionStale: true }]) {
  test(`AIS does not extrapolate ${JSON.stringify(changes)}`, () => {
    const state = {}, vessel = track({ type: 'sea', vesselCourseKnown: true, ...changes })
    applyPVBTrack(state, vessel, 1000)
    const result = applyPVBTrack(state, vessel, 5000)
    assert.equal(result.lon, 0); assert.equal(result.predictedPath.length, 0)
  })
}

test('stale aircraft hold while server dead reckoning stays continuous', () => {
  const frozen = {}, moving = {}
  const stale = track({ positionStale: true }), dr = { ...stale, positionDr: true }
  applyPVBTrack(frozen, stale, 1000); applyPVBTrack(moving, dr, 1000)
  assert.equal(applyPVBTrack(frozen, stale, 5000).lon, 0)
  assert(applyPVBTrack(moving, dr, 5000).lon > 0)
})

test('large position discontinuities reset rather than inventing a long journey', () => {
  const state = {}
  applyPVBTrack(state, track(), 1000)
  const result = applyPVBTrack(state, track({ lon: 1, fixTimeMs: 2000, lastSeen: 'next' }), 2000)
  assert.equal(result.lon, 1)
})

test('cached AIS snapshots retain absolute reception age at first hydration', () => {
  const now = Date.now()
  const entity = { entity_type: 'vessel', entity_id: 'synthetic', source: 'aisstream', lat: 0, lon: 0,
    heading: 90, speed: 10, position_ts: (now - 120000) / 1000, position_age_s: 0, identity: {}, last_seen: 'old' }
  const t = entityToTrack(entity)
  const result = applyPVBTrack({}, t, now)
  assert.equal(result.lon, 0)
  assert.equal(result.predictedPath.length, 0)
})

test('stationary vessel reports still correct to newly measured positions', () => {
  const state = {}, first = track({ type: 'sea', speedMs: 0, vesselStationary: true, vesselCourseKnown: true })
  applyPVBTrack(state, first, 1000)
  const next = { ...first, lon: destinationPoint(0, 0, 90, 5)[0], fixTimeMs: 2000, lastSeen: 'next' }
  applyPVBTrack(state, next, 2000)
  const corrected = applyPVBTrack(state, next, 30000)
  near(corrected.lon, next.lon, 1e-10)
  assert.equal(corrected.predictedPath.length, 0)
})

test('same-coordinate source switches use the incoming aircraft fix age', () => {
  const first = {entity_type: 'aircraft', entity_id: 'synthetic', source:'beast', lat:0, lon:0,
    speed:100, heading:90, position_age_s:1, last_seen:'first', identity:{}}
  const existing = entityToTrack(first)
  existing.fixTimeMs = Date.now() - 10000
  const next = entityToTrack({...first, source:'community', last_seen:'next', position_age_s:2}, existing)
  near(Date.now() - next.fixTimeMs, 2000, 100)
})
