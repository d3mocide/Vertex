import React from 'react'
import { DocHeader, DocSection, DocText, DocCard, DocGrid, DocList, DocCallout, DocCode, AtlasIcon } from '../components/docs/DocComponents'

// Operational colors matching the application's design system
const COLORS = {
  AIR: '#00FF64',
  SEA: '#0090C8',
  MESH: '#76DD00',
  APRS: '#B388FF',
  STREAM: '#4FC3F7',
  FIRE: '#C62828',
  TAK: '#00E6B4',
  LIGHTNING: '#FFFF64',
  CAMERA: '#FFFFFF',
  TRAIN: '#FFC107'
}

export interface DocPage {
  id: string
  title: string
  content: React.ReactNode
  section: string
}

const gettingStarted = (
  <div className="stack-y-6">
    <DocHeader
      title="Getting Started with Vertex"
      subtitle="Unified Situational Awareness Platform"
    />

    <DocSection title="What You Are Looking At">
      <DocText>
        Vertex pulls live data from local sensors and public feeds into one operating picture: aircraft, vessels, trains, weather, traffic, emergency dispatch, radio and mesh networks. It has two ways of looking at that data:
      </DocText>
      <DocGrid>
        <DocCard
          icon={<AtlasIcon name="aircraft" color={COLORS.AIR} size={20} />}
          title="Overview (Map)"
          description="An interactive map with every live entity and environmental layer, plus search, replay, zones and annotation tools."
          badge="Live"
        />
        <DocCard
          icon="dashboard"
          title="Dashboards (Pages)"
          description="Full-screen pages for a single topic: Incidents, Infrastructure, Environment, Intel Feed, Comms, Flight Log and Event Log."
        />
      </DocGrid>
    </DocSection>

    <DocSection title="Your First Minute" delay={100}>
      <DocList items={[
        <span key="map"><strong>Look at the map.</strong> Icons are colored by what they are and, for aircraft, by altitude. Zoom in and dots turn into detailed icons.</span>,
        <span key="glow"><strong>Spot aircraft with a job.</strong> Air ambulances, rescue, police, fire and military aircraft glow. See Map Layers.</span>,
        <span key="click"><strong>Click anything</strong> for its detail panel; hover for a quick tooltip.</span>,
        <span key="incidents"><strong>Open Incidents</strong> for the AI briefing and what dispatch has been sending out.</span>,
        <span key="audio"><strong>Press play on P25 Live</strong> at the bottom of the screen to listen to radio traffic.</span>
      ]} />
    </DocSection>

    <DocCallout title="Region of Interest" type="info">
      Most data is clipped to your configured <strong>Region of Interest</strong>. If something you expect is missing, it may be outside the region, or its layer may be switched off in Settings.
    </DocCallout>

    <DocSection title="Interacting with Data" delay={200}>
      <DocGrid>
        <DocCard
          icon="touch_app"
          title="Hover for Tooltip"
          description="Move your cursor over any map icon to see identification and key statistics."
        />
        <DocCard
          icon="info"
          title="Click for Detail"
          description="Select an entity to open its detail panel with telemetry, role or owner information, and its track."
        />
      </DocGrid>
    </DocSection>
  </div>
)

