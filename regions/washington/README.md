# Washington pack

This pack supplies road alerts and traffic-camera snapshots using the documented
[WSDOT Traveler API](https://www.wsdot.wa.gov/traffic/api/).
The reviewed `wsdot-travel` adapter requires `WSDOT_API_KEY`, an access code obtained from that page.
Store it only in the operator's environment; it is never included in manifests, stored source URLs or
client responses. An absent key disables Washington traffic and reports `not_configured`; no
ArcGIS traffic fallback is used. Road alerts are checked every 60 seconds;
camera metadata every five minutes. Image refresh timing is controlled by the publisher.

Queries and normalized results are bounded to the configured monitoring area. Select Oregon and
Washington together for Columbia River border areas. The monitoring bounds, rather than the map
center alone, determine whether each provider covers the area. Selecting packs does not move the map.

Providers write isolated snapshots that are merged into the existing traffic contracts. Camera URLs
shared with TripCheck are deduplicated; existing ODOT camera IDs remain valid for bookmarks. Rows
carry source attribution and fetch timestamps; capabilities report each source's freshness separately.
A failed source retains its own last snapshot until expiry and cannot overwrite another source.

The pack also subscribes to the shared FlashAlert Emergency Newswire. This is a regional subscription,
not a Washington-only feed; selecting both packs subscribes once. Operator feed settings take precedence.

Washington outages, transit, road-weather stations, message signs and corridor flow are
not included yet. Oregon retains those contracts where provided. Pack changes require a poller restart;
the admin Region page reports when the saved selection has not been applied.

## Fire sources

`wadnr-fire-danger` reads the documented DNR public GIS service linked through the
[DNR GIS open-data portal](https://data-wadnr.opendata.arcgis.com/). Danger areas and published burn
restriction labels/notes are checked every 30 minutes and filtered to the monitoring bounds.
Restrictions apply to DNR-protected forestlands; this feed does not represent every municipal, county
or air-quality restriction. Unknown danger remains unknown. Washington's five-level label and rank
are retained; the v0 map uses its existing four severity colours for compatibility.

The existing national NIFC perimeter source is shared across packs. It now reads current perimeters
with bounded, paginated, DNS-pinned requests. A shared current NIFC/WFIGS incident poller runs every
ten minutes; wildfire incidents carry IRWIN IDs, acreage, containment and publisher update times.
EONET supplies gaps when no fresh matching NIFC incident is available. FIRMS remains a separate
satellite-hotspot feed. No extra NIFC collector starts when both packs are selected.

Sources: [DNR danger/burn restrictions](https://gis.dnr.wa.gov/site3/rest/services/Public_Wildfire/WADNR_PUBLIC_WD_WildfireDanger/MapServer),
[NIFC open data](https://www.nifc.gov/fire-information/maps). Publisher data are dynamic and carry
accuracy/liability disclaimers; mapped perimeters are not evacuation boundaries.

## Outage access research

The [Commerce statewide dashboard](https://www.commerce.wa.gov/eremo/) links to
[OutageMapV5Public](https://www.arcgis.com/home/item.html?id=d7ae48976a774f6ba7a55db3931d317b).
On the access check recorded in the task log, direct layer metadata and count queries
returned ArcGIS error 403 (`GWM_0003`). Public dashboard visibility does not establish
permission for independent API access. No dashboard session, token or referrer workaround
is used. An authorized integration endpoint and reuse terms are needed before adding it.
The dashboard participant list also excludes Clark Public Utilities, so even access to this
source would not establish complete Vancouver-area outage coverage.
