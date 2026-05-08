// Atlas icon system — 8 categories on a 32×32 design grid, rendered to 64px canvas cells.
// Layout: 4 cols × 3 rows = 256×192 px atlas.
//
// Row 0: aircraft | vessel | mesh    | aprs
// Row 1: stream   | lightning | fire | camera
// Row 2: ring     | dot    | halo    | tak_client

export interface IconAtlasResult {
  url: string
  width: number
  height: number
  mapping: Record<string, {
    x: number; y: number; width: number; height: number
    anchorX: number; anchorY: number; mask: boolean
  }>
}

const CELL = 64

function cellOrigin(col: number, row: number): [number, number] {
  return [col * CELL, row * CELL]
}

function entry(col: number, row: number) {
  return {
    x: col * CELL, y: row * CELL,
    width: CELL, height: CELL,
    anchorX: CELL / 2, anchorY: CELL / 2,
    mask: true,
  }
}

export function createAtlasIcons(): IconAtlasResult {
  const canvas = document.createElement('canvas')
  canvas.width  = CELL * 4   // 256
  canvas.height = CELL * 3   // 192
  const ctx = canvas.getContext('2d')!

  const W = '#ffffff'
  const B = '#000000'

  // ─── Row 0, Col 0 · AIRCRAFT — clean chevron (CoT-style) ─────────────────
  {
    const [ox, oy] = cellOrigin(0, 0)
    ctx.fillStyle = W
    ctx.beginPath()
    ctx.moveTo(ox + 32, oy + 8)   // nose
    ctx.lineTo(ox + 46, oy + 44)  // right tip
    ctx.lineTo(ox + 32, oy + 38)  // tail notch
    ctx.lineTo(ox + 18, oy + 44)  // left tip
    ctx.closePath()
    ctx.fill()
  }

  // ─── Row 0, Col 1 · VESSEL — clean chevron (CoT-style) ───────────────────
  {
    const [ox, oy] = cellOrigin(1, 0)
    ctx.fillStyle = W
    ctx.beginPath()
    ctx.moveTo(ox + 32, oy + 8)   // nose
    ctx.lineTo(ox + 46, oy + 44)  // right tip
    ctx.lineTo(ox + 32, oy + 38)  // tail notch
    ctx.lineTo(ox + 18, oy + 44)  // left tip
    ctx.closePath()
    ctx.fill()
  }

  // ─── Row 0, Col 2 · MESH NODE — hex chip with inner square void ───────────
  {
    const [ox, oy] = cellOrigin(2, 0)
    ctx.fillStyle = W
    ctx.beginPath()
    ctx.moveTo(ox + 32, oy + 8)
    ctx.lineTo(ox + 52, oy + 20)
    ctx.lineTo(ox + 52, oy + 44)
    ctx.lineTo(ox + 32, oy + 56)
    ctx.lineTo(ox + 12, oy + 44)
    ctx.lineTo(ox + 12, oy + 20)
    ctx.closePath()
    ctx.fill()
    ctx.fillStyle = B
    ctx.fillRect(ox + 26, oy + 26, 12, 12)  // inner void
  }

  // ─── Row 0, Col 3 · APRS — stroke diamond + crosshair lines + center dot ───
  // Matches atlas-aprs SVG: outline polygon, inner crosshair, filled center dot.
  {
    const [ox, oy] = cellOrigin(3, 0)
    ctx.strokeStyle = W
    ctx.lineWidth   = 3.2   // SVG stroke-width 1.6 × scale 2
    ctx.lineJoin    = 'miter'
    ctx.lineCap     = 'square'
    // Diamond outline (SVG points 16,5 27,16 16,27 5,16 scaled ×2)
    ctx.beginPath()
    ctx.moveTo(ox + 32, oy + 10)
    ctx.lineTo(ox + 54, oy + 32)
    ctx.lineTo(ox + 32, oy + 54)
    ctx.lineTo(ox + 10, oy + 32)
    ctx.closePath()
    ctx.stroke()
    // Crosshair lines (SVG: x1=16,y1=11 to 16,21 and x1=11,y1=16 to 21,16, scaled ×2)
    ctx.beginPath()
    ctx.moveTo(ox + 32, oy + 22)
    ctx.lineTo(ox + 32, oy + 42)
    ctx.stroke()
    ctx.beginPath()
    ctx.moveTo(ox + 22, oy + 32)
    ctx.lineTo(ox + 42, oy + 32)
    ctx.stroke()
    // Center dot (SVG r=2.2 scaled ×2)
    ctx.fillStyle = W
    ctx.beginPath()
    ctx.arc(ox + 32, oy + 32, 4.4, 0, Math.PI * 2)
    ctx.fill()
  }

  // ─── Row 1, Col 0 · STREAM GAUGE — outlined tower + tick marks + water fill
  // Matches atlas-stream SVG: stroked rect, left-side ticks, filled lower portion, cap.
  {
    const [ox, oy] = cellOrigin(0, 1)
    ctx.strokeStyle = W
    ctx.lineWidth   = 3.2
    ctx.lineJoin    = 'miter'
    ctx.lineCap     = 'square'
    // Gauge tower outline (SVG rect x=9,y=5,w=14,h=22 scaled ×2)
    ctx.strokeRect(ox + 18, oy + 10, 28, 44)
    // Tick marks on left side (SVG ticks at y=11,16,21 scaled ×2 → y=22,32,42)
    ctx.beginPath()
    ctx.moveTo(ox + 18, oy + 22); ctx.lineTo(ox + 26, oy + 22)
    ctx.moveTo(ox + 18, oy + 32); ctx.lineTo(ox + 26, oy + 32)
    ctx.moveTo(ox + 18, oy + 42); ctx.lineTo(ox + 26, oy + 42)
    ctx.stroke()
    // Water level fill — lower ~37% of tower interior
    ctx.fillStyle = W
    ctx.fillRect(ox + 20, oy + 36, 24, 16)
    // Top cap (SVG rect x=13,y=3,w=6,h=2 scaled ×2)
    ctx.fillRect(ox + 26, oy +  6, 12, 4)
  }

  // ─── Row 1, Col 1 · LIGHTNING — bolt ──────────────────────────────────────
  {
    const [ox, oy] = cellOrigin(1, 1)
    ctx.fillStyle = W
    ctx.beginPath()
    // SVG M18,3 L7,18 L14,18 L12,29 L25,13 L17,13 L20,3 scaled 2× from (0,0)
    ctx.moveTo(ox + 36, oy + 6)
    ctx.lineTo(ox + 14, oy + 36)
    ctx.lineTo(ox + 28, oy + 36)
    ctx.lineTo(ox + 24, oy + 58)
    ctx.lineTo(ox + 50, oy + 26)
    ctx.lineTo(ox + 34, oy + 26)
    ctx.lineTo(ox + 40, oy + 6)
    ctx.closePath()
    ctx.fill()
  }

  // ─── Row 1, Col 2 · FIRE — flame with inner core void ────────────────────
  {
    const [ox, oy] = cellOrigin(2, 1)
    ctx.fillStyle = W
    ctx.beginPath()
    ctx.moveTo(ox + 32, oy + 6)
    ctx.bezierCurveTo(ox + 38, oy + 16, ox + 46, oy + 20, ox + 46, oy + 32)
    ctx.bezierCurveTo(ox + 46, oy + 44, ox + 38, oy + 54, ox + 32, oy + 56)
    ctx.bezierCurveTo(ox + 26, oy + 54, ox + 18, oy + 44, ox + 18, oy + 32)
    ctx.bezierCurveTo(ox + 18, oy + 24, ox + 22, oy + 22, ox + 26, oy + 18)
    ctx.bezierCurveTo(ox + 26, oy + 26, ox + 32, oy + 26, ox + 28, oy + 18)
    ctx.bezierCurveTo(ox + 30, oy + 14, ox + 32, oy + 10, ox + 32, oy + 6)
    ctx.closePath()
    ctx.fill()
    // inner core void
    ctx.fillStyle = B
    ctx.beginPath()
    ctx.moveTo(ox + 32, oy + 28)
    ctx.bezierCurveTo(ox + 36, oy + 34, ox + 38, oy + 38, ox + 38, oy + 44)
    ctx.bezierCurveTo(ox + 38, oy + 50, ox + 34, oy + 52, ox + 32, oy + 52)
    ctx.bezierCurveTo(ox + 30, oy + 52, ox + 26, oy + 50, ox + 26, oy + 44)
    ctx.bezierCurveTo(ox + 26, oy + 38, ox + 28, oy + 34, ox + 32, oy + 28)
    ctx.closePath()
    ctx.fill()
  }

  // ─── Row 1, Col 3 · CAMERA — CCTV housing + mount + lens ─────────────────
  {
    const [ox, oy] = cellOrigin(3, 1)
    ctx.fillStyle = W
    // body trapezoid
    ctx.beginPath()
    ctx.moveTo(ox + 10, oy + 22)
    ctx.lineTo(ox + 48, oy + 16)
    ctx.lineTo(ox + 48, oy + 40)
    ctx.lineTo(ox + 10, oy + 34)
    ctx.closePath()
    ctx.fill()
    ctx.fillRect(ox + 20, oy + 34, 4, 18)  // mount post
    ctx.fillRect(ox + 12, oy + 50, 20, 4)  // base
    // lens cutout
    ctx.fillStyle = B
    ctx.beginPath()
    ctx.arc(ox + 28, oy + 28, 7, 0, Math.PI * 2)
    ctx.fill()
    // lens center dot
    ctx.fillStyle = W
    ctx.beginPath()
    ctx.arc(ox + 28, oy + 28, 3, 0, Math.PI * 2)
    ctx.fill()
  }

  // ─── Row 2, Col 0 · RING — annulus + center dot (zoom mid) ───────────────
  {
    const [ox, oy] = cellOrigin(0, 2)
    ctx.fillStyle = W
    ctx.beginPath()
    ctx.arc(ox + 32, oy + 32, 22, 0, Math.PI * 2)
    ctx.fill()
    ctx.fillStyle = B
    ctx.beginPath()
    ctx.arc(ox + 32, oy + 32, 14, 0, Math.PI * 2)
    ctx.fill()
    ctx.fillStyle = W
    ctx.beginPath()
    ctx.arc(ox + 32, oy + 32, 6, 0, Math.PI * 2)
    ctx.fill()
  }

  // ─── Row 2, Col 1 · DOT — solid circle (zoom min) ────────────────────────
  {
    const [ox, oy] = cellOrigin(1, 2)
    ctx.fillStyle = W
    ctx.beginPath()
    ctx.arc(ox + 32, oy + 32, 16, 0, Math.PI * 2)
    ctx.fill()
  }

  // ─── Row 2, Col 2 · HALO — radial glow for special-category entities ──────
  {
    const [ox, oy] = cellOrigin(2, 2)
    const hx = ox + 32, hy = oy + 32
    const grad = ctx.createRadialGradient(hx, hy, 0, hx, hy, 30)
    grad.addColorStop(0.00, 'rgba(255,255,255,1.0)')
    grad.addColorStop(0.30, 'rgba(255,255,255,0.6)')
    grad.addColorStop(0.70, 'rgba(255,255,255,0.2)')
    grad.addColorStop(1.00, 'rgba(255,255,255,0.0)')
    ctx.fillStyle = grad
    ctx.fillRect(ox, oy, CELL, CELL)
  }

  // ─── Row 2, Col 3 · TAK CLIENT — person silhouette (head + torso) ─────────
  // Matches CoT military symbology for a friendly ground individual (a-f-G-U-C-I).
  {
    const [ox, oy] = cellOrigin(3, 2)
    ctx.fillStyle = W
    // Head — circle
    ctx.beginPath()
    ctx.arc(ox + 32, oy + 16, 8, 0, Math.PI * 2)
    ctx.fill()
    // Torso — rounded trapezoid (shoulders wider than waist)
    ctx.beginPath()
    ctx.moveTo(ox + 18, oy + 28)   // left shoulder
    ctx.lineTo(ox + 46, oy + 28)   // right shoulder
    ctx.lineTo(ox + 40, oy + 52)   // right hip
    ctx.lineTo(ox + 24, oy + 52)   // left hip
    ctx.closePath()
    ctx.fill()
  }

  return {
    url:    canvas.toDataURL(),
    width:  canvas.width,
    height: canvas.height,
    mapping: {
      aircraft:  entry(0, 0),
      vessel:    entry(1, 0),
      mesh:      entry(2, 0),
      aprs:      entry(3, 0),
      stream:    entry(0, 1),
      lightning: entry(1, 1),
      fire:      entry(2, 1),
      camera:    entry(3, 1),
      ring:       entry(0, 2),
      dot:        entry(1, 2),
      halo:       entry(2, 2),
      tak_client: entry(3, 2),
    },
  }
}

let _cache: IconAtlasResult | null = null
export function getAtlasIcons(): IconAtlasResult {
  if (!_cache) _cache = createAtlasIcons()
  return _cache
}
