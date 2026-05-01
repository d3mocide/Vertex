export interface IconAtlasResult {
  url: string
  width: number
  height: number
  mapping: Record<string, {
    x: number; y: number; width: number; height: number
    anchorX: number; anchorY: number; mask: boolean
  }>
}

export function createIconAtlas(): IconAtlasResult {
  const CELL = 64
  const canvas = document.createElement('canvas')
  canvas.width  = CELL * 3  // 192
  canvas.height = CELL * 2  // 128
  const ctx = canvas.getContext('2d')!

  ctx.fillStyle = '#ffffff'

  // aircraft chevron — top-left cell
  const [ax, ay] = [CELL / 2, CELL / 2]
  ctx.beginPath()
  ctx.moveTo(ax,       ay - 16)   // nose
  ctx.lineTo(ax + 12,  ay + 8)    // right wingtip
  ctx.lineTo(ax,       ay + 4)    // tail notch
  ctx.lineTo(ax - 12,  ay + 8)    // left wingtip
  ctx.closePath()
  ctx.fill()

  // vessel chevron — top-right cell
  const [vx, vy] = [CELL + CELL / 2, CELL / 2]
  ctx.beginPath()
  ctx.moveTo(vx,       vy - 16)
  ctx.lineTo(vx + 12,  vy + 8)
  ctx.lineTo(vx,       vy + 4)
  ctx.lineTo(vx - 12,  vy + 8)
  ctx.closePath()
  ctx.fill()

  // halo glow — bottom-left cell
  const [hx, hy] = [CELL / 2, CELL + CELL / 2]
  const grad = ctx.createRadialGradient(hx, hy, 0, hx, hy, 30)
  grad.addColorStop(0,    'rgba(255,255,255,1.0)')
  grad.addColorStop(0.30, 'rgba(255,255,255,0.6)')
  grad.addColorStop(0.70, 'rgba(255,255,255,0.2)')
  grad.addColorStop(1.0,  'rgba(255,255,255,0.0)')
  ctx.fillStyle = grad
  ctx.fillRect(0, CELL, CELL, CELL)

  // APRS diamond — bottom-middle cell
  const [gx, gy] = [CELL + CELL / 2, CELL + CELL / 2]
  ctx.fillStyle = '#ffffff'
  ctx.beginPath()
  ctx.moveTo(gx, gy - 12)
  ctx.lineTo(gx + 10, gy)
  ctx.lineTo(gx, gy + 12)
  ctx.lineTo(gx - 10, gy)
  ctx.closePath()
  ctx.fill()

  // Fire icon — bottom-right cell
  const [fx, fy] = [CELL * 2 + CELL / 2, CELL + CELL / 2]
  ctx.beginPath()
  ctx.moveTo(fx, fy - 14)
  ctx.bezierCurveTo(fx + 12, fy - 4, fx + 10, fy + 10, fx, fy + 14)
  ctx.bezierCurveTo(fx - 10, fy + 10, fx - 12, fy - 4, fx, fy - 14)
  ctx.closePath()
  ctx.fill()

  return {
    url:    canvas.toDataURL(),
    width:  canvas.width,
    height: canvas.height,
    mapping: {
      aircraft: { x: 0,    y: 0,    width: CELL, height: CELL, anchorX: CELL / 2, anchorY: CELL / 2, mask: true },
      vessel:   { x: CELL, y: 0,    width: CELL, height: CELL, anchorX: CELL / 2, anchorY: CELL / 2, mask: true },
      halo:     { x: 0,    y: CELL, width: CELL, height: CELL, anchorX: CELL / 2, anchorY: CELL / 2, mask: true },
      aprs:     { x: CELL, y: CELL, width: CELL, height: CELL, anchorX: CELL / 2, anchorY: CELL / 2, mask: true },
      fire:     { x: CELL * 2, y: CELL, width: CELL, height: CELL, anchorX: CELL / 2, anchorY: CELL / 2, mask: true },
    },
  }
}

let _cache: IconAtlasResult | null = null
export function getIconAtlas(): IconAtlasResult {
  if (!_cache) _cache = createIconAtlas()
  return _cache
}