const interfaceOverview = (
  <div className="stack-y-6">
    <DocHeader title="Interface & Navigation" subtitle="High-Density Information Display" />

    <DocSection title="The Top Bar">
      <DocText>
        The main navigation runs across the top. Each tab is a page:
      </DocText>
      <DocGrid>
        <DocCard icon="dashboard" title="Overview" description="The live map with all layers and entities." />
        <DocCard icon="report" title="Incidents" description="AI briefing, dispatch incidents heard on P25, weather alerts and major traffic." />
        <DocCard icon="traffic" title="Infrastructure" description="Road closures, freeway corridors, message signs, power outages and cameras." />
        <DocCard icon="eco" title="Environment" description="Weather, forecast, radar, air quality, fire and smoke, and local hazards." />
        <DocCard icon="psychology" title="Intel Feed" description="Local news and emergency newswire, sorted by category." />
        <DocCard icon="forum" title="Comms" description="Mesh chat and network, and the P25 call log with transcripts." />
        <DocCard icon="flight" title="Flight Log" description="Every aircraft seen, with a Notable filter for special-mission aircraft." />
        <DocCard icon="history" title="Event Log" description="A timeline of radio calls, zone crossings and anomalies, with SITREP export." />
      </DocGrid>
      <DocText>
        On the right of the bar: recent-events bell, map snapshot export, this help (the documentation button), and Settings.
      </DocText>
    </DocSection>

    <DocSection title="Advisory Bar & Environment Bar" delay={100}>
      <DocList items={[
        "Advisory bar: a scrolling summary of the current AI briefing headline.",
        "Environment bar: air quality, temperature, wind and whether any NWS alerts are active, plus the region center."
      ]} />
    </DocSection>

    <DocSection title="The Left Rail" delay={150}>
      <DocText>
        On the Overview, the slim rail on the left shows a live count next to each layer (aircraft, vessels, trains, APRS and so on). Click a count to show or hide that layer.
      </DocText>
    </DocSection>

    <DocSection title="Radio Bar" delay={200}>
      <DocText>
        The P25 Live bar at the bottom plays radio traffic as it happens. Use <strong>Channels</strong> to choose which talkgroups you want to hear per receiver.
      </DocText>
    </DocSection>

    <DocSection title="On a Phone" delay={250}>
      <DocText>
        The bottom bar has <strong>Map</strong>, <strong>Alerts</strong>, <strong>Comms</strong> and <strong>Env</strong>. Tap <strong>More</strong> for Infrastructure, Intel, Flights, System Log, Snapshot, Help and Settings. On the map, the <strong>Tools</strong> button opens Replay, Zones and Annotate.
      </DocText>
    </DocSection>
  </div>
)

