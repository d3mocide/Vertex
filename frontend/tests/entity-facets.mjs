import assert from 'node:assert/strict'
import { createServer } from 'vite'

const server = await createServer({ server: { middlewareMode: true }, appType: 'custom' })
try {
  const f = await server.ssrLoadModule('/src/entityFacets.ts')
  const T = (over) => ({ uid: 'x', source: 's', type: 'air', lat: 0, lon: 0, altMeters: 0, speedMs: 0, courseTrue: 0, trail: [], smoothedTrail: [], predictedPath: [], ...over })

  // No selection shows everything, for every entity type.
  assert.equal(f.trackPassesFacets(T({ aircraftClass: 'light' }), {}), true)
  assert.equal(f.trackPassesFacets(T({ type: 'sea' }), { 'aircraft.kind': ['light'] }), true, 'aircraft filters do not touch vessels')
  assert.equal(f.trackPassesFacets(T({ type: 'rail' }), { 'aircraft.kind': ['light'] }), true)

  // Several selected values mean any of them; missing data is "unknown", not invisible.
  const heli = T({ aircraftClass: 'helicopter' })
  assert.equal(f.trackPassesFacets(heli, { 'aircraft.kind': ['helicopter', 'light'] }), true)
  assert.equal(f.trackPassesFacets(heli, { 'aircraft.kind': ['airliner'] }), false)
  assert.equal(f.trackPassesFacets(T({}), { 'aircraft.kind': ['unknown'] }), true)

  // State comes from the receiver's on-ground flag; without it an aircraft counts as airborne.
  assert.equal(f.trackPassesFacets(T({ onGround: true }), { 'aircraft.state': ['airborne'] }), false)
  assert.equal(f.trackPassesFacets(T({ onGround: true }), { 'aircraft.state': ['ground'] }), true)
  assert.equal(f.trackPassesFacets(T({ onGround: false }), { 'aircraft.state': ['airborne'] }), true)
  assert.equal(f.trackPassesFacets(T({}), { 'aircraft.state': ['airborne'] }), true)

  // "Who" is multi-valued: a military helicopter with an emergency squawk matches all three.
  const multi = T({ aircraftClass: 'helicopter', role: 'medical', military: true, alert: 'emergency' })
  assert.deepEqual(f.trackValues(multi, 'aircraft.who').sort(), ['alert', 'medical', 'military'])
  assert.equal(f.trackPassesFacets(multi, { 'aircraft.who': ['military'] }), true)
  assert.equal(f.trackPassesFacets(T({ military: true }), { 'aircraft.who': ['military'] }), true, 'the military flag alone counts')
  assert.equal(f.trackPassesFacets(T({}), { 'aircraft.who': ['medical', 'fire'] }), false, 'an ordinary aircraft has no role')

  // Different facets of one entity type must all match.
  const both = { 'aircraft.kind': ['helicopter'], 'aircraft.who': ['medical'] }
  assert.equal(f.trackPassesFacets(multi, both), true)
  assert.equal(f.trackPassesFacets(T({ aircraftClass: 'helicopter' }), both), false)

  // Vessels: bucket from the poller's category, else from the label; unknown when neither exists.
  assert.equal(f.vesselBucket('sailing', undefined), 'recreational')
  assert.equal(f.vesselBucket('special', undefined), 'service')
  assert.equal(f.vesselBucket('hsc', undefined), 'other')
  assert.equal(f.vesselBucket(undefined, 'Towing (large)'), 'tug')
  assert.equal(f.vesselBucket(undefined, 'Pleasure Craft'), 'recreational')
  assert.equal(f.vesselBucket(undefined, 'Dredging/Underwater Ops'), 'service')
  assert.equal(f.vesselBucket(undefined, undefined), 'unknown')
  const boat = T({ type: 'sea', shipCategory: 'cargo', vesselStationary: true })
  assert.equal(f.trackPassesFacets(boat, { 'vessel.type': ['cargo'], 'vessel.motion': ['stationary'] }), true)
  assert.equal(f.trackPassesFacets(boat, { 'vessel.motion': ['moving'] }), false)

  // APRS stations outside the known types are "other".
  assert.equal(f.trackPassesFacets(T({ type: 'ground', stationType: 'weather' }), { 'aprs.station': ['weather'] }), true)
  assert.equal(f.trackPassesFacets(T({ type: 'ground', stationType: 'marine' }), { 'aprs.station': ['other'] }), true)
  assert.equal(f.trackPassesFacets(T({ type: 'ground' }), { 'aprs.station': ['weather'] }), false)

  // Mesh nodes use the contact type.
  const node = (contact_type) => ({ entity_id: 'n', entity_type: 'mesh_node', identity: { contact_type } })
  assert.equal(f.meshBucket('Chat Node'), 'chat')
  assert.equal(f.meshBucket('Room Server'), 'room')
  assert.equal(f.meshBucket('weird'), 'unknown')
  assert.equal(f.meshPassesFacets(node('Repeater'), { 'mesh.node': ['repeater'] }), true)
  assert.equal(f.meshPassesFacets(node('Chat Node'), { 'mesh.node': ['repeater'] }), false)
  assert.equal(f.meshPassesFacets(node('Chat Node'), {}), true)

  assert.equal(f.activeFacetCount('aircraft', { 'aircraft.kind': ['light', 'uav'], 'aircraft.who': ['fire'], 'aprs.station': ['weather'] }), 3)

  // The visible-track cache re-filters when only the sub-filters change.
  const { VisibleTrackCache } = await server.ssrLoadModule('/src/layers/visibleTracks.ts')
  const cache = new VisibleTrackCache()
  const entityFilter = { aircraft: true, adsbLocal: true, adsbSupplement: true, vessel: true, mesh_node: true, aprs: true, fire_incident: true, satellite: true, rf_sensor: true, train: true, bus: true }
  const tracks = { a: T({ uid: 'a', aircraftClass: 'light' }), b: T({ uid: 'b', aircraftClass: 'airliner' }) }
  const all = cache.get(tracks, entityFilter, '', [0, 60000], [0, 600], {})
  assert.deepEqual(Object.keys(all).sort(), ['a', 'b'])
  const onlyLight = cache.get(tracks, entityFilter, '', [0, 60000], [0, 600], { 'aircraft.kind': ['light'] })
  assert.deepEqual(Object.keys(onlyLight), ['a'])
  console.log('entity-facets: ok')
} finally {
  await server.close()
}
