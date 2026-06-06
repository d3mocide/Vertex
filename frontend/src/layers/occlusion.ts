// Shared helpers for terrain-aware (interleaved) deck.gl rendering.
//
// In interleaved mode (MapboxOverlay), deck.gl layers share MapLibre's depth
// buffer, so a layer can be occluded by the 3-D terrain mesh. We opt specific
// layers IN to occlusion via `depthTest: true`; everything else draws on top so
// situational-awareness markers and labels are never hidden inside a hill.
//
// The overlay's default parameters draw "always on top", so layers without an
// explicit override keep the flat, always-on-top behaviour of the legacy canvas
// overlay — which is also exactly what we want when 3-D mode is off.
//
// deck.gl v9 uses luma.gl's WebGPU-style parameters: `depthCompare` replaces the
// old `depthTest` boolean. We never write depth (transparent sprites/lines), we
// only test against the terrain mesh MapLibre already wrote.

/** Depth-test against terrain — use for aircraft (at altitude) and vessels. */
export const DEPTH_OCCLUDE = { depthCompare: 'less-equal' as const, depthWriteEnabled: false }

/** Ignore the depth buffer — always draw on top. The overlay-wide default. */
export const DEPTH_ON_TOP = { depthCompare: 'always' as const, depthWriteEnabled: false }

/** Types whose geometry is meaningful in Z and should be occluded by terrain. */
export function isOccludable(type: string): boolean {
  return type === 'air' || type === 'sea'
}
