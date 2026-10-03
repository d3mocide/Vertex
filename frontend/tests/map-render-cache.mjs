import assert from 'node:assert/strict'
import { createServer } from 'vite'

// Load the actual TypeScript modules through the existing Vite toolchain.
const server = await createServer({ server: { middlewareMode: true }, appType: 'custom' })
try {
  const { VisibleTrackCache } = await server.ssrLoadModule('/src/layers/visibleTracks.ts')
  const { MapLayerCache } = await server.ssrLoadModule('/src/layers/mapLayerCache.ts')
  const { buildTrailLayers } = await server.ssrLoadModule('/src/layers/buildTrailLayers.ts')
  const filter = { aircraft: true, adsbLocal: true, adsbSupplement: true, vessel: false,
    aprs: false, fire_incident: false, train: false, bus: false, rf_sensor: false }
  const ranges = [[0, 60000], [0, 600]]
  const track = { uid: 'synthetic-air', type: 'air', source: 'synthetic', callsign: 'SYNTHETIC',
    lon: 0, lat: 0, altMeters: 1000, speedMs: 10, courseTrue: 90,
    trail: [[0, 0], [0.001, 0]], smoothedTrail: [[0, 0], [0.001, 0]],
    predictedPath: [[0.002, 0], [0.003, 0]] }
  const hidden = { ...track, uid: 'synthetic-bus', type: 'bus' }
  const tracks = { [track.uid]: track, [hidden.uid]: hidden }
  const cache = new VisibleTrackCache()
  const visible = cache.get(tracks, filter, '', ...ranges)
  assert.deepEqual(Object.keys(visible), [track.uid])
  assert.equal(cache.get(tracks, filter, '', ...ranges), visible)
  assert.equal(cache.get({ ...tracks, [hidden.uid]: { ...hidden, lon: 0.1 } }, filter, '', ...ranges), visible,
    'hidden reports must preserve visible data identity')
  const next = cache.get({ ...tracks, [track.uid]: { ...track, lon: 0.1 } }, filter, '', ...ranges)
  assert.notEqual(next, visible, 'visible reports must invalidate the cache')
  assert.equal(Object.keys(cache.get(tracks, { ...filter, aircraft: false }, '', ...ranges)).length, 0)
  assert.equal(Object.keys(cache.get(tracks, filter, 'missing', ...ranges)).length, 0)
  assert.equal(Object.keys(cache.get(tracks, filter, '', [0, 100], ranges[1])).length, 0)
  assert.equal(Object.keys(cache.get(tracks, filter, '', ranges[0], [100, 600])).length, 0)
  const sensor = { ...track, uid: 'synthetic-sensor', type: 'sensor' }
  assert.equal(Object.keys(cache.get({ [sensor.uid]: sensor }, filter, '', ...ranges)).length, 0)
  assert.equal(Object.keys(cache.get({ [sensor.uid]: sensor }, { ...filter, rf_sensor: true }, '', ...ranges)).length, 1)

  const layers = new MapLayerCache()
  let builds = 0
  const build = () => { builds++; return [] }
  const first = layers.get('history', [visible], build)
  assert.equal(layers.get('history', [visible], build), first)
  assert.equal(builds, 1)
  assert.notEqual(layers.get('history', [next], build), first)
  assert.equal(builds, 2)

  const air = { [track.uid]: track }
  assert.deepEqual(buildTrailLayers(air, null, false), [], 'off must remove predictions as well as history')
  assert.deepEqual(buildTrailLayers(air, track.uid, false, 'selected'), [])
  const history = buildTrailLayers(air, null, true, 'history')
  assert.equal(history.length, 1)
  assert.equal(history[0].id, 'history-trails::100')
  assert.ok(buildTrailLayers(air, null, true, 'dynamic').some(l => l.id === 'predicted-path::100'))
  const rail = { ...track, uid: 'synthetic-rail', type: 'rail' }
  assert.equal(buildTrailLayers({ [rail.uid]: rail }, rail.uid, false, 'selected')[0].id, 'selected-trail::51')
  assert.deepEqual(buildTrailLayers({}, null, true), [])
  console.log('Map cache, filter invalidation, and trail visibility checks passed.')
} finally {
  await server.close()
}
