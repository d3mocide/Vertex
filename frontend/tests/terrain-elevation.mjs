import assert from 'node:assert/strict'
import { createServer } from 'vite'

globalThis.window = globalThis
const server = await createServer({ server: { middlewareMode: true }, appType: 'custom' })
try {
  const t = await server.ssrLoadModule('/src/layers/terrainElevation.ts')

  // Terrain off: outlines and positions come back untouched (same arrays), so the flat map is unchanged.
  const ring = [[-122.7, 45.4], [-122.6, 45.4], [-122.6, 45.5]]
  assert.equal(t.liftRing(ring), ring)
  assert.equal(t.liftPos(ring[0]), ring[0])

  // Terrain off: positions are the plain [lon, lat], so the flat map is unchanged.
  assert.deepEqual(t.lift(-122.7, 45.4), [-122.7, 45.4])
  assert.deepEqual(t.liftMsl(-122.7, 45.4, 3000), [-122.7, 45.4])

  const listeners = new Map()
  let queries = 0
  let loaded = false
  const map = {
    queryTerrainElevation: ([lon]) => { queries++; return loaded ? 100 + Math.round((lon + 123) * 1000) / 10 : 0 },
    on: (name, fn) => listeners.set(name, fn),
    off: (name) => listeners.delete(name),
  }
  t.configureTerrainElevation(map, true, 2)
  const v0 = t.terrainVersion()

  // Tile not decoded yet: MapLibre answers 0.
  assert.deepEqual(t.lift(-122.7, 45.4), [-122.7, 45.4, 0])

  // Tile arrives: the version moves on once (after the retry delay) so overlay groups rebuild.
  loaded = true
  listeners.get('sourcedata')({ sourceId: 'unrelated' })
  listeners.get('sourcedata')({ sourceId: 'terrain-dem' })
  listeners.get('sourcedata')({ sourceId: 'terrain-dem' })
  await new Promise(r => setTimeout(r, 1100))
  assert.equal(t.terrainVersion(), v0 + 1, 'one bump for a burst of tile events, none for other sources')

  const z = t.lift(-122.7, 45.4)[2]
  assert.ok(z > 0)
  const before = queries
  for (let i = 0; i < 50; i++) t.lift(-122.7, 45.4)
  assert.equal(queries, before, 'a repeat lookup in the same cell comes from the cache')
  assert.equal(t.lift(-122.7, 45.4)[2], z)

  // Outlines and positions follow the ground one vertex at a time.
  const lifted = t.liftRing(ring)
  assert.equal(lifted.length, 3)
  assert.ok(lifted.every(p => p.length === 3 && p[2] > 0))
  assert.deepEqual(t.liftPos(ring[1]), t.lift(...ring[1]))

  // Aircraft: altitude scales with the exaggeration, but never goes below the ground.
  assert.equal(t.liftMsl(-122.7, 45.4, 3000)[2], 6000)
  assert.equal(t.liftMsl(-122.7, 45.4, 1)[2], z)

  // A height cached as the 0 MapLibre gives for an undecoded tile is dropped when tiles load.
  loaded = false
  t.configureTerrainElevation(map, true, 1)
  assert.equal(t.lift(-122.7, 45.4)[2], 0)
  loaded = true
  assert.equal(t.lift(-122.7, 45.4)[2], 0, 'the placeholder is still cached until tiles arrive')
  listeners.get('sourcedata')({ sourceId: 'terrain-dem' })
  await new Promise(r => setTimeout(r, 1100))
  assert.ok(t.lift(-122.7, 45.4)[2] > 0)
  // Late tile without a source event: the periodic recheck of zero cells notices the real height.
  loaded = false
  t.configureTerrainElevation(map, true, 1)
  assert.equal(t.lift(-122.7, 45.4)[2], 0)
  const vLate = t.terrainVersion()
  loaded = true
  await new Promise(r => setTimeout(r, 2300))
  assert.equal(t.terrainVersion(), vLate + 1)
  assert.ok(t.lift(-122.7, 45.4)[2] > 0)
  t.configureTerrainElevation(map, true, 2)

  // A failing DEM lookup (throws) is treated as unavailable rather than breaking the frame.
  const bad = { queryTerrainElevation: () => { throw new Error('no terrain') }, on() {}, off() {} }
  t.configureTerrainElevation(bad, true, 1)
  assert.deepEqual(t.lift(1, 2), [1, 2, 0])

  // Turning terrain off restores plain positions and bumps the version.
  const v1 = t.terrainVersion()
  t.configureTerrainElevation(map, false, 1)
  assert.ok(t.terrainVersion() > v1)
  assert.deepEqual(t.lift(-122.7, 45.4), [-122.7, 45.4])
  console.log('terrain-elevation: ok')
} finally {
  await server.close()
}
