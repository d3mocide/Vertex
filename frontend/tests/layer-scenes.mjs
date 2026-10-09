import assert from 'node:assert/strict'
import { createServer } from 'vite'

globalThis.location = { protocol: 'http:', host: 'localhost' }
const storage = new Map()
globalThis.localStorage = {
  getItem: key => storage.get(key) ?? null,
  setItem: (key, value) => storage.set(key, value),
  removeItem: key => storage.delete(key),
}
globalThis.window = { localStorage: globalThis.localStorage }
const server = await createServer({ server: { middlewareMode: true }, appType: 'custom' })
try {
  const { PRESETS, ALL_DEFS } = await server.ssrLoadModule('/src/layers/layerCatalog.ts')
  const { dispatchPassesFilters } = await server.ssrLoadModule('/src/layers/dispatchFilter.ts')
  const { useCivicStore } = await server.ssrLoadModule('/src/store.ts')
  const { saveView, loadViews } = await server.ssrLoadModule('/src/layers/layerViews.ts')
  const preset = id => PRESETS.find(p => p.id === id)
  const incident = category => ({ category })

  // Real dispatch categories must match preset promises, and selecting another
  // scene must not leave a previous scene's category restriction behind.
  assert.equal(dispatchPassesFilters(incident('crash'), preset('traffic').sub), true)
  assert.equal(dispatchPassesFilters(incident('train_or_ped_struck'), preset('traffic').sub), true)
  assert.equal(dispatchPassesFilters(incident('structure_fire'), preset('traffic').sub), false)
  assert.equal(dispatchPassesFilters(incident('critical_medical'), preset('traffic').sub), false)
  for (const category of ['structure_fire', 'vehicle_fire', 'outside_fire', 'fire_alarm']) {
    assert.equal(dispatchPassesFilters(incident(category), preset('fire').sub), true)
  }
  assert.equal(dispatchPassesFilters(incident('crash'), preset('fire').sub), false)
  for (const p of ['overview', 'incidents', 'comms']) {
    assert.equal(dispatchPassesFilters(incident('crash'), preset(p).sub ?? {}), true)
    assert.equal(dispatchPassesFilters(incident('critical_medical'), preset(p).sub ?? {}), true)
  }
  assert.equal(dispatchPassesFilters(incident('gas_leak'), { 'dispatch.category': ['fire', 'hazard'] }), true)
  assert.equal(dispatchPassesFilters(incident('violence'), { 'dispatch.category': ['fire', 'hazard'] }), false)
  assert.equal(dispatchPassesFilters(incident('critical_medical'), { 'dispatch.category': ['life'] }), true)

  // New-user switches agree with Overview; richer map context stays opt-in.
  const state = useCivicStore.getState()
  for (const d of ALL_DEFS) {
    assert.equal(d.kind === 'entity' ? state.entityFilter[d.key] : state[d.key], preset('overview').on.includes(d.key), d.key)
  }
  assert.ok(preset('airsea').on.includes('trailsVisible'))
  assert.ok(!preset('overview').on.includes('trailsVisible'))

  // Existing saved mixes remain usable and new ones retain dispatch filtering.
  const legacy = [{ id: 'legacy', label: 'Legacy mix', on: ['aircraft'], sub: {} }]
  storage.set('vertex.layerViews', JSON.stringify(legacy))
  assert.deepEqual(loadViews(), legacy)
  saveView(legacy, 'Traffic mix', preset('traffic').on, preset('traffic').sub)
  assert.deepEqual(loadViews()[1].sub['dispatch.category'], ['traffic'])

  // Changing fresh-install defaults must not overwrite existing choices.
  storage.set('vertex.ui.prefs', JSON.stringify({ version: 0, state: {
    trailsVisible: true, railTracksVisible: true,
    entityFilter: { bus: true, mesh_node: true },
  } }))
  await useCivicStore.persist.rehydrate()
  assert.equal(useCivicStore.getState().trailsVisible, true)
  assert.equal(useCivicStore.getState().railTracksVisible, true)
  assert.equal(useCivicStore.getState().entityFilter.bus, true)
  assert.equal(useCivicStore.getState().entityFilter.mesh_node, true)
  assert.equal(useCivicStore.getState().entityFilter.aircraft, true)
  console.log('Layer scenes: dispatch categories, Overview defaults and saved-mix compatibility passed.')
} finally {
  await server.close()
}
