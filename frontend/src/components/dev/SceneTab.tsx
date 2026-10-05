import { useEffect, useState } from 'react'
import { getDevMap, getScene, type SceneSnapshot } from '../../devtools/devState'
import { gpuRenderer, isSoftwareRenderer } from '../../perfRecorder'
import { Row, SectionLabel } from './LayoutTab'
import { terrainHeight, terrainStats } from '../../layers/terrainElevation'

interface Camera { zoom: number; pitch: number; bearing: number; lat: number; lng: number; canvas: string }

function readCamera(): Camera | null {
  const map = getDevMap()
  if (!map) return null
  const c = map.getCenter()
  const canvas = map.getCanvas()
  return {
    zoom: Math.round(map.getZoom() * 100) / 100, pitch: Math.round(map.getPitch()),
    bearing: Math.round(map.getBearing()), lat: Math.round(c.lat * 1e4) / 1e4, lng: Math.round(c.lng * 1e4) / 1e4,
    canvas: `${canvas.width}×${canvas.height}`,
  }
}

function rawElevation(): string {
  const map = getDevMap()
  if (!map) return '—'
  try {
    const e = map.queryTerrainElevation(map.getCenter())
    return `${e == null ? 'null' : Math.round(e)} m · terrain ${map.getTerrain() ? 'set' : 'not set'}`
  } catch { return 'error' }
}

export function SceneTab() {
  const [scene, setSceneState] = useState<SceneSnapshot | null>(() => getScene())
  const [camera, setCamera] = useState<Camera | null>(() => readCamera())

  useEffect(() => {
    const id = window.setInterval(() => { setSceneState(getScene()); setCamera(readCamera()) }, 1000)
    return () => window.clearInterval(id)
  }, [])

  const gpu = gpuRenderer()
  const terrain = terrainStats()
  const heaviest = scene ? [...scene.layers].filter(l => l.count != null).sort((a, b) => (b.count ?? 0) - (a.count ?? 0)).slice(0, 12) : []
  const totalItems = scene ? scene.layers.reduce((a, l) => a + (l.count ?? 0), 0) : 0

  return (
    <div className="stack-y-1.5 text-[10px]">
      <SectionLabel>Renderer</SectionLabel>
      <div className={`font-mono wrap-break-word ${isSoftwareRenderer(gpu) ? 'text-red-emergency' : 'text-amber-gold'}`}>{gpu}</div>
      {isSoftwareRenderer(gpu) && <div className="text-on-surface-variant">Software rendering: frame times here are not GPU numbers.</div>}
      <Row label="devicePixelRatio" value={window.devicePixelRatio} />
      <Row label="CPU threads" value={navigator.hardwareConcurrency ?? '—'} />

      <SectionLabel divider>Camera</SectionLabel>
      {camera ? (
        <>
          <Row label="zoom / pitch / bearing" value={`${camera.zoom} / ${camera.pitch}° / ${camera.bearing}°`} />
          <Row label="center" value={`${camera.lat}, ${camera.lng}`} />
          <Row label="canvas" value={camera.canvas} />
        </>
      ) : <div className="text-on-surface-variant">The map is not ready yet.</div>}

      <SectionLabel divider>Terrain</SectionLabel>
      {terrain.active ? (
        <>
          <Row label="exaggeration" value={`${terrain.exaggeration.toFixed(1)}×`} />
          <Row label="ground at center" value={camera ? `${Math.round(terrainHeight(camera.lng, camera.lat))} m` : '—'} />
          <Row label="MapLibre says" value={rawElevation()} />
          <Row label="cached cells / waiting" value={`${terrain.cachedCells} / ${terrain.pendingLookups}`} />
        </>
      ) : <div className="text-on-surface-variant">3D terrain is off.</div>}

      <SectionLabel divider>Scene</SectionLabel>
      {scene ? (
        <>
          <Row label="tracks (visible)" value={scene.tracks} />
          <Row label="entities" value={scene.entities} />
          <Row label="deck layers submitted" value={scene.layers.length} />
          <Row label="items across array layers" value={totalItems} />
          <SectionLabel divider>Heaviest layers (items)</SectionLabel>
          {heaviest.map((l) => <Row key={l.id} label={l.id} value={l.count ?? '—'} />)}
        </>
      ) : <div className="text-on-surface-variant">Waiting for the map to submit layers…</div>}
    </div>
  )
}
