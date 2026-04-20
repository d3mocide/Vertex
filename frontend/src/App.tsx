import { Map } from './components/Map'
import { AlertBanner } from './components/panels/AlertBanner'
import { StatusBar } from './components/panels/StatusBar'
import { EntityDetail } from './components/panels/EntityDetail'
import { AudioPlayer } from './components/panels/AudioPlayer'
import { TalkgroupBanner } from './components/panels/TalkgroupBanner'

export default function App() {
  return (
    <div style={{ width: '100vw', height: '100vh', position: 'relative' }}>
      <Map />
      <AlertBanner />
      <StatusBar />
      <EntityDetail />
      <TalkgroupBanner />
      <AudioPlayer />
    </div>
  )
}
