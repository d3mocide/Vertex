import React from 'react'
import { DocHeader, DocSection, DocText, DocCard, DocGrid, DocList, DocCallout, DocCode, AtlasIcon } from '../components/docs/DocComponents'

// Operational colors matching the application's design system
const COLORS = {
  AIR: '#00FF64',
  SEA: '#0090C8',
  MESH: '#FF8F00',
  APRS: '#B388FF',
  STREAM: '#4FC3F7',
  FIRE: '#FF5252',
  TAK: '#00E6B4',
  LIGHTNING: '#FFFF64',
  CAMERA: '#FFFFFF'
}

export interface DocPage {
  id: string
  title: string
  content: React.ReactNode
  section: string
}

const gettingStarted = (
  <div className="space-y-6">
    <DocHeader 
      title="Getting Started with Vertex" 
      subtitle="Unified Situational Awareness Platform"
    />
    
    <DocSection title="The Operating Paradigm">
      <DocText>
        Vertex is designed to aggregate real-time data from local sensors and remote APIs into a single, cohesive operating picture. It operates in two primary modes:
      </DocText>
      <DocGrid>
        <DocCard 
          icon={<AtlasIcon name="aircraft" color={COLORS.AIR} size={20} />} 
          title="Safety (Map View)" 
          description="A high-performance, interactive map where all live entities (aircraft, vessels, ground units) and environmental layers are rendered."
          badge="Live"
        />
        <DocCard 
          icon="dashboard" 
          title="Dashboard (Panel View)" 
          description="Deep context on specific domains like Weather, Infrastructure, or Community RF, overlaid on the map."
        />
      </DocGrid>
    </DocSection>

    <DocSection title="Quick Navigation" delay={100}>
      <DocList items={[
        <span key="sidebar"><strong>Sidebar</strong>: The left-hand navigation allows you to switch between major domains.</span>,
        <span key="header"><strong>Header</strong>: Contains the global search bar and system status indicators.</span>,
        <span key="envbar"><strong>Environment Bar</strong>: Located just below the header, showing your primary station's current weather and regional hazard status.</span>,
        <span key="audio"><strong>Tactical Audio</strong>: The bottom-right corner houses the live audio stream controller for monitoring radio traffic.</span>
      ]} />
    </DocSection>

    <DocCallout title="Pro Tip" type="info">
      Most data in Vertex is automatically clipped to your configured <strong>Region of Interest (ROI)</strong>. If you don&apos;t see data you expect, check your bounding box settings in the Admin panel.
    </DocCallout>

    <DocSection title="Interacting with Data" delay={200}>
      <DocGrid>
        <DocCard 
          icon="touch_app" 
          title="Hover for Tooltip" 
          description="Move your cursor over any map icon to see identification and vital statistics."
        />
        <DocCard 
          icon="info" 
          title="Click for Detail" 
          description="Select an entity to open the detail panel with full telemetry and historical tracks."
        />
      </DocGrid>
    </DocSection>
  </div>
)

const interfaceOverview = (
  <div className="space-y-6">
    <DocHeader title="Interface & Navigation" subtitle="High-Density Information Display" />
    
    <DocSection title="The Sidebar">
      <DocText>
        The sidebar is your primary tool for navigating the various domains of the application. Each tab focuses on a specific data source or operational need:
      </DocText>
      <DocGrid>
        <DocCard icon="map" title="Safety" description="The main map view where all layers and entities are visible." />
        <DocCard icon="construction" title="Infrastructure" description="Traffic cameras, road sensors, and corridor monitoring." />
        <DocCard icon="thermostat" title="Environment" description="Weather observations, METAR/TAF, and wildfire perimeters." />
        <DocCard icon="groups" title="Community" description="APRS traffic, Mesh Networking, and community stations." />
        <DocCard icon="warning" title="Incidents" description="Real-time traffic incidents and emergency alerts." />
        <DocCard icon="radio" title="Comms" description="Dedicated space for Mesh messages and Radio talkgroups." />
      </DocGrid>
    </DocSection>

    <DocSection title="The Header" delay={100}>
      <DocText>
        The top bar provides global context and search capabilities. It remains persistent across all views.
      </DocText>
      <DocList items={[
        "Global Search: Find entities by callsign, ID, or name.",
        "System Health: Real-time indicators of backend and poller status.",
        "Settings: Toggle map layers and adjust application preferences."
      ]} />
    </DocSection>
  </div>
)

