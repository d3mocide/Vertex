export async function exportDashboardSnapshot(): Promise<void> {
  const mlCanvas = document.querySelector('.maplibregl-canvas') as HTMLCanvasElement | null
  const deckCanvas = document.getElementById('deck-overlay-canvas') as HTMLCanvasElement | null

  if (!mlCanvas) {
    console.warn('[snapshot] MapLibre canvas not found')
    return
  }

  const w = mlCanvas.width
  const h = mlCanvas.height

  const composite = document.createElement('canvas')
  composite.width = w
  composite.height = h
  const ctx = composite.getContext('2d')
  if (!ctx) return

  ctx.drawImage(mlCanvas, 0, 0)
  if (deckCanvas && deckCanvas.width > 0 && deckCanvas.height > 0) {
    ctx.drawImage(deckCanvas, 0, 0, w, h)
  }

  const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5)
  const link = document.createElement('a')
  link.download = `vertex-snapshot-${ts}.png`
  try {
    link.href = composite.toDataURL('image/png')
  } catch {
    console.warn('[snapshot] toDataURL failed — cross-origin tiles may be blocking canvas export')
    return
  }
  link.click()
}
