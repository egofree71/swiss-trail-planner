# Swiss Trail Planner

Open-source web application for planning hiking routes on official swisstopo
maps and geodata.

The current version displays the Swiss national raster map, the official
swissTLM3D hiking-trail overlay, lightweight map navigation tools, manual
route creation, and experimental on-demand swissTLM3D routing around the
positions selected by the user.

## Current features

- full-screen interactive Swiss national map;
- selectable official swisstopo color, grey, and SWISSIMAGE aerial backgrounds;
- official hiking trails displayed above every background at detailed zoom levels;
- official hiking-trail closures and detours shown by default, with click details;
- optional passenger-relevant public-transport stops with mode-specific symbols, compact click details, and next departures;
- search for Swiss communes, localities, postal codes, and geographic names;
- selected search result displayed with a map marker;
- large, separated zoom controls;
- one-click browser geolocation with a map marker;
- interface available in French, German, Italian, and English;
- fullscreen map mode with automatic exit through the Escape key;
- route-creation mode with a dedicated cursor and inverted active button;
- ordered waypoints and a clearly visible red route added by map clicks or
  taps;
- experimental snapping and A* routing on swissTLM3D roads and paths loaded
  on demand;
- straight-line segments when snapping is disabled or no routable swissTLM3D path is available;
- functional undo and redo that restore the exact generated segment geometry;
- route reversal, complete route deletion, and named elevation-aware GPX track export;
- read-only GPX route loading that frames the map without replacing the editable route;
- compact route summary with distance, ascent, descent, estimated walking time,
  and a collapsible elevation profile;
- navigation restricted to Switzerland and a small border margin;
- metric scale bar;
- swisstopo attribution;
- no permanent toolbar covering the map.

## Architecture

The current architecture, file responsibilities, technical choices, and
planned evolution are documented in:

