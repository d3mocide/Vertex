import assert from 'node:assert/strict'
import { createServer } from 'vite'

const server = await createServer({ server: { middlewareMode: true }, appType: 'custom' })
try {
  const { installDeckTerrainCompat } = await server.ssrLoadModule('/src/layers/deckTerrainCompat.ts')

  // MapLibre 6: no Map.transform. deck.gl reads transform.elevation; it must see the camera target elevation.
  let elevation = 412.5
  const map = { getCameraTargetElevation: () => elevation }
  installDeckTerrainCompat(map)
  assert.equal(map.transform.elevation, 412.5)
  elevation = 90
  assert.equal(map.transform.elevation, 90, 'reads live, not a copy')

  // Bad values never reach deck.gl (it only accepts a number)
  elevation = Number.NaN
  assert.equal(map.transform.elevation, 0)
  const throwing = { getCameraTargetElevation: () => { throw new Error('terrain not ready') } }
  installDeckTerrainCompat(throwing)
  assert.equal(throwing.transform.elevation, 0)

  // A map that already has a real transform is left alone
  const real = { transform: { elevation: 7, height: 800 }, getCameraTargetElevation: () => 1 }
  installDeckTerrainCompat(real)
  assert.deepEqual(real.transform, { elevation: 7, height: 800 })

  // Installing twice is harmless
  installDeckTerrainCompat(map)
  assert.equal(map.transform.elevation, 0)
  console.log('deck.gl terrain compatibility checks passed.')
} finally {
  await server.close()
}