const mapLayers = (
  <div className="stack-y-6">
    <DocHeader title="Map Layers & Interaction" subtitle="Raster Imagery & Vector Data" />

    <DocSection title="Turning Layers On and Off">
      <DocText>
        Open <strong>Settings</strong> to switch layers. Two groups:
      </DocText>
      <DocGrid>
        <DocCard icon="layers" title="Overlays" description="Radar, Infrared Satellite, Visible Satellite, NWS Alerts, Dispatch Incidents, Lightning, Lightning Density, Fire Perimeters, Fire Danger (ODF / WA DNR), Stream Gauges, Power Outages, Zone Monitor and 3D Terrain." />
        <DocCard icon="tune" title="Entities" description="Aircraft, Vessels, Trains, Rail Tracks, Mesh Nodes, APRS, Fire Incidents, Cameras and History Trails." />
      </DocGrid>
      <DocText>
        Radar opacity and terrain exaggeration have their own sliders.
      </DocText>
    </DocSection>

    <DocSection title="Environmental Overlays" delay={50}>
      <DocGrid>
        <DocCard icon="radar" title="Radar" description="Real-time precipitation and storm tracking." />
        <DocCard icon="satellite_alt" title="Satellite" description="NOAA GOES imagery in infrared and visible." />
        <DocCard
          icon={<AtlasIcon name="lightning" color={COLORS.LIGHTNING} size={20} />}
          title="NWS Alerts"
          description="Polygons for active weather watches and warnings."
        />
        <DocCard
          icon={<AtlasIcon name="fire" color={COLORS.FIRE} size={20} />}
          title="Fire Perimeters & Danger"
          description="Active wildfire perimeters and the state fire-danger level."
        />
        <DocCard icon="power_off" title="Power Outages" description="Areas currently without power, sized by customers affected." />
        <DocCard icon="electric_bolt" title="Lightning Density" description="Where recent lightning strikes are concentrated." />
      </DocGrid>
    </DocSection>

    <DocSection title="Aircraft With a Job" delay={100}>
      <DocText>
        Aircraft whose registration or owner shows a special mission get a soft glow in the shape of the aircraft:
      </DocText>
      <DocList items={[
        <span key="red"><strong style={{ color: '#EF5350' }}>Red</strong>: air ambulance, search and rescue, aerial firefighting</span>,
        <span key="amber"><strong style={{ color: '#FF8F00' }}>Amber</strong>: law enforcement</span>,
        <span key="grey"><strong style={{ color: '#9E9E9E' }}>Grey</strong>: military, news and media, government</span>,
        <span key="squawk"><strong>Pulsing red with a ring</strong>: the aircraft is squawking an emergency code (such as 7700)</span>
      ]} />
      <DocText>
        Roles come from registration and owner records, not from guessing at callsigns. The Flight Log has a Notable filter for these aircraft.
      </DocText>
    </DocSection>

    <DocSection title="Icon Identification" delay={150}>
      <DocText>
        Icons simplify as you zoom out: a dot when far, a ring or basic icon at medium zoom, and the full icon when close. At high zoom these are used:
      </DocText>
      <div className="overflow-hidden border border-white/10 rounded-xl bg-white/2">
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
              { icon: 'aircraft',  color: COLORS.AIR,       type: 'Aircraft',        src: 'Local receiver, airplanes.live / adsb.fi, OpenSky' },
              { icon: 'vessel',    color: COLORS.SEA,       type: 'Vessel',          src: 'AIS (local or AISstream)' },
              { icon: 'train',     color: COLORS.TRAIN,     type: 'Train',           src: 'Amtrak, TriMet MAX / WES' },
              { icon: 'tak_client',color: COLORS.TAK,       type: 'TAK Client',      src: 'ATAK / WinTAK / iTAK' },
              { icon: 'mesh',      color: COLORS.MESH,      type: 'Mesh Node',       src: 'MeshCore / Meshtastic' },
              { icon: 'aprs',      color: COLORS.APRS,      type: 'APRS Station',    src: 'Amateur radio network' },
              { icon: 'rf_sensor', color: COLORS.MESH,      type: 'RF Sensor',       src: 'rtl_433 sensors via MQTT' },
              { icon: 'stream',    color: COLORS.STREAM,    type: 'River Gauge',     src: 'USGS / NWPS stream gauges' },
              { icon: 'fire',      color: COLORS.FIRE,      type: 'Wildfire',        src: 'NIFC / WFIGS, EONET' },
              { icon: 'lightning', color: COLORS.LIGHTNING, type: 'Strike',          src: 'Lightning detection' },
              { icon: 'camera',    color: COLORS.CAMERA,    type: 'Traffic Cam',     src: 'ODOT TripCheck' },
            ].map((item, i) => (
              <tr key={i} className="hover:bg-white/2 transition-colors">
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

    <DocSection title="Dispatch Incidents" delay={200}>
      <DocText>
        Incidents heard on P25 dispatch appear on the map as plates with a symbol for the kind of call. <strong style={{ color: '#EF5350' }}>Red</strong> means life safety; <strong style={{ color: '#FF8F00' }}>amber</strong> is everything else significant. They fade with age, and anything heard in the last hour has a halo. Routine calls stay on the Incidents page.
      </DocText>
      <div className="flex flex-wrap gap-4">
        {[
          { icon: 'dispatch_life',    label: 'Life safety' },
          { icon: 'dispatch_fire',    label: 'Fire' },
          { icon: 'dispatch_medical', label: 'Medical' },
          { icon: 'dispatch_hazard',  label: 'Hazard' },
          { icon: 'dispatch_traffic', label: 'Traffic' },
          { icon: 'dispatch_other',   label: 'Other' },
        ].map((d) => (
          <span key={d.icon} className="flex items-center gap-2 text-[11px] font-mono text-on-surface-variant">
            <AtlasIcon name={d.icon} color="#FF8F00" size={20} /> {d.label}
          </span>
        ))}
      </div>
    </DocSection>

    <DocSection title="The Blue Ring" delay={250}>
      <DocText>
        The light-blue circle on the map marks your receiver range around the region center.
      </DocText>
    </DocSection>
  </div>
)

const analysisTools = (
  <div className="stack-y-6">
    <DocHeader title="Tactical Analysis Tools" subtitle="Replay, Zones, & Annotations" />

    <DocText>
      On the Overview, the <strong>Replay</strong>, <strong>Zones</strong> and <strong>Annotate</strong> buttons sit at the top of the map (under <strong>Tools</strong> on a phone).
    </DocText>

    <DocSection title="Replay">
      <DocText>
        Replay reconstructs past events by scrubbing through recorded tracks.
      </DocText>
      <DocList items={[
        "Pick a window: 1, 2, 6, 12 or 24 hours.",
        "Play, pause or drag the scrubber to move through time; playback runs at 1x, 2x, 5x or 10x.",
        "Watch entity positions and trails at the selected moment."
      ]} />
    </DocSection>

    <DocSection title="Zones (Geofencing)" delay={100}>
      <DocGrid>
        <DocCard
          icon="verified_user"
          title="Define Boundaries"
          description="Create circular or polygonal zones, or look up a city or ZIP boundary."
        />
        <DocCard
          icon="notifications_active"
          title="Trigger Alerts"
          description="Entry and exit events go to the Event Log; alert rules can also send webhooks."
        />
      </DocGrid>
      <DocText>
        Zone colors: amber for alert zones, red for exclusion zones, light blue for info zones, and grey for label-only areas. Show or hide them with <strong>Zone Monitor</strong> in Settings.
      </DocText>
    </DocSection>

    <DocSection title="Annotations" delay={200}>
      <DocText>
        <strong>Annotate</strong> lets you draw directly on the map. Annotations are saved and shared across all sessions.
      </DocText>
      <DocList items={[
        "Marker: drop a label with a custom icon.",
        "Line: draw a boundary or path.",
        "Polygon: highlight a search area or incident zone."
      ]} />
    </DocSection>

    <DocSection title="Snapshots" delay={250}>
      <DocText>
        The camera button in the top bar exports the current map view as an image.
      </DocText>
    </DocSection>
  </div>
)

const infoPanels = (
  <div className="stack-y-6">
    <DocHeader title="Pages & Dashboards" subtitle="What Each Page Shows" />

    <DocSection title="Incidents">
      <DocGrid>
        <DocCard icon="psychology" title="AI Briefing" description="A posture rating (routine, elevated and so on) with the bottom line, what changed since the last briefing, and the full report on demand. It is written by a model running on your own network." />
        <DocCard icon="cell_tower" title="Dispatch Incidents" description="Calls heard on P25, grouped into incidents and located when an address is spoken. Filter by life safety, fire, hazards, traffic, medical, active now, or zone; include routine calls if you want them." />
      </DocGrid>
      <DocText>
        The tiles above show dispatch activity, NWS alerts, major traffic and priority system events at a glance.
      </DocText>
    </DocSection>

    <DocSection title="Infrastructure" delay={50}>
      <DocGrid>
        <DocCard icon="traffic" title="On the Road Now" description="Closures and delays sorted by impact. Ramps are grouped under the closure they belong to, and each item can show a nearby camera." />
        <DocCard icon="route" title="Freeways" description="Live speed and the slowest point on each major freeway corridor." />
        <DocCard icon="signpost" title="Message Signs" description="What the highway signs are currently showing." />
        <DocCard icon="power_off" title="Power" description="Nearby outage reports and per-utility totals, with explicit coverage and update status. Missing or overdue updates mean status is unknown. Cause is not published by the source; weather and lightning appear as context." />
        <DocCard
          icon={<AtlasIcon name="camera" color={COLORS.CAMERA} size={20} />}
          title="Traffic Cameras"
          description="Camera grid with health monitoring."
        />
      </DocGrid>
    </DocSection>

    <DocSection title="Environment" delay={100}>
      <DocGrid>
        <DocCard icon="cloud" title="Conditions & Outlook" description="Temperature, wind, humidity and air quality, the next 24 hours, and the forecast discussion." />
        <DocCard icon="radar" title="Radar Map" description="Tabs for radar, NOAA imagery, alerts, lightning (Bolts) and satellite. NWS map alerts are clipped to your monitoring bounds." />
        <DocCard icon="local_fire_department" title="Fire & Smoke" description="Nearby and regional wildfire reports with state, source and containment. Fully contained incidents appear in an expandable section. Includes satellite hotspots, smoke, and ODF / WA DNR fire danger." />
        <DocCard icon="volcano" title="Geohazards" description="Nearby earthquakes and other geological or disaster alerts." />
      </DocGrid>
      <DocText>
        Sections are ordered by what matters most locally. Source notices identify delayed or overdue updates, and the fire card shows when NIFC last updated. Data may remain visible as last known reports.
      </DocText>
    </DocSection>

    <DocSection title="Flight Log" delay={150}>
      <DocList items={[
        "Choose a window (1 to 72 hours, or Log/Live) and how often the list refreshes.",
        "Notable: filter to air ambulances, rescue, police, fire, military and other special-mission aircraft. Chips appear once one has been seen, and past flights keep their role.",
        "Badges on each row show the role or an emergency squawk; select a flight for its route, owner and track."
      ]} />
    </DocSection>

    <DocSection title="Comms" delay={200}>
      <DocGrid>
        <DocCard
          icon={<AtlasIcon name="mesh" color={COLORS.MESH} size={20} />}
          title="Mesh"
          description="Mesh chat, the mesh network with node status and SNR, and the nearest nodes to you."
        />
        <DocCard icon="radio" title="P25 Call Log" description="Recent radio calls with talkgroup, length and a transcript. The RF monitor shows whether the decoder is connected." />
      </DocGrid>
    </DocSection>

    <DocSection title="Intel Feed & Event Log" delay={250}>
      <DocList items={[
        "Intel Feed: local news and emergency newswire, with category chips and search. Local stories from the past week are pinned at the top as Local Now.",
        "Event Log: a timeline of radio calls, zone entries and exits, and anomalies. Filter by type, search, and export a SITREP."
      ]} />
    </DocSection>
  </div>
)

const searchFiltering = (
  <div className="stack-y-6">
    <DocHeader title="Search & Filtering" subtitle="Managing High-Volume Data" />

    <DocSection title="Search">
      <DocText>
        The search box on the Overview map finds entities by callsign, ICAO address or MMSI.
      </DocText>
      <DocCode code="N12345 (aircraft)  |  A1B2C3 (ICAO)  |  4560001 (vessel MMSI)" />
    </DocSection>

    <DocSection title="Filters" delay={100}>
      <DocText>
        The filter button next to the search box opens more options:
      </DocText>
      <DocList items={[
        "Entity types: Air, Sea, APRS and Fire.",
        "ADS-B sources: Local (your own receiver) and OpenSky Supplement, which also includes the airplanes.live / adsb.fi community feeds. Turn the supplement off to see only what your receiver hears. A filled cyan pip marks the local position feed; a hollow pip marks an external network feed at regional zoom and closer. Fresh reports have equal brightness. Dim aircraft indicate stale or estimated positions.",
        "Altitude and speed sliders to isolate a flight envelope.",
        "Mission tags, when entities have been tagged."
      ]} />
    </DocSection>

    <DocCallout title="Quick Toggles" type="info">
      For whole layers, use the counts on the left rail or the Entities group in Settings.
    </DocCallout>
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
