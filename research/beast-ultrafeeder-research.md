## Table of Contents
1. [Overall Data Flow](#1-overall-data-flow)
2. [BEAST TCP Feed — Ingress & Normalization](#2-beast-tcp-feed--ingress--normalization)
3. [adsbdb Integration — Routes, Aircraft, Photos](#3-adsbdb-integration--routes-aircraft-photos)
4. [tar1090-db Aircraft Registry — Build-Time Snapshot](#4-tar1090-db-aircraft-registry--build-time-snapshot)
5. [METAR Weather Enrichment](#5-metar-weather-enrichment)
6. [The Enrichment Tick — Full Assembly](#6-the-enrichment-tick--full-assembly)
7. [Wire Format — Enriched Snapshot JSON](#7-wire-format--enriched-snapshot-json)
8. [Caching Infrastructure Pattern](#8-caching-infrastructure-pattern)

---

## 1. Overall Data Flow

```
┌───────────────────────────────────────────────────────────┐
│                    External Sources                        │
│  BEAST TCP (readsb)   adsbdb.com   planespotters.net      │
│  aviationweather.gov  tar1090-db (build-time CSV)         │
│  OurAirports CSV      OpenFlights airlines.dat            │
└──────────────┬────────────────────────┬───────────────────┘
               │ live frames            │ HTTP REST
               ▼                        ▼
┌──────────────────────┐   ┌────────────────────────────────┐
│  BeastConsumerSvc    │   │  External HTTP Clients          │
│  TCP→PipeReader      │   │  (AdsbdbClient, MetarClient,   │
│  ParseMany()         │   │   PlanespottersClient)          │
│  → Channel<Frame>    │   │  → CachedLookup<K,V>           │
│    (16384, drop-old) │   │  → GzipJsonCache on disk       │
└──────────┬───────────┘   └────────────────┬───────────────┘
           │ BeastFrame                     │ cached lookups
           ▼                                │
┌──────────────────────────────────────────────────────────┐
│                    RegistryWorker                         │
│                                                           │
│  IngestLoop ──→ Channel<Work> ◄── TickLoop (1 Hz)        │
│  (16384, drop-old)       │                               │
│                          ▼                               │
│                    WorkLoop (single-writer)               │
│                    ├── IngestFrame() → registry.Ingest() │
│                    └── DoTick()                          │
│                         ├─ registry.Cleanup()            │
│                         ├─ registry.Snapshot()           │
│                         ├─ EnrichSnapshot()              │
│                         │   ├─ adsbdb lookups (cached)  │
│                         │   ├─ airport info lookups      │
│                         │   ├─ route plausibility        │
│                         │   ├─ flight phase              │
│                         │   ├─ airline DB lookup         │
│                         │   └─ METAR lookup (cached)     │
│                         ├─ JSON serialize                │
│                         └─ CurrentSnapshot.Set()         │
│                              + Broadcast to WS           │
└──────────────────────────────────────────────────────────┘
           │
           ▼
   GET /api/aircraft → pre-serialized JSON string (zero work)
   WS /ws           → broadcast same JSON to all subscribers
```

**Key design decisions:**
- Single-writer for all registry mutations (no locks needed)
- Two bounded drop-oldest channels pipeline backpressure
- Enrichment is **always cache-only during the tick** — slow upstreams never block snapshot delivery
- Background fire-and-forget fetches populate cache for the next tick

---

## 2. BEAST TCP Feed — Ingress & Normalization

### 2.1 Connection (`BeastConsumerService`)

```pseudo
class BeastConsumerService extends BackgroundService:
    options:  { host: string, port: int }
    output:   Channel<BeastFrame>  // bounded, capacity=16384, overflow=DropOldest
    backoff:  1s → doubles each retry → cap 30s

    run():
        loop until cancelled:
            try:
                tcp = TcpClient.Connect(host, port)
                connectionState.Set(connected=true)
                backoff = 1s                   // reset on success
                
                pipe = PipeReader.Create(tcp.GetStream())
                consumeFrames(pipe)
                
            catch any error:
                connectionState.Set(connected=false)
                log warning
            
            wait(backoff)
            backoff = min(backoff * 2, 30s)
    
    consumeFrames(pipe):
        buffered = List<BeastFrame>(capacity=64)
        loop:
            result = pipe.ReadAsync()          // awaits TCP data
            buffer = result.Buffer
            
            buffered.Clear()
            if buffer.IsSingleSegment:
                consumed = BeastFrameReader.ParseMany(buffer.FirstSpan, buffered)
            else:
                // rare: PipeReader usually single-segment on TCP
                consumed = BeastFrameReader.ParseMany(buffer.ToArray(), buffered)
            
            for frame in buffered:
                channel.TryWrite(frame)        // non-blocking, drops oldest if full
            
            pipe.AdvanceTo(consumed, buffer.End)
            if result.IsCompleted: break
```

### 2.2 Wire Protocol Parsing (`BeastFrameReader`)

The BEAST binary protocol from readsb/dump1090:

```pseudo
BEAST frame layout on the wire:
  0x1A          -- sync marker
  <type byte>   -- 0x31=ModeAC, 0x32=ModeSShort(56-bit), 0x33=ModeSLong(112-bit)
  <6 bytes>     -- MLAT 48-bit timestamp (microsecond counter, big-endian)
  <1 byte>      -- signal level (RSSI proxy)
  <N bytes>     -- message body (2/7/14 bytes for the three types)
  
  ESCAPE RULE: any 0x1A in the body is escaped as 0x1A 0x1A on the wire.

ParseMany(buffer, frames) → bytesConsumed:
    pos = 0
    loop:
        (consumed, frame) = ParseOne(buffer[pos:])
        if consumed == 0: break               // need more data, stop
        pos += consumed
        if frame != null: frames.Add(frame)
    return pos

ParseOne(buf) → (consumed, frame?):
    if buf empty:          return (0, null)    // wait for more
    if buf[0] != 0x1A:
        // desynced — skip to next 0x1A
        nxt = buf[1:].indexOf(0x1A)
        if nxt < 0: return (buf.Length, null)  // discard all
        return (1+nxt, null)
    
    if buf.Length < 2:     return (0, null)    // wait for type byte
    type = buf[1]
    msgLen = { 0x31→2, 0x32→7, 0x33→14 }[type]
    if unknown type: return (1, null)          // skip 0x1A, resync
    
    bodyNeeded = 6 + 1 + msgLen                // MLAT + signal + message
    
    // unescape body byte-by-byte
    body = byte[bodyNeeded]
    filled = 0
    i = 2
    while filled < bodyNeeded:
        if i >= buf.Length: return (0, null)   // wait for more
        b = buf[i]
        if b == 0x1A:
            if i+1 >= buf.Length: return (0, null)
            if buf[i+1] == 0x1A:
                body[filled++] = 0x1A          // escaped literal
                i += 2
            else:
                return (i, null)               // unescaped 0x1A = framing error
        else:
            body[filled++] = b
            i += 1
    
    mlat   = ReadUInt48BE(body[0:6])
    signal = body[6]
    msg    = body[7 : 7+msgLen]
    return (i, BeastFrame(type, mlat, signal, msg))

// Resulting struct:
BeastFrame:
    Type:       enum { ModeAC=0x31, ModeSShort=0x32, ModeSLong=0x33 }
    MlatTicks:  int64   // 48-bit MLAT microsecond counter
    Signal:     byte    // RSSI proxy
    Message:    byte[]  // 2, 7, or 14 bytes — the actual Mode S payload
```

### 2.3 Frame → Hex → DecodedMessage (`MessageDecoder`)

```pseudo
// RegistryWorker.IngestFrame():
IngestFrame(frame):
    if frame.Type not in {ModeSShort, ModeSLong}: return   // skip ModeAC
    hex = frame.Message.ToHexString()                       // e.g. "8D4840D6202CC371C32CE0576098"
    registry.Ingest(hex, now, frame.MlatTicks, frame.Signal)

// MessageDecoder.Decode(hex):
Decode(hex):
    msg = HexMessage.Parse(hex)                // pack bits into UInt128
    df = bits[0:5]                             // downlink format
    
    switch df:
        17, 18 → DecodeAdsb(msg, df)
        4, 20  → DecodeAltitudeReply(msg, df)   // 20 also carries Comm-B
        5, 21  → DecodeIdentityReply(msg, df)   // 21 also carries Comm-B
        11     → { Df:11, Icao: extractIcao(msg) }
        else   → null

DecodeAdsb(msg):
    if CRC invalid: discard                    // DF17/18 always has CRC
    icao = msg.bits[8:32]                      // AA field = 24-bit ICAO address
    return AdsbDecoder.Decode(msg)             // dispatch on typecode

DecodeAltitudeReply(msg, df):
    icao = CRC-derived(msg)                    // DF4/20: ICAO recovered from CRC remainder
    alt  = Altcode(msg)                        // 13-bit AC field → feet
    commB = (df==20) ? InferCommB(msg) : null  // DF20 body contains Comm-B register
    return merge({Df, Icao, Altitude}, commB)

DecodeIdentityReply(msg, df):
    icao   = CRC-derived(msg)
    squawk = Idcode(msg)                       // 13-bit squawk code
    commB  = (df==21) ? InferCommB(msg) : null
    return merge({Df, Icao, Squawk}, commB)
```

### 2.4 ADS-B Payload Decoding (`AdsbDecoder`)

```pseudo
AdsbDecoder.Decode(msg):
    tc = msg.bits[32:37]                       // ADS-B typecode
    
    TC 1-4  (Identification / BDS 0,8):
        category = tc_to_category_map[tc]
        callsign = decode_6bit_callsign(msg.bits[40:88])
        // Each char: 6-bit ICAO alphabet: space=32, A-Z=1-26, 0-9=48-57
        return { Callsign, Category }
    
    TC 5-8  (Surface Position / BDS 0,6):
        onGround = true
        movement = msg.bits[37:44]             // encoded groundspeed
        track    = msg.bits[45:52]             // encoded heading
        cprFmt   = msg.bits[53]                // 0=even, 1=odd
        cprLat   = msg.bits[54:71]             // 17-bit encoded lat
        cprLon   = msg.bits[71:88]             // 17-bit encoded lon
        return { OnGround, Track, CprFormat, CprLat, CprLon }
    
    TC 9-18 (Airborne Position / BDS 0,5, barometric alt):
        onGround = false
        altcode  = msg.bits[40:53]             // 13-bit AC field
        altitude = DecodeAltcode(altcode)      // feet, Q=1 linear or Q=0 Gillham
        cprFmt   = msg.bits[53]
        cprLat   = msg.bits[54:71]
        cprLon   = msg.bits[71:88]
        return { OnGround, Altitude, CprFormat, CprLat, CprLon }
    
    TC 20-22 (Airborne Position, GNSS alt):
        altitude = msg.bits[40:53] * 25        // metres, simpler encoding
        // same CPR fields as above
    
    TC 19  (Velocity / BDS 0,9):
        subtype = msg.bits[37:40]
        
        subtype 1-2 (ground speed):
            ew_sign  = msg.bits[45]
            ew_speed = msg.bits[46:56] - 1
            ns_sign  = msg.bits[56]
            ns_speed = msg.bits[57:67] - 1
            groundspeed = sqrt(ew_speed² + ns_speed²)
            track       = atan2(ew, ns) in degrees
        
        subtype 3-4 (airspeed):
            heading = msg.bits[46:56] * 360/1024
            speed   = msg.bits[57:67] - 1     // IAS or TAS
        
        all subtypes:
            vr_sign = msg.bits[68]
            vr_raw  = msg.bits[69:78]
            verticalRate = (vr_raw - 1) * 64 * (vr_sign ? -1 : 1)  // fpm
        
        return { Groundspeed, Airspeed, Track, Heading, VerticalRate }
```

### 2.5 CPR Position Decoding

```pseudo
// Called by AircraftRegistry for TC 5-22 frames
ResolveNewPosition(ac, cprFmt, cprLat, cprLon, now):
    
    // Store this fix in aircraft state
    if cprFmt == EVEN: ac.EvenCpr = (cprLat, cprLon, now)
    if cprFmt == ODD:  ac.OddCpr  = (cprLat, cprLon, now)
    
    // TIER 1: Global CPR (most accurate, needs even+odd pair < 10s apart)
    if both even and odd exist AND abs(even.time - odd.time) <= 10s:
        (lat, lon) = Cpr.GlobalDecode(evenLat, evenLon, oddLat, oddLon, latestFirst)
        if valid: return (lat, lon)
    
    // TIER 2: Local decode against aircraft's last known position
    if ac.Lat != null AND ac.Lon != null:
        (lat, lon) = Cpr.LocalDecode(cprLat, cprLon, ac.Lat, ac.Lon, cprFmt)
        if valid: return (lat, lon)
    
    // TIER 3: Local decode against receiver reference (required for first fix)
    if LatRef != null AND LonRef != null:
        (lat, lon) = Cpr.LocalDecode(cprLat, cprLon, LatRef, LonRef, cprFmt)
        if valid: return (lat, lon)
    
    return null

// Teleport guard (applied after resolution):
if prev position exists:
    budget = max(10km, elapsed_seconds * 0.5km)  // 500 m/s ceiling + floor
    if distanceTo(new) > budget:
        discard position        // likely decode error or transponder glitch
```

### 2.6 Aircraft State Update (`AircraftRegistry.Ingest`)

```pseudo
AircraftRegistry.Ingest(hex, now, mlatTicks, signal):
    msg = MessageDecoder.Decode(hex)
    if msg == null: return
    
    ac = getOrCreate(msg.Icao)
    ac.LastSeen = now
    ac.MsgCount++
    if signal > ac.SignalPeak: ac.SignalPeak = signal
    
    switch msg.Df:
        17, 18 (ADS-B):
            if not msg.CrcValid: return
            switch msg.Typecode:
                1-4:  ac.Callsign = msg.Callsign; ac.Category = msg.Category
                5-8:  ac.OnGround = true;  UpdatePosition(ac, msg, now)
                9-22: ac.OnGround = false; UpdatePosition(ac, msg, now)
                19:   UpdateVelocity(ac, msg)
        
        4 (Surveillance Alt Reply):
            ac.AltitudeBaro = msg.Altitude
        
        20 (Comm-B Alt Reply):
            ac.AltitudeBaro = msg.Altitude
            if msg.Bds != null: ApplyCommB(ac, msg, now)
        
        5 (Surveillance Identity):
            ac.Squawk = msg.Squawk
        
        21 (Comm-B Identity):
            ac.Squawk = msg.Squawk
            if msg.Bds != null: ApplyCommB(ac, msg, now)
        
        11: (all-call, only updates ICAO presence)

UpdatePosition(ac, msg, now):
    (lat, lon) = ResolveNewPosition(ac, msg.CprFormat, msg.CprLat, msg.CprLon, now)
    if lat == null: return
    
    // Teleport guard
    if ac.Lat != null:
        elapsed = now - ac.LastPositionTime
        budget  = max(10km, elapsed * 0.5km/s)
        if distance(lat,lon, ac.Lat, ac.Lon) > budget: return
    
    ac.Lat = lat; ac.Lon = lon
    ac.Revision++                              // invalidates cached trail
    if msg.Altitude != null: ac.AltitudeBaro = msg.Altitude
    ac.LastPositionTime = now
    
    OnPosition(lat, lon)                       // → PolarCoverage.Observe()

ApplyCommB(ac, msg, now):
    switch msg.Bds:
        "4,0": ac.SelectedAltitudeMcp = msg.SelectedAltitudeMcpFt
               ac.SelectedAltitudeFms = msg.SelectedAltitudeFmsFt
               ac.QnhHpa = msg.QnhHpa
               ac.Bds40At = now
        
        "4,4": ac.WindSpeedKt       = msg.WindSpeedKt
               ac.WindDirectionDeg  = msg.WindDirectionDeg
               ac.StaticAirTempC    = msg.StaticAirTemperatureC
               ac.StaticPressureHpa = msg.StaticPressureHpa
               ac.Turbulence        = msg.Turbulence
               ac.HumidityPct       = msg.HumidityPct
               ac.Bds44At = now
        
        "5,0": ac.RollDeg         = msg.RollDeg
               ac.TrueTrackDeg    = msg.TrueTrackDeg
               ac.GroundspeedKt   = msg.GroundspeedKt
               ac.TrackRateDegPerS = msg.TrackRateDegPerS
               ac.TrueAirspeedKt  = msg.TrueAirspeedKt
               ac.Bds50At = now
        
        "6,0": ac.MagneticHeadingDeg    = msg.MagneticHeadingDeg
               ac.IndicatedAirspeedKt   = msg.IndicatedAirspeedKt
               ac.Mach                  = msg.Mach
               ac.BaroVerticalRateFpm   = msg.BaroVerticalRateFpm
               ac.InertialVerticalRateFpm = msg.InertialVerticalRateFpm
               ac.Bds60At = now
```

### 2.7 Comm-B Register Inference

The decoder can't know in advance which register a DF 20/21 reply carries. It applies four heuristic validators and accepts the payload only if **exactly one** matches:

```pseudo
CommB.Infer(payload):    // payload = bytes 3-9 of the 14-byte message
    candidates = {}
    if IsBds40(payload): candidates.add("4,0")
    if IsBds44(payload): candidates.add("4,4")
    if IsBds50(payload): candidates.add("5,0")
    if IsBds60(payload): candidates.add("6,0")
    return candidates    // caller drops if count != 1 (ambiguous)

// Each validator checks reserved bits = 0, status bits consistent,
// all decoded values in physical range.
// Example: IsBds50 checks roll range ±50°, TAS > 0 if status bit set, etc.
```

### 2.8 Snapshot Building

```pseudo
AircraftRegistry.Snapshot(now):
    result = []
    for each ac in _aircraft.values():
        // Filter: must have at least one useful field
        if ac has no lat AND no callsign AND no altitude AND no squawk: skip
        
        // Dead-reckon stale positions forward
        displayLat, displayLon = ac.Lat, ac.Lon
        positionStale = false
        if ac.Lat != null AND (now - ac.LastPositionTime) > 1.5s:
            (displayLat, displayLon) = project(ac.Lat, ac.Lon, ac.Track, ac.Speed,
                                                now - ac.LastPositionTime)
            positionStale = true
        
        // Comm-B fields: drop any older than 120s
        commB = BuildCommBSnapshot(ac, now)
        
        // Trail: reuse cached if revision unchanged
        trail = GetOrBuildTrail(ac)
        
        // Registration/type from build-time AircraftDb
        dbEntry = aircraftDb.Lookup(ac.Icao)
        
        result.Add(SnapshotAircraft{
            Icao:         ac.Icao,
            Callsign:     ac.Callsign,
            Registration: dbEntry?.Registration,
            TypeIcao:     dbEntry?.TypeIcao,
            TypeLong:     dbEntry?.TypeLong,
            Lat:          displayLat,   Lon: displayLon,
            PositionStale: positionStale,
            Altitude:     ac.AltitudeBaro ?? ac.AltitudeGeo,
            AltitudeBaro: ac.AltitudeBaro,
            AltitudeGeo:  ac.AltitudeGeo,
            Track:        ac.Track,     Speed: ac.Speed,
            Vrate:        ac.VerticalRate,
            Squawk:       ac.Squawk,    Emergency: classifySquawk(ac.Squawk),
            OnGround:     ac.OnGround,
            LastSeen:     ac.LastSeen,  FirstSeen: ac.FirstSeen,
            SignalPeak:   ac.SignalPeak, MsgCount: ac.MsgCount,
            DistanceKm:   distanceTo(displayLat, displayLon),
            CommB:        commB,        Trail: trail,
        })
    
    return RegistrySnapshot{ Now: now, Count: result.Count, Aircraft: result, ... }

BuildCommBSnapshot(ac, now):
    MAX_AGE = 120s
    isFresh(t) = t != null AND (now - t) <= MAX_AGE
    
    // Temperature: prefer observed BDS 4,4 SAT, else derive from TAS+Mach
    sat = null; satSource = null
    if isFresh(ac.Bds44At) AND ac.StaticAirTempC != null:
        sat = ac.StaticAirTempC;  satSource = "observed"
    else if isFresh(ac.Bds50At) AND isFresh(ac.Bds60At)
         AND ac.TrueAirspeedKt != null AND ac.Mach != null:
        a = ac.TrueAirspeedKt * 0.514444 / ac.Mach  // m/s → speed of sound
        T_K = a² / 401.874                            // γR for dry air
        sat_c = T_K - 273.15
        if 150 <= T_K <= 320:                        // plausibility gate
            sat = sat_c;  satSource = "derived"
    
    tat = null
    if sat != null AND ac.Mach != null:
        tat = sat + (0.2 * ac.Mach²) * (sat + 273.15) - 273.15  // stagnation temp
    
    return SnapshotCommB{
        // BDS 4,0 (fresh or null):
        SelectedAltitudeMcpFt: isFresh(ac.Bds40At) ? ac.SelectedAltitudeMcp : null,
        SelectedAltitudeFmsFt: isFresh(ac.Bds40At) ? ac.SelectedAltitudeFms : null,
        QnhHpa:                isFresh(ac.Bds40At) ? ac.QnhHpa : null,
        
        // BDS 4,4:
        WindSpeedKt:     isFresh(ac.Bds44At) ? ac.WindSpeedKt : null,
        WindDirectionDeg: isFresh(ac.Bds44At) ? ac.WindDirectionDeg : null,
        StaticAirTemperatureC:      sat,
        StaticAirTemperatureSource: satSource,
        TotalAirTemperatureC:       tat,
        StaticPressureHpa: isFresh(ac.Bds44At) ? ac.StaticPressureHpa : null,
        Turbulence:        isFresh(ac.Bds44At) ? ac.Turbulence : null,
        HumidityPct:       isFresh(ac.Bds44At) ? ac.HumidityPct : null,
        
        // BDS 5,0:
        RollDeg:           isFresh(ac.Bds50At) ? ac.RollDeg : null,
        TrueTrackDeg:      isFresh(ac.Bds50At) ? ac.TrueTrackDeg : null,
        GroundspeedKt:     isFresh(ac.Bds50At) ? ac.GroundspeedKt : null,
        TrackRateDegPerS:  isFresh(ac.Bds50At) ? ac.TrackRateDegPerS : null,
        TrueAirspeedKt:    isFresh(ac.Bds50At) ? ac.TrueAirspeedKt : null,
        
        // BDS 6,0:
        MagneticHeadingDeg:     isFresh(ac.Bds60At) ? ac.MagneticHeadingDeg : null,
        IndicatedAirspeedKt:    isFresh(ac.Bds60At) ? ac.IndicatedAirspeedKt : null,
        Mach:                   isFresh(ac.Bds60At) ? ac.Mach : null,
        BaroVerticalRateFpm:    isFresh(ac.Bds60At) ? ac.BaroVerticalRateFpm : null,
        InertialVerticalRateFpm:isFresh(ac.Bds60At) ? ac.InertialVerticalRateFpm : null,
    }
    // Return null if ALL fields are null (suppresses the panel in the UI)
```

---

## 3. adsbdb Integration — Routes, Aircraft, Photos

### 3.1 Two Endpoints, One Throttle

```pseudo
// adsbdb API
ROUTE_URL   = "https://api.adsbdb.com/v0/callsign/{callsign}"
AIRCRAFT_URL = "https://api.adsbdb.com/v0/aircraft/{icao24}"

// Both share one HttpThrottle:
//   - minimum 1.2 seconds between requests
//   - 60s default cooldown on 429, extended by Retry-After header
//   - cooldown blocks ALL adsbdb lookups (both routes and aircraft)

// Both use CachedLookup<string, T>:
ROUTES_CACHE:   positiveTtl=12h,  negativeTtl=1h,  maxSize=10000, key=UPPERCASE_CALLSIGN
AIRCRAFT_CACHE: positiveTtl=30d,  negativeTtl=24h, maxSize=10000, key=lowercase_icao24

// Both persist to same gzipped JSON file:
// /data/flight_routes.json.gz (schema version 3)
```

### 3.2 Route Lookup (callsign → origin/destination)

```pseudo
// Key normalization
NormalizeCallsign(s):
    k = s.Trim().ToUpperCase()
    if len(k) < 3 OR len(k) > 8: return null
    if k contains non-alphanumeric: return null
    return k     // e.g. "BAW123" or "N12345"

// HTTP fetch
FetchRoute(callsign):
    GET "https://api.adsbdb.com/v0/callsign/BAW123"
    Accept: application/json
    
    // Response shape:
    {
      "response": {
        "flightroute": {
          "callsign": "BAW123",
          "origin": {
            "icao_code": "EGLL",
            "iata_code": "LHR",
            "name": "London Heathrow",
            ...
          },
          "destination": {
            "icao_code": "KJFK",
            ...
          }
        }
      }
    }
    
    // Extract only what's needed:
    return RouteInfo(
        Origin:      response.flightroute.origin?.icao_code,
        Destination: response.flightroute.destination?.icao_code,
        Callsign:    response.flightroute.callsign
    )
    // 404 → cache null (negative TTL=1h)
    // 400 → reject silently (callsign too short/long)
```

### 3.3 Aircraft Lookup (ICAO24 → metadata)

```pseudo
// Key normalization
NormalizeIcao(s):
    k = s.Trim().ToLowerCase()
    if len(k) == 0 OR len(k) > 6: return null
    if k contains non-hex chars: return null
    return k     // e.g. "4ca8a7"

// HTTP fetch
FetchAircraft(icao):
    GET "https://api.adsbdb.com/v0/aircraft/4ca8a7"
    Accept: application/json
    
    // Response shape:
    {
      "response": {
        "aircraft": {
          "registration": "EI-GAT",
          "type": "Airbus A320-214",
          "icao_type": "A320",
          "manufacturer": "Airbus",
          "registered_owner": "Ryanair",
          "registered_owner_country_name": "Ireland",
          "registered_owner_country_iso_name": "IE",
          "url_photo": "https://cdn.airport-data.com/aircraft/...",
          "url_photo_thumbnail": "https://cdn.airport-data.com/..."
        }
      }
    }
    
    return AircraftRecord{
        Registration: "EI-GAT",
        Type:         "Airbus A320-214",
        IcaoType:     "A320",
        Manufacturer: "Airbus",
        Operator:     "Ryanair",        // registered_owner
        OperatorCountry:    "Ireland",
        OperatorCountryIso: "IE",
        PhotoUrl:       "https://cdn.airport-data.com/...",   // fallback photo
        PhotoThumbnail: "https://cdn.airport-data.com/..."
    }
```

### 3.4 Planespotters Photo Lookup (registration → photo)

```pseudo
// Separate client, same CachedLookup pattern
PHOTO_URL    = "https://api.planespotters.net/pub/photos/reg/{registration}"
POSITIVE_TTL = 30 days
NEGATIVE_TTL = 24 hours
THROTTLE     = 1.2s min interval, 60s default 429 cooldown
DISK_CACHE   = /data/photos.json.gz (schema v1)

FetchPhoto(registration):
    GET "https://api.planespotters.net/pub/photos/reg/EI-GAT"
    
    // Response shape:
    {
      "photos": [
        {
          "thumbnail": { "src": "https://cdn.planespotters.net/thumbnails/..." },
          "thumbnail_large": { "src": "https://cdn.planespotters.net/large/..." },
          "link": "https://www.planespotters.net/photo/...",
          "photographer": "John Smith"
        }
      ]
    }
    
    // Only the first photo is used:
    return PhotoInfo(
        Thumbnail:    photos[0].thumbnail.src,
        Large:        photos[0].thumbnail_large?.src,      // preferred
        Link:         photos[0].link,
        Photographer: photos[0].photographer
    )
    // Note: planespotters takes priority over adsbdb's airport-data.com fallback
```

### 3.5 How Photo Gets Into the Snapshot

Photos are **not** part of the 1 Hz broadcast snapshot. They're served on demand:

```pseudo
// GET /api/aircraft/{icao24}  — user clicks on an aircraft
endpoint GetAircraftDetail(icao):
    adsbdbRecord = adsbdb.LookupAircraftAsync(icao)   // may hit network
    
    // Try planespotters first (higher quality photos)
    photo = null
    if adsbdbRecord?.Registration != null:
        photo = planespotters.LookupAsync(adsbdbRecord.Registration)
    
    // Fall back to adsbdb's airport-data.com photo URL
    if photo == null AND adsbdbRecord?.PhotoUrl != null:
        photo = PhotoInfo(
            Thumbnail:    adsbdbRecord.PhotoThumbnail,
            Large:        adsbdbRecord.PhotoUrl,
            ...
        )
    
    return { aircraft: adsbdbRecord, photo: photo }
```

---

## 4. tar1090-db Aircraft Registry — Build-Time Snapshot

### 4.1 Docker Build-Time Download

```pseudo
// In Dockerfile (multi-stage build):
// The DATA_CACHEBUST arg forces re-download weekly in CI (set to YYYY-WNN)

ARG AIRCRAFT_DB_URL = "https://raw.githubusercontent.com/wiedehopf/tar1090-db/refs/heads/csv/aircraft.csv.gz"
ARG DATA_CACHEBUST = "static"     // CI sets to ISO week, e.g. "2025-W17"

RUN echo "data fetch ${DATA_CACHEBUST}" \
    && curl -fsSL -o /out/aircraft_db.csv.gz "${AIRCRAFT_DB_URL}"

// Baked into the image at:  /app/aircraft_db.csv.gz
// Runtime override at:      /data/aircraft_db.csv.gz  (if exists, takes priority)
```

### 4.2 CSV Format

```pseudo
// File: aircraft_db.csv.gz
// Format: semicolon-delimited, gzip-compressed, no header row
// Columns: icao24 ; registration ; type_icao ; (unused) ; type_long ; ...

// Example row:
"4ca8a7;EI-GAT;A320;;Airbus A320-214"

// Parsing rules:
for each row:
    if row has < 5 fields: skip
    icao24       = fields[0].trim()      // required, non-empty
    registration = fields[1].trim()      // optional
    type_icao    = fields[2].trim()      // optional
    // fields[3] is unused
    type_long    = fields[4].trim()      // optional
    
    if icao24 is empty: skip
    if registration AND type_icao AND type_long are all empty: skip
    
    store(icao24.toLower(), { registration, type_icao, type_long })
```

### 4.3 In-Memory Structure

```pseudo
// Loaded at startup into an immutable FrozenDictionary (O(1) lookup)
aircraftDb: FrozenDictionary<string, AircraftDbEntry>
    key:   icao24 lowercase (e.g. "4ca8a7")
    value: { Registration: "EI-GAT", TypeIcao: "A320", TypeLong: "Airbus A320-214" }

// Lookup (called once per aircraft during Snapshot()):
Lookup(icao24):
    return aircraftDb[icao24.toLower()]   // null if not found
```

### 4.4 Load Priority Chain

```pseudo
// Three paths tried in order; first one that exists wins:
candidates = [
    "/data/aircraft_db.csv.gz",                  // runtime user override
    "{app_base_dir}/aircraft_db.csv.gz",          // Docker image layout
    "{app_base_dir}/app/aircraft_db.csv.gz",      // dev/test fallback
]

for path in candidates:
    if file exists:
        load(path)
        break

// If no file found: aircraftDb is empty, lookups return null gracefully
```

### 4.5 Other Reference Data Loaded the Same Way

```pseudo
// AirportsDb — from OurAirports airports.csv
// Format: CSV with header, comma-delimited
// Columns: ident, name, type, latitude_deg, longitude_deg, municipality, iso_country, ...
// Filter:  type IN {small_airport, medium_airport, large_airport}
// Key:     ICAO uppercase
// Value:   { Icao, Name, City, Country, Type, Lat, Lon }
// Extra:   Bbox(minLat,maxLat,minLon,maxLon) spatial query (antimeridian-aware)
// Sorted by: large(0) → medium(1) → small(2)

// AirlinesDb — from OpenFlights airlines.dat
// Format: CSV with no header, comma-delimited, quoted fields
// Columns: [0]=id, [1]=name, [3]=iata, [4]=icao(3-letter), [5]=callsign, [6]=country, [7]=active
// Filter:  active == "Y" AND icao is exactly 3 letters
// Key:     ICAO 3-letter callsign prefix uppercase
// Value:   { Icao, Iata, Name, Callsign, Country, Alliance }
// Alliance: hardcoded dict of airline ICAO → "star"/"oneworld"/"skyteam"
// Lookup:  LookupByCallsign("BAW123") → extract "BAW" → lookup → AirlineRecord

// NavaidsDb — from OurAirports navaids.csv
// Format: CSV with header, comma-delimited
// Stored as List<NavaidRecord> (linear scan, no hash key)
// Filter:  type IN {VOR, VOR-DME, VORTAC, NDB, NDB-DME, DME, TACAN}
// Bbox query only (no point lookup)
```

---

## 5. METAR Weather Enrichment

### 5.1 API Endpoint

```pseudo
// aviationweather.gov public API, no auth required
METAR_URL = "https://aviationweather.gov/api/data/metar"

// One batched request per tick covers ALL airports in the current snapshot
GET "{METAR_URL}?ids={EGLL,KJFK,LFPG}&format=json&taf=false&hours=1"
//                ↑ comma-separated ICAO codes, URL-encoded
```

### 5.2 Client Behavior

```pseudo
MetarClient:
    POSITIVE_TTL      = 10 minutes
    NEGATIVE_TTL      = 5 minutes
    MIN_REQ_INTERVAL  = 2 seconds
    DEFAULT_429_WAIT  = 120 seconds     // longer cooldown than adsbdb
    MAX_CACHE_ENTRIES = 2000
    DISK_CACHE        = /data/metar.json.gz (schema v1)

LookupManyAsync(icaoCodes):
    // De-duplicate concurrent batches with same key set
    batchKey = sorted(icaoCodes).join(",")
    if batchKey in _inflight: return await _inflight[batchKey]
    
    // Filter out already-fresh entries
    toFetch = [code for code in icaoCodes if not isFresh(code)]
    if toFetch is empty: return
    
    ids = toFetch.join(",")  // URL-encode before sending
    
    // Throttle: wait min interval
    await throttle.Acquire()
    
    response = GET "{METAR_URL}?ids={ids}&format=json&taf=false&hours=1"
    
    // Response is a JSON array:
    [
      {
        "icaoId": "EGLL",
        "rawOb": "METAR EGLL 271220Z 25015KT 9999 FEW035 13/07 Q1018",
        "obsTime": 1714213200,
        "wdir": 250,           // degrees or "VRB"
        "wspd": 15,            // knots
        "wgst": null,          // gusts, if any
        "visib": "9999",       // metres or "10+" for US
        "temp": 13,
        "dewp": 7,
        "altim": 1018.0,       // hPa
        "clouds": [
          { "cover": "FEW", "base": 3500 },
          ...
        ]
      }
    ]
    
    for entry in response:
        metar = DistillMetar(entry)
        cache[entry.icaoId] = CacheEntry(metar, expiry=now+10min)
    
    // Airports not in response (no METAR available) → cache null (5min TTL)
    for code in toFetch where code not in response:
        cache[code] = CacheEntry(null, expiry=now+5min)

DistillMetar(entry):
    // Cloud cover: pick the highest-rank layer
    coverRank = { OVC:4, BKN:3, SCT:2, FEW:1, CLR:0, SKC:0 }
    maxCover = clouds.maxBy(c => coverRank[c.cover]).cover
    
    return MetarEntry{
        Raw:          entry.rawOb,
        ObsTime:      entry.obsTime,
        WindDir:      entry.wdir,       // int degrees or string "VRB"
        WindKt:       entry.wspd,
        GustKt:       entry.wgst,
        Visibility:   entry.visib,      // int metres or string "10+"
        TempC:        entry.temp,
        DewpointC:    entry.dewp,
        AltimeterHpa: entry.altim,
        Cover:        maxCover,         // highest layer only
    }
```

### 5.3 Association to Origin/Destination

```pseudo
// During EnrichSnapshot() tick:

// Step 1: collect all unique airport codes from all aircraft routes
airports = {}  // icao → SnapshotAirportRef
uncachedMetarCodes = []

for ac in enrichedAircraft:
    for airportIcao in [ac.Origin, ac.Destination]:
        if airportIcao == null: continue
        if airportIcao not in airports:
            info = airportsDb.Lookup(airportIcao)
            if info == null: continue
            
            airports[airportIcao] = SnapshotAirportRef{
                Name: info.Name,
                Lat:  info.Lat,
                Lon:  info.Lon,
                Metar: null                // filled in below
            }
        
        // Check METAR cache
        (known, metar) = metarClient.LookupCached(airportIcao)
        if known:
            airports[airportIcao].Metar = metar   // metar may be null (negative cache)
        else:
            uncachedMetarCodes.Add(airportIcao)

// Step 2: fire one batched background fetch for uncached codes
// Result arrives in cache, surfaces on the NEXT tick
if uncachedMetarCodes not empty:
    _ = metarClient.LookupManyAsync(uncachedMetarCodes)  // fire-and-forget

// airports dict is added to the snapshot:
// aircraft.origin_info.icao → airports[icao].metar
// aircraft.dest_info.icao   → airports[icao].metar
```

---

## 6. The Enrichment Tick — Full Assembly

```pseudo
// RegistryWorker.DoTick() — runs every 1 Hz on the single-writer thread

DoTick(now):
    // Phase 1: Maintenance + base snapshot
    registry.Cleanup(now)              // drop aircraft silent > 60s
    snap = registry.Snapshot(now)      // builds immutable SnapshotAircraft list
                                       // AircraftDb lookups happen here
    
    // Phase 2: External enrichment (all cache-only, never blocking)
    snap = EnrichSnapshot(snap)
    
    // Phase 3: Serialize + publish
    json = JsonSerializer.Serialize(snap, snakeCaseOptions)
    currentSnapshot.Set(snap, json)    // volatile write for HTTP readers
    broadcaster.Broadcast(json)        // push to all WebSocket subscribers
    
    // Phase 4: Side-effects (fire-and-forget)
    watchlistStore.ObserveAll(snap)    // update last-seen timestamps
    alertWatcher.ObserveAsync(snap)    // fire notifications (emergency/watchlist)
    
    // Phase 5: Periodic persistence (debounced)
    if tickCount % 30 == 0:
        stateStore.SaveAsync(registry.Serialize())
    if (now - lastCoveragePersist) > 60s:
        polarCoverage.MaybePersistAsync()
        trafficHeatmap.MaybePersistAsync()

EnrichSnapshot(snap):
    enriched = []
    uncachedCallsigns = []
    uncachedIcaos = []
    
    for ac in snap.Aircraft:
        origin = null; destination = null
        operator = null; operatorIata = null; operatorAlliance = null
        operatorCountry = null; countryIso = null; manufacturer = null
        
        // ── adsbdb route lookup (cache-only) ──
        (routeKnown, route) = adsbdb.LookupCachedRoute(ac.Callsign)
        if routeKnown AND route != null:
            origin      = route.Origin
            destination = route.Destination
        else if not routeKnown:
            uncachedCallsigns.Add(ac.Callsign)   // fetch next tick
        
        // ── adsbdb aircraft lookup (cache-only) ──
        (acKnown, acRecord) = adsbdb.LookupCachedAircraft(ac.Icao)
        if acKnown AND acRecord != null:
            operator        = acRecord.Operator
            operatorCountry = acRecord.OperatorCountry
            countryIso      = acRecord.OperatorCountryIso
            manufacturer    = acRecord.Manufacturer
        else if not acKnown:
            uncachedIcaos.Add(ac.Icao)           // fetch next tick
        
        // ── airport info lookup (always synchronous, in-memory) ──
        originInfo = airportsDb.Lookup(origin)
        destInfo   = airportsDb.Lookup(destination)
        
        // ── route plausibility check ──
        if ac.Lat != null AND originInfo != null AND destInfo != null:
            if not RoutePlausibility.IsPlausible(ac.Lat, ac.Lon, ac.Track,
                                                  originInfo, destInfo):
                origin = null; destination = null
                originInfo = null; destInfo = null
        
        // ── flight phase ──
        phase = FlightPhase.Classify(
            onGround:    ac.OnGround,
            altitude:    ac.Altitude,
            verticalRate: ac.Vrate,
            lat:         ac.Lat,  lon: ac.Lon,
            destination: destInfo
        )
        // Returns: null | "taxi" | "climb" | "cruise" | "descent" | "approach"
        
        // ── airlines DB lookup (always synchronous, in-memory) ──
        airline = airlinesDb.LookupByCallsign(ac.Callsign)
        if airline != null:
            operatorIata     = airline.Iata
            operatorAlliance = airline.Alliance
            operator         = operator ?? airline.Name    // prefer adsbdb name if available
        
        enriched.Add(ac with {
            Origin: origin,   Destination: destination,
            OriginInfo: originInfo,  DestInfo: destInfo,
            Phase: phase,
            Operator: operator,  OperatorIata: operatorIata,
            OperatorAlliance: operatorAlliance,
            OperatorCountry: operatorCountry,  CountryIso: countryIso,
            Manufacturer: manufacturer,
        })
    
    // ── fire background fetches for uncached entries ──
    for cs in uncachedCallsigns:
        _ = adsbdb.LookupRouteAsync(cs)          // fire-and-forget
    for ic in uncachedIcaos:
        _ = adsbdb.LookupAircraftAsync(ic)       // fire-and-forget
    
    // ── build airports map + fire METAR batch ──
    airports = {}; uncachedMetarCodes = []
    for ac in enriched:
        for (icao, info) in [(ac.Origin, ac.OriginInfo), (ac.Destination, ac.DestInfo)]:
            if icao == null OR icao in airports: continue
            airports[icao] = SnapshotAirportRef{ Name: info.Name, Lat: info.Lat, Lon: info.Lon }
            
            (known, metar) = metarClient.LookupCached(icao)
            if known: airports[icao].Metar = metar
            else:     uncachedMetarCodes.Add(icao)
    
    if uncachedMetarCodes not empty:
        _ = metarClient.LookupManyAsync(uncachedMetarCodes)    // fire-and-forget
    
    return snap with { Aircraft: enriched, Airports: airports }
```

---

## 7. Wire Format — Enriched Snapshot JSON

Serialized with `snake_case_lower` naming, nulls omitted:

```json
{
  "now": 1714213200.5,
  "count": 42,
  "positioned": 38,
  "receiver": { "lat": 52.98, "lon": -1.20, "anon_km": 0 },
  "site_name": "My Receiver",
  "frames": 4827163,

  "aircraft": [
    {
      "icao": "4ca8a7",
      "callsign": "EIN123",
      "category": 3,

      "registration": "EI-GAT",          // ← from tar1090-db (build-time)
      "type_icao": "A320",               // ← from tar1090-db
      "type_long": "Airbus A320-214",    // ← from tar1090-db

      "lat": 53.421, "lon": -1.843,
      "position_stale": false,
      "altitude": 34000,
      "altitude_baro": 34000,
      "track": 275.3,
      "speed": 432.1,
      "vrate": -64,
      "squawk": "2371",
      "on_ground": false,
      "last_seen": 1714213200.0,
      "first_seen": 1714210000.0,
      "signal_peak": 184,
      "msg_count": 2341,
      "distance_km": 48.2,

      "origin": "EIDW",                  // ← from adsbdb (cached)
      "destination": "EGLL",             // ← from adsbdb (cached)
      "origin_info": {                   // ← from OurAirports DB
        "icao": "EIDW", "name": "Dublin Airport",
        "city": "Dublin", "country": "IE",
        "lat": 53.421, "lon": -6.270
      },
      "dest_info": { "icao": "EGLL", "name": "London Heathrow", ... },

      "phase": "descent",                // ← FlightPhase.Classify()
      "operator": "Aer Lingus",          // ← adsbdb or AirlinesDb
      "operator_iata": "EI",             // ← AirlinesDb
      "operator_alliance": "oneworld",   // ← AirlinesDb hardcoded dict
      "operator_country": "Ireland",     // ← adsbdb
      "country_iso": "IE",               // ← adsbdb
      "manufacturer": "Airbus",          // ← adsbdb

      "comm_b": {                        // ← DF20/21 Comm-B (EHS only, null if no data)
        "selected_altitude_mcp_ft": 34000,
        "qnh_hpa": 1018.0,
        "wind_speed_kt": 45, "wind_direction_deg": 270.0,
        "static_air_temperature_c": -52.3,
        "static_air_temperature_source": "derived",
        "total_air_temperature_c": -38.7,
        "magnetic_heading_deg": 270.5,
        "indicated_airspeed_kt": 290,
        "mach": 0.82,
        "baro_vertical_rate_fpm": -1024
      },

      "trail": [                         // [lat, lon, alt_ft, speed_kt, is_gap]
        [53.421, -1.843, 34000, 432.1, false],
        [53.418, -1.851, 34064, 431.8, false]
      ]
    }
  ],

  "airports": {                          // ← aggregated from all route origin/dests
    "EGLL": {
      "name": "London Heathrow",
      "lat": 51.477, "lon": -0.461,
      "metar": {                         // ← aviationweather.gov (batched, cached 10min)
        "raw": "METAR EGLL 271220Z 25015KT 9999 FEW035 13/07 Q1018",
        "obs_time": 1714213200,
        "wind_dir": 250, "wind_kt": 15,
        "visibility": 9999,
        "temp_c": 13.0, "dewpoint_c": 7.0,
        "altimeter_hpa": 1018.0,
        "cover": "FEW"
      }
    },
    "EIDW": { "name": "Dublin Airport", "lat": 53.421, "lon": -6.270, "metar": null }
  }
}
```

---

## 8. Caching Infrastructure Pattern

This is the most reusable part of the whole system. Every external HTTP client uses the same three-layer pattern:

```pseudo
// Layer 1: CachedLookup<K,V> — in-memory cache with TTL + in-flight dedup
class CachedLookup<K, V>:
    entries:  ConcurrentDictionary<K, CacheEntry<V>>
    inflight: ConcurrentDictionary<K, Task<V?>>
    
    LookupCached(key) → (known: bool, data: V?):
        entry = entries[key]
        if entry exists AND entry.ExpiresAt > now:
            return (true, entry.Data)     // data is null for cached-negatives
        return (false, null)
    
    GetAsync(key, fetcher) → Task<V?>:
        entry = entries[key]
        if entry is fresh: return entry.Data          // cache hit
        if throttle.IsInCooldown: return entry?.Data  // degraded mode
        
        // In-flight dedup: second caller for same key awaits the same Task
        return inflight.GetOrAdd(key, k => FetchAndCache(k, fetcher))
    
    FetchAndCache(key, fetcher):
        try:
            await throttle.Acquire()           // enforce min interval
            
            // Recheck after acquiring (another caller may have filled)
            if cache is fresh now: return cached
            
            data = await fetcher(key)
            ttl  = data != null ? positiveTtl : negativeTtl
            entries[key] = CacheEntry(data, now + ttl)
            
            if entries.Count > maxSize: PruneByExpiry()
            return data
        
        catch UpstreamRateLimitedException ex:
            throttle.RecordCooldown(ex.RetryAfter)
            return stale entry if available, else null
        
        catch HttpException:
            return stale entry if available, else null      // stale-on-error fallback
        
        finally:
            inflight.Remove(key)               // release dedup slot

// Layer 2: HttpThrottle — burst control + 429 global cooldown
class HttpThrottle:
    semaphore:     SemaphoreSlim(1)
    lastRequest:   DateTimeOffset
    cooldownUntil: DateTimeOffset
    
    Acquire() → IAsyncDisposable:
        await semaphore.WaitAsync()
        wait until (lastRequest + minInterval)  // enforce spacing
        return disposable { on Dispose: lastRequest = now; semaphore.Release() }
    
    IsInCooldown(now):
        return now < cooldownUntil
    
    RecordCooldown(retryAfter?):
        delay = retryAfter ?? defaultCooldown   // 60s or 120s default
        cooldownUntil = now + delay

// Layer 3: GzipJsonCache — crash-safe disk persistence
class GzipJsonCache:
    Save(path, payload):
        tmp = "{path}.{guid}.tmp"
        Write gzipped JSON to tmp
        Rename(tmp → path)              // atomic on POSIX
    
    Load(path) → T?:
        if file not exists: return null
        Read + gunzip + deserialize JSON
        if schema version mismatch: return null

// CacheEntry record:
struct CacheEntry<T>:
    Data:      T?              // null = cached negative (404)
    ExpiresAt: DateTimeOffset
    IsFresh(now) = now < ExpiresAt
```

### Reference Table — All Cache Parameters

| Client | Endpoint | Positive TTL | Negative TTL | Min Interval | 429 Cooldown | Disk File |
|---|---|---|---|---|---|---|
| adsbdb routes | `/v0/callsign/{cs}` | 12 hours | 1 hour | 1.2s | 60s | `flight_routes.json.gz` |
| adsbdb aircraft | `/v0/aircraft/{icao}` | 30 days | 24 hours | 1.2s (shared) | 60s (shared) | `flight_routes.json.gz` |
| planespotters | `/pub/photos/reg/{reg}` | 30 days | 24 hours | 1.2s | 60s | `photos.json.gz` |
| METAR | `aviationweather.gov/...` | 10 min | 5 min | 2s | 120s | `metar.json.gz` |

### Porting Checklist

If you're replicating this architecture in another stack, the key invariants to preserve are:

1. **Single-writer registry** — all state mutations on one goroutine/thread/actor; readers get an immutable snapshot copy
2. **Tick is always non-blocking** — enrichment reads only in-memory cache; upstream fetches are fire-and-forget
3. **Stale-on-error** — never return a hard error to consumers because an upstream is down; serve the last known good value
4. **CacheEntry has a `null` state** (not just absent) — lets you cache "this callsign doesn't exist in adsbdb" without re-fetching every tick
5. **Drop-oldest channels** — back-pressure must never block the TCP reader (it would desync the BEAST stream)
6. **ParseOne returning `consumed=0`** means "need more data" — callers must not advance the buffer pointer in that case, or the stream desynchronizes permanently
7. **Teleport guard** is essential — CPR decode errors produce geographically impossible jumps; without the guard they pollute trails and distance calculations

---

That covers the full four-pillar architecture. The BEAST ingress pipeline (sections 2.1–2.8), adsbdb/planespotters enrichment pipeline (section 3), tar1090-db reference data system (section 4), and METAR batching system (section 5) are all independently portable — none of them requires ASP.NET or any specific framework beyond an HTTP client and a background task runner.

The last background research agent just completed — its findings confirm everything already in the report above. No corrections needed; all four pillars are fully covered.

A few things worth calling out that weren't obvious until the final agent returned the exact source:

**CPR precision note** — the `Denom = 131072.0` (2¹⁷) is the exact normalization divisor for both latitude and longitude CPR fields. Any reimplementation must use this exact value or decoded positions will drift slightly.

**Callsign trimming quirk** — after the 6-bit decode, the registry does `TrimEnd('_', ' ').Trim()` — adsbdb and the ICAO charset both pad short callsigns with underscores, not just spaces.

**Teleport guard formula** — `max(10 km, elapsed_seconds × 0.5 km/s)` — the 10 km floor is what handles the zero-elapsed edge case (burst of messages in the same timer tick), not just a general fudge factor.

**Registry constants worth keeping verbatim:**
- Stale aircraft timeout: 60 s
- Comm-B freshness window: 120 s
- CPR pair max age: 10 s
- Dead-reckon trigger: 1.5 s
- Trail cap: 300 points
- State persist: every 30 ticks