const mapLayers = (
  <div className="space-y-6">
    <DocHeader title="Map Layers & Interaction" subtitle="Raster Imagery & Vector Data" />
    
    <DocSection title="Environmental Overlays">
      <DocText>
        Toggle these layers via the <strong>Settings</strong> panel to gain better environmental context:
      </DocText>
      <DocGrid>
        <DocCard icon="radar" title="NEXRAD Radar" description="Real-time precipitation and storm tracking." />
        <DocCard icon="satellite" title="GOES Satellite" description="High-resolution imagery in IR and Visible modes." />
        <DocCard 
          icon={<AtlasIcon name="lightning" color={COLORS.LIGHTNING} size={20} />} 
          title="Regional Alerts" 
          description="Geographic polygons for active weather watches and warnings." 
        />
        <DocCard 
          icon={<AtlasIcon name="fire" color={COLORS.FIRE} size={20} />} 
          title="Fire Perimeters" 
          description="Updated NIFC/WFIGS polygon perimeters for active wildfires." 
        />
      </DocGrid>
    </DocSection>

    <DocSection title="Icon Identification" delay={100}>
      <DocText>
        Vertex uses dynamic icons that change appearance based on your zoom level. At high zoom, these high-fidelity tactical icons are used:
      </DocText>
      <div className="overflow-hidden border border-white/10 rounded-xl bg-white/[0.02]">
        <table className="w-full text-left text-[11px] font-mono">
          <thead className="bg-white/5 text-amber-gold uppercase tracking-widest font-bold">
            <tr>
              <th className="px-4 py-3">Symbol</th>
              <th className="px-4 py-3">Type</th>
              <th className="px-4 py-3">Source</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/5 text-on-surface-variant">
            {[
              { icon: 'aircraft',  color: COLORS.AIR,       type: 'Aircraft',        src: 'ADS-B (Local/OpenSky)' },
              { icon: 'vessel',    color: COLORS.SEA,       type: 'Vessel',          src: 'AIS (Local/AISstream)' },
              { icon: 'tak_client',color: COLORS.TAK,       type: 'TAK Client',      src: 'ATAK / WinTAK / iTAK' },
              { icon: 'mesh',      color: COLORS.MESH,      type: 'Mesh Node',       src: 'MeshCore / Meshtastic' },
              { icon: 'aprs',      color: COLORS.APRS,      type: 'APRS Station',    src: 'Amateur Radio Network' },
              { icon: 'stream',    color: COLORS.STREAM,    src: 'USGS Stream Gauges', type: 'River Gauge' },
              { icon: 'fire',      color: COLORS.FIRE,      src: 'NIFC / WFIGS',     type: 'Wildfire' },
              { icon: 'lightning', color: COLORS.LIGHTNING, src: 'NWS / Lightning',  type: 'Strike' },
              { icon: 'camera',    color: COLORS.CAMERA,    src: 'DOT Cameras',      type: 'Traffic Cam' },
            ].map((item, i) => (
              <tr key={i} className="hover:bg-white/[0.02] transition-colors">
                <td className="px-4 py-3">
                  <AtlasIcon name={item.icon} color={item.color} size={20} />
                </td>
                <td className="px-4 py-3 font-bold text-white">{item.type}</td>
                <td className="px-4 py-3">{item.src}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </DocSection>
  </div>
)

const analysisTools = (
  <div className="space-y-6">
    <DocHeader title="Tactical Analysis Tools" subtitle="History, Geofencing, & Annotations" />
    
    <DocSection title="Historical Playback">
      <DocText>
        The <strong>Playback Controller</strong> allows you to reconstruct past events by scrubbing through historical telemetry and weather data.
      </DocText>
      <DocList items={[
        "Select a predefined time window (e.g., 6h, 24h) or custom range.",
        "Use the scrubber to move through time.",
        "Observe entity tracks and layer states at the selected timestamp."
      ]} />
    </DocSection>

    <DocSection title="Geofencing" delay={100}>
      <DocGrid>
        <DocCard 
          icon="verified_user" 
          title="Define Boundaries" 
          description="Create circular or polygonal zones on the map."
        />
        <DocCard 
          icon="notifications_active" 
          title="Trigger Alerts" 
          description="Log entry/exit events and dispatch webhooks."
        />
      </DocGrid>
    </DocSection>

    <DocSection title="Map Annotations" delay={200}>
      <DocText>
        Use the <strong>Annotation Controller</strong> to draw directly on the map. Annotations are persisted to the database and shared across all sessions.
      </DocText>
      <DocList items={[
        "Marker: Drop labels with custom icons.",
        "Line: Draw tactical boundaries or paths.",
        "Polygon: Highlight search areas or incident zones."
      ]} />
    </DocSection>
  </div>
)

const infoPanels = (
  <div className="space-y-6">
    <DocHeader title="Information Panels" subtitle="Domain-Specific Dashboards" />
    
    <DocSection title="Environment Dashboard">
      <DocText>
        The Environment panel is your primary source for weather and regional hazard monitoring.
      </DocText>
      <DocGrid>
        <DocCard 
          icon={<AtlasIcon name="aircraft" color={COLORS.AIR} size={20} />} 
          title="Aviation Weather" 
          description="Real-time METAR/TAF with flight category coding." 
        />
        <DocCard icon="description" title="Text Products" description="Area Forecast Discussions (AFD) and HWO logs." />
        <DocCard icon="volcano" title="Seismic" description="Global and regional earthquake events with depth markers." />
        <DocCard 
          icon={<AtlasIcon name="stream" color={COLORS.STREAM} size={20} />} 
          title="Hydrology" 
          description="Stream gauge stage and discharge from USGS." 
        />
      </DocGrid>
    </DocSection>

    <DocSection title="Infrastructure & Community" delay={100}>
      <DocGrid>
        <DocCard 
          icon={<AtlasIcon name="camera" color={COLORS.CAMERA} size={20} />} 
          title="Traffic Cameras" 
          description="Live regional camera grid with health monitoring." 
        />
        <DocCard 
          icon={<AtlasIcon name="mesh" color={COLORS.MESH} size={20} />} 
          title="Mesh Core" 
          description="Node health, SNR, and battery levels for mesh networks." 
        />
      </DocGrid>
    </DocSection>

    <DocSection title="Tactical Comms" delay={200}>
      <DocText>
        Monitor real-time communications in the <strong>Comms</strong> tab:
      </DocText>
      <DocList items={[
        "Audio Streams: High-fidelity tactical radio channel monitoring.",
        "Mesh Messaging: Real-time text traffic across local RF networks."
      ]} />
    </DocSection>
  </div>
)

const searchFiltering = (
  <div className="space-y-6">
    <DocHeader title="Search & Filtering" subtitle="Managing High-Volume Data" />
    
    <DocSection title="Global Search">
      <DocText>
        The header search bar supports fuzzy matching for several data types:
      </DocText>
      <DocCode code="Search: 'N12345' (Aircraft) | '4560001' (MMSI) | 'I-5 at Main' (Camera)" />
    </DocSection>

    <DocSection title="Entity Filtering" delay={100}>
      <DocText>
        When in the <strong>Safety</strong> view, use the filters in the left-hand panel to focus on specific mission-relevant data:
      </DocText>
      <DocList items={[
        "Type Filters: Toggle Aircraft, Vessels, Ground Units, etc.",
        "Altitude/Speed: Use tactical sliders to isolate specific flight or travel envelopes.",
        "Source Arbitration: Switch between high-fidelity local data and remote supplements."
      ]} />
    </DocSection>
  </div>
)

export const DOC_PAGES: DocPage[] = [
  { id: 'getting-started',    title: 'Getting Started',    section: 'Usage',        content: gettingStarted },
  { id: 'interface',          title: 'Interface & Layout', section: 'Usage',        content: interfaceOverview },
  { id: 'map-layers',         title: 'Map Layers',         section: 'Capabilities', content: mapLayers },
  { id: 'analysis-tools',     title: 'Analysis Tools',     section: 'Capabilities', content: analysisTools },
  { id: 'information-panels', title: 'Data Panels',        section: 'Dashboards',   content: infoPanels },
  { id: 'search-filtering',   title: 'Search & Filtering', section: 'Navigation',   content: searchFiltering },
]