[`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)

## Roadmap

Completed milestones, current priorities, and future work are tracked in:

[`ROADMAP.md`](ROADMAP.md)

## Requirements

Vite 8 requires at least:

- Node.js 20.19 or later; or
- Node.js 22.12 or later.

A recent LTS version is recommended.

Check the installed versions with:

```bash
node --version
npm --version
```

## Installation

From the repository root:

```bash
npm install
npm run dev
```

Vite then displays a local address, usually:

```text
http://localhost:5173/
```

## Interface languages

The interface supports French, German, Italian, and English. On first use, the
application selects the first supported browser language and falls back to
English. A compact language selector in the map controls changes the interface
immediately and stores the choice in local browser storage.

Location search requests use the selected language when calling GeoAdmin, and
number formatting follows the corresponding Swiss locale. All user-facing
labels, messages, accessibility text, route statistics, and elevation-profile
text come from typed translation dictionaries under `src/i18n/`.

## Hiking-trail closures and detours

The unified Layers menu controls the official ASTRA closures and detours layer:

```text
ch.astra.wanderland-sperrungen_umleitungen
```

The transparent WMS overlay keeps the official server-side symbology for closed
sections, end markers, and proposed detours. It is enabled by default because
closures are important planning information, but it is rendered only at the
same detailed zoom levels as the hiking-trail overlay to avoid cluttering the
national overview. The Layers menu can hide it, and the browser remembers that
choice locally.

Clicking a visible feature while route-creation mode is inactive identifies it
through GeoAdmin and opens the official localized metadata in a sanitized
project-owned panel. Turning the layer off closes the panel and stops further
identify requests. The overlay is intentionally informational only: route
calculation does not automatically avoid a closed section, matching the
planning workflow of other hiking applications.

## Public transport stops

The Layers menu can display the official Federal Office of Transport layer:

```text
ch.bav.haltestellen-oev
```

It is disabled by default and the browser remembers an explicit choice. At
detailed zoom levels, the application requests visible stop features through
the GeoAdmin identify API. Identification is capped at a stable passenger-stop
portrayal scale because the official layer exposes technical platform objects at
its closest scales. Numeric-only operating points, explicitly out-of-service
records, and entries without a recognized passenger transport mode are removed.
The accepted categories are train, metro, tram, bus, boat,
gondola/cable-car, chairlift, and funicular. An empty transport field is accepted
only when the official name ends with an explicit parenthesized known mode, such
as `(téléphérique)`. The remaining stops are rendered as client-side vectors.
Records are deduplicated only by their official feature identifier: the
application does not infer an interchange from a similar name or a short
distance. A single official feature can already advertise several recognized
modes and is then represented by one marker, using the highest-priority mode
symbol. Distinct official features remain separate even when their names or
coordinates are almost identical; when their icons would overlap, the symbols
are temporarily fanned apart until a closer zoom reveals their real positions.
Metro keeps its own popup label while using the train symbol on the map.

Clicking a visible stop while route creation is inactive highlights its map
symbol and opens a compact panel. The header shows the official stop name and
all detected transport modes. The panel then requests the next departures for
that exact official identifier from the documented `transport.opendata.ch`
stationboard API and shows line, destination, predicted time, and positive delay
when available. A multimodal official stop naturally returns departures for
its supported services without borrowing identifiers from neighbouring markers.
A short in-memory cache avoids repeating the same request when a popup is
reopened.

Two localized links still open the official SBB/CFF/FFS timetable with the stop
prefilled as either departure or destination. Departure loading is non-blocking:
if the external timetable service is unavailable, the stop details and CFF links
remain usable.

## Location search

The search field uses the official geo.admin.ch `SearchServer` endpoint:

```text
https://api3.geo.admin.ch/rest/services/ech/SearchServer
```

The current search is limited to:

- communes;
- localities and postal codes;
- geographic names printed on the national map.

Search requests start after two characters and a short delay. A newer request
cancels the previous one. Selecting a result places a marker and recenters the
map at zoom level 13.

## Geolocation

The location button requests the user's current position through the browser.

- the user must grant permission;
- `localhost` is accepted during development;
- a deployed version must use HTTPS;
- positions outside the configured Swiss map extent are not displayed.

The application requests a position only when the button is clicked. It does
not continuously track the user.

## Fullscreen mode

The fullscreen button uses the browser Fullscreen API to display the complete
application without the browser chrome. The button changes state while
fullscreen is active, and the browser exits fullscreen when the user presses
`Escape`.

## Route creation

The route button at the top right toggles route-creation mode. While the mode is
active, the map uses a crosshair cursor. Each click or tap adds an ordered
waypoint.

With snapping enabled, the application loads swissTLM3D road and path
geometries around the selected positions through the official GeoAdmin identify
API. The first point loads a small group of regular cells around the click. Each
following section loads only the missing cells in a corridor between the
previous waypoint and the new click, then builds a graph and calculates the
route with A*. Completed cells remain cached in browser memory for the session.

Official hiking-trail geometries are matched to road segments and receive a
lower routing cost. If the initial corridor is disconnected, the application
retries once with a wider corridor. Very long sections are rejected before an
excessive number of API requests is started; adding an intermediate waypoint
keeps loading regional and predictable. During network work, the route button
shows a compact activity spinner instead of exposing internal loading and
graph-construction messages.

This remains an experimental browser-only delivery strategy rather than a
validated national routing service. When snapping is disabled, the editor adds
straight segments without loading swissTLM3D data. When snapping stays enabled
but no nearby or connected swissTLM3D route can be found, only that waypoint or
section falls back to free placement and a straight segment. Snap mode remains
enabled for subsequent clicks, which allows a route to cross briefly into areas
without swissTLM3D coverage, such as neighbouring countries.

Undo removes the most recently added waypoint and its segment. Redo restores
the exact stored geometry without repeating the network request. Adding a new
waypoint after an undo clears the redo history. The route remains visible when
route-creation mode is left and can be continued by entering the mode again.

The route can be reversed without another routing request: waypoint order and
each stored section geometry are reversed in memory. Deleting clears the
complete route and its redo history while keeping creation mode active. Before
export, a compact dialog asks for the route name. The same value is written into
the GPX metadata and track name and is used as the proposed `.gpx` filename.
Export then creates a GPX 1.1 track containing the complete displayed geometry,
including all intermediate swissTLM3D vertices. When the elevation profile is available,
the export also inserts regularly spaced track points with smoothed `<ele>`
values. This preserves sharp route bends while giving compatible applications
enough altitude samples to reproduce a profile close to the one shown here. If
elevation lookup failed or is still pending, geometry-only GPX export remains
available.

## Read-only GPX route loading

The import button below the route-creation control opens a local `.gpx` file.
Tracks (`trk/trkseg/trkpt`) and routes (`rte/rtept`) are displayed as a separate
purple reference layer, and the map automatically frames the loaded geometry.
Disconnected GPX track segments remain disconnected instead of being joined by
an invented line.

The imported itinerary is read-only: it does not enter route history, does not
change route statistics, and cannot be exported as the editable route. Route
creation remains fully available at the same time, so a new red route can be
planned over the loaded reference. Loading another GPX replaces only the
previous imported reference.

Once the route contains a complete section, a compact bar appears at the bottom
of the map. Distance is calculated immediately from the displayed geometry. The
application then requests a smoothed elevation profile from the official
GeoAdmin profile service and displays total ascent, total descent, and an
estimated walking time. The estimate follows the Swiss rule of thumb: 15 minutes
per kilometre, 15 minutes per 100 metres of ascent, and 15 minutes per 200 metres
of descent. Breaks are not included. If elevation lookup fails, distance remains
available while the altitude-dependent values display a dash. A button on the
right side of the summary toggles a compact elevation chart built from the same
ordered samples, so opening the profile does not trigger another network request.

## Production build

```bash
npm run build
```

The generated files are written to `dist/`.

Local preview:

```bash
npm run preview
```

## Deployment

The application is deployed to GitHub Pages through:

```text
.github/workflows/deploy.yml
```

Every push to `main` installs the locked npm dependencies, builds the Vite
application, and deploys the generated `dist/` directory.

The project is configured for a repository site published at:

```text
https://<username>.github.io/swiss-trail-planner/
```

GitHub Pages must be enabled once in the repository settings by selecting
**GitHub Actions** as the Pages source.

## Map sources

Selectable base maps:

- XYZ URL template:
  `https://wmts.geo.admin.ch/1.0.0/{layer}/default/current/3857/{z}/{x}/{y}.jpeg`
- color national map: `ch.swisstopo.pixelkarte-farbe`;
- grey national map: `ch.swisstopo.pixelkarte-grau`;
- detailed grey map at close zooms: `ch.swisstopo.landeskarte-grau-10`;
- current aerial orthophoto mosaic: `ch.swisstopo.swissimage`.

The compact Layers button opens one temporary menu with mutually exclusive base
maps and independently switchable information overlays. Changing the background
preserves search markers, routes, overlays, and the current view.

Hiking trails:

- XYZ URL template:
  `https://wmts.geo.admin.ch/1.0.0/{layer}/default/current/3857/{z}/{x}/{y}.png`
- Layer:
  `ch.swisstopo.swisstlm3d-wanderwege`

Closures and detours:

- WMS endpoint: `https://wms.geo.admin.ch/`;
- Layer: `ch.astra.wanderland-sperrungen_umleitungen`;
- feature details: GeoAdmin `identify` and `htmlPopup` endpoints.

Public transport stops:

- feature layer: `ch.bav.haltestellen-oev`;
- viewport loading: GeoAdmin `identify` endpoint with GeoJSON geometry;
- rendering: filtered client-side OpenLayers vectors with mode-specific symbols;
- next departures: `https://transport.opendata.ch/v1/stationboard`.

Shared settings:

- display projection:
  `EPSG:3857`
- attribution:
  `© swisstopo`

The hiking-trail layer is currently a rendered transparent tile overlay. It is
hidden at overview scales and appears when the view zooms beyond level 12. Raw
vector geometries are loaded on demand for routing, but they are not yet shown
as an inspectable development layer.

## Next milestone

Validate dynamic routing, public-transport departures, and the information
overlays in several contrasting regions, then continue waypoint-editing work.

## License

The source code is released under the MIT License.

swisstopo geodata remains subject to its own usage and attribution terms.
