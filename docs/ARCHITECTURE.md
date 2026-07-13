# Swiss Trail Planner Architecture

> Documented state: selectable raster backgrounds, hiking, closure, military
> shooting-danger, and public-transport overlays,
> search, geolocation, fullscreen, manual route creation, route statistics,
> elevation profile, GPX export, and experimental on-demand swissTLM3D routing
> around user-selected positions.

This document describes the architecture currently implemented in the
repository. It should be updated whenever a structural dependency, major
directory, or primary application flow changes.

## 1. Project goal

Swiss Trail Planner is an open-source web application for planning hiking
routes in Switzerland.

The long-term functional target is similar to BRouter-Web, with one central
difference: the map, topographic network, and future routing graph should rely
primarily on official swisstopo data.

The product is intentionally focused:

- the map occupies almost the entire screen;
- only one active route is handled at a time;
- the route can be created and edited;
- the route can be exported as GPX;
- no route library is planned for the initial product scope.

## 2. Current scope

The current version is a frontend-only application with no backend.

It can:

- switch between official swisstopo color, grey, and SWISSIMAGE aerial backgrounds;
- display the official swissTLM3D hiking-trail portrayal at detailed zoom levels;
- show the official ASTRA hiking-trail closures and detours WMS overlay;
- identify a visible closure and display its localized official metadata;
- show the official Swiss Armed Forces shooting-notice and danger-zone WMS overlay;
- identify a visible military danger zone, highlight its polygon, and display compact localized official metadata;
- optionally show official public-transport stops and inspect localized stop metadata;
- search official Swiss location indexes;
- display a selected search result as a vector marker;
- request and display the user's current position;
- switch the complete interface between French, German, Italian, and English;
- enter and leave browser fullscreen mode;
- enter a visual route-creation mode with a crosshair map cursor;
- add ordered route waypoints by clicking or tapping the map;
- create straight segments when snapping is disabled or a snapped section cannot be resolved;
- load swissTLM3D road and hiking geometries dynamically around selected waypoints;
- build a regional walkable graph and calculate snapped sections with A*;
- prefer official hiking-trail sections through routing costs;
- undo and redo exact straight or routed route steps;
- reverse the complete route without recalculating sections;
- clear the complete route;
- export the displayed route geometry and smoothed elevations as a GPX 1.1 track;
- load one external GPX track or route as an independent read-only reference;
- fit the map to imported GPX geometry without changing editable route history;
- display distance, ascent, descent, and estimated walking time in a compact bar;
- reveal or hide a compact elevation profile from the summary bar;
- reveal a compact route action strip for snap mode, reversal, deletion, and export;
- pan and zoom with custom floating controls;
- restrict navigation to Switzerland and a small border area;
- display a metric scale and swisstopo attribution;
- report map, search, geolocation, and routing failures.

It does not yet include:

- continuous user tracking or route recording;
- a validated production-grade national routing service;
- direct feature inspection or a visible raw-network debug layer;
- validated topology for all junction, bridge, and tunnel cases;
- automatic avoidance of officially closed sections during routing;
- waypoint movement, insertion, or individual deletion;
- local or remote persistence;
- an application server.

## 3. Architecture principles

### 3.1 The map is the main interface

No permanent toolbar occupies the top of the window. Tools use compact floating
controls and temporary panels so the map retains as much space as possible.

### 3.2 Incremental delivery

The project evolves through independent functional layers:

1. raster background;
2. rendered hiking-trail overlay;
3. basic map controls, selectable backgrounds, geolocation, and location search;
4. route-creation interface shell;
5. straight-line route creation with undo and redo;
6. dynamic cell-based swissTLM3D routing around selected waypoints;
7. route reversal, deletion, and GPX export;
8. distance, elevation summary, walking-time estimate, and elevation profile;
9. four-language interface and localized GeoAdmin search;
10. elevation-aware GPX export and read-only GPX reference loading;
11. official hiking-closure overlay and localized feature information;
12. official military shooting-danger overlay and localized feature information;
13. optional public-transport stop overlay and localized stop information;
14. waypoint editing;
15. repeatable routing-data preparation;
16. reliable national hiking routing.

Each milestone should remain testable and usable before the next one begins.

### 3.3 Avoid premature abstraction

Provider and geographic configuration live in `src/map/config.ts`. Marker
creation is isolated in small map modules, while location search and route
controls are separate presentational components. Editable and imported route
displays stay in dedicated map modules instead of adding a broader
map-controller abstraction before drag and selection interactions require one.

OpenLayers map ownership remains in `App.tsx` because there is still only one
map view. Network fetching and graph algorithms are isolated under
`src/routing/`; more extensive drawing interactions may later justify a
dedicated hook or map-controller module.

### 3.4 Comments explain decisions

Comments should not restate obvious code. They should document architecture
decisions, external constraints, non-obvious behavior, lifecycle precautions,
and geographic values chosen by the project.

Non-trivial routing modules begin with a short business-context header. Numeric
tuning constants state their units and trade-offs. Data contracts and complex
public functions use JSDoc, including `@throws` when callers must handle a
failure. Algorithmic blocks such as A*, heaps, adaptive subdivision, caching,
and stale-result guards explain why the safeguard or heuristic exists.

## 4. Technical overview

```text
Browser
   │
   ├── React 19 + TypeScript
   │      │
   │      ├── LocationSearch component
   │      │      └── geo.admin.ch SearchServer
   │      ├── MapLayersSelector, shared information popup wrappers, RouteControls, RouteImportControl, RouteExportDialog, RouteStatistics, and LanguageSelector
   │      ├── typed French, German, Italian, and English dictionaries
   │      ├── route history, imported-GPX state, statistics, and temporary routing status
   │      ├── browser Geolocation API
   │      └── browser Fullscreen API
   │
   ├── App.tsx
   │      ├── owns OpenLayers lifecycle and route-editing state
   │      ├── requests dynamic routing cells for snapped clicks
   │      └── refreshes elevation statistics after route changes
   │
   ├── OpenLayers Map / View
   │      ├── TileLayer: national map (JPEG)
   │      ├── TileLayer: hiking trails (transparent PNG)
   │      ├── TileLayer: military shooting danger zones (transparent WMS)
   │      ├── VectorLayer: selected military danger-zone polygon
   │      ├── TileLayer: hiking closures and detours (transparent WMS)
   │      ├── VectorLayer: filtered passenger public-transport stops
   │      ├── VectorLayer: imported read-only GPX geometry
   │      ├── VectorLayer: editable route geometry and waypoints
   │      ├── VectorLayer: selected search result
   │      └── VectorLayer: user location
   │
   ├── Dynamic routing prototype
   │      ├── GeoAdmin identify requests for regular swissTLM3D cells
   │      ├── in-memory cell and graph caches
   │      ├── corridor-based in-browser graph construction
   │      ├── spatial indexes for trail matching and waypoint snapping
   │      └── A* route calculation
   │
   └── HTTPS requests
          ├── wmts.geo.admin.ch (base maps and hiking trails)
          ├── wms.geo.admin.ch (closure, detour, and military danger-zone portrayal)
          ├── api3.geo.admin.ch (search, routing, information-layer inspection, and elevation profile)
          └── transport.opendata.ch (on-demand public-transport departures)

Deployment
   │
   ├── push to main
   ├── GitHub Actions
   │      ├── npm ci
   │      └── npm run build
   └── GitHub Pages
```

No project-owned service runs on the server. Vite only compiles and serves
frontend assets during development. The routing prototype also runs entirely
in the browser and bounds each operation to a finite set of cells around the
selected route section.

## 5. Technologies

| Technology | Role |
|---|---|
| React 19 | UI components, search state, status messages, and language context |
| TypeScript 5 | Static typing and compile-time verification |
| OpenLayers 10 | Map, view, layers, projections, markers, and controls |
| Vite 8 | Development server, production build, and Pages base path |
| geo.admin.ch SearchServer | Official location search |
| GeoAdmin identify API | On-demand swissTLM3D geometries and information-feature selection |
| GeoAdmin HTML popup API | Localized official closure and military danger-zone metadata |
| GeoAdmin WMS | Official server-rendered closure, detour, and military danger-zone symbology |
| OpenLayers vector styling | Filtered public-transport stop symbols by normalized mode |
| transport.opendata.ch | Documented JSON stationboard for on-demand next departures |
| GeoAdmin elevation profile API | Smoothed terrain elevations along the current route |
| Custom graph builder and A* | Experimental browser routing for dynamically loaded regions |
| Browser Geolocation API | On-demand user position lookup |
| Browser File API and DOMParser | Local GPX selection and validation |
| Browser Fullscreen API | Distraction-free map display |
| Typed in-project i18n dictionaries | Four-language UI without an additional runtime dependency |
| HTML/CSS | Full-screen layout, floating controls, and result panel |
| GitHub Actions | Automated GitHub Pages deployment |
| GitHub Pages | Static production hosting over HTTPS |
| npm | Dependency installation and lockfile management |

## 6. Map services

The selectable backgrounds and hiking overlay use direct XYZ-compatible WMTS
URLs in `EPSG:3857`.

The single OpenLayers base layer swaps between three official JPEG sources:

- `ch.swisstopo.pixelkarte-farbe` for the color national map;
- `ch.swisstopo.pixelkarte-grau` for the mixed-scale grey national map;
- `ch.swisstopo.landeskarte-grau-10` for detailed grey rendering at close zooms;
- `ch.swisstopo.swissimage` for the current SWISSIMAGE aerial orthophoto mosaic.

Changing the source preserves the view and every overlay. The hiking overlay
uses transparent PNG tiles and has `minZoom` set to 12. Because OpenLayers
treats this boundary as exclusive, it normally appears at integer zoom level
13. The overlay remains visible above all three backgrounds.

The hiking overlay is already rendered and therefore cannot expose individual
trail geometries or attributes.

The operational overlay uses the official WMS layer
`ch.astra.wanderland-sperrungen_umleitungen`. Its server-side portrayal keeps
closures, endpoint symbols, and detours consistent with federal viewers. The
layer is enabled by default because it carries important safety information,
but it shares the hiking overlay's `minZoom` threshold so national and regional
overviews are not covered by dense closure symbols. The unified Layers menu can
hide it independently of the background and hiking overlay, and the explicit
choice is persisted in local browser storage.

When the overlay is visible and route creation is inactive, a map click calls
the GeoAdmin identify endpoint with the current map extent, canvas size, and
screen-pixel tolerance. A matching feature ID is then passed to the localized
`htmlPopup` endpoint. The returned official HTML is reduced to a strict set of
safe text, table, link, and image elements before React renders it in a
project-owned panel. This display layer is intentionally informational and
does not modify routing
costs or graph connectivity. Users decide whether a visible closure affects
their planned route.

The military safety overlay uses the official WMS layer
`ch.vbs.schiessanzeigen`. Its server-side portrayal keeps the published danger
zones visually consistent with the federal map viewer. The OpenLayers tile
layer applies partial opacity so map detail and underlying information symbols
remain readable through large polygons. The layer is enabled by default because
live-fire activity can make a planned hiking area unsafe, but it shares the
detailed-zoom threshold used by the hiking and closure overlays. Its explicit
visibility choice is stored independently in local browser storage.

When the layer is visible and route creation is inactive, the same map-click
pipeline identifies a matching danger-zone polygon and asks GeoAdmin to return
its geometry in EPSG:3857 GeoJSON. The official WMS and a small client-side
selection layer are rendered above hiking closures and public-transport stop
symbols, while imported and editable routes remain above the safety overlay.
The selected polygon uses a pale fill and orange outline. The highlight is
cleared with the information panel, when the layer is hidden, when the language
changes, or when route creation starts.
The localized official `htmlPopup` still passes through the common sanitizer,
and a layer-specific final pass removes PDF download links while preserving the
principal place, contact, and current shooting-date information. A visible
closure keeps click priority when both portrayals overlap. Like the closure
layer, the military overlay is informational only and does not change route
costs or connectivity.

The optional public-transport stop overlay uses the official feature layer
`ch.bav.haltestellen-oev`, but does not display its unfiltered raster portrayal.
The source dataset also contains operational and retired points that are not
useful when planning passenger access. At detailed zoom levels, an abortable
viewport loader calls the GeoAdmin identify endpoint, recursively subdivides
dense requests that reach the 200-result limit, and converts point geometry and
selected attributes into client-side OpenLayers features. The identify scale is
capped at the equivalent of Web Mercator zoom 17: closer portrayals expose
technical sub-points such as platform numbers instead of stable passenger stops.
The real viewport still determines which geometry is requested.

Entries without a stop name, numeric-only operating labels, and entries whose
type explicitly indicates an out-of-service stop are omitted. The accepted
passenger modes are explicitly limited to train, metro, tram, bus, boat,
cable-car, chairlift, and funicular. Empty or unrecognized means-of-transport
values are rejected instead of becoming a generic stop category. A narrowly
scoped fallback accepts a known mode only when it appears in the final
parenthesized qualifier of the official name, for records such as
`Plan-Francey (téléphérique)` whose transport field is empty. This avoids
mistaking pure operating points or place names for passenger stops. Cable
categories are mutually exclusive so `Standseilbahn` does not also match the
generic `Seilbahn` cable-car rule. Metro keeps its own translated label while
sharing the clear railway map symbol. Identify results are deduplicated strictly
by their official feature identifier. The client does not merge nearby records by
normalized name or distance: one official feature may already expose several
recognized transport modes, while two different identifiers can represent
neighbouring facilities with different names, timetables, or CFF deep links. A
multimodal feature receives one marker using the highest-priority mode symbol.
When distinct official features would overlap at medium zoom, a deterministic
pixel displacement fans them apart; the displacement is removed once their real
coordinates are visually distinct at a closer zoom. The layer is disabled by
default and its visibility preference is stored locally.

A click first checks the already loaded stop vectors. A hit adds a dedicated
selection halo below the icon and opens a compact project-owned panel. Its
header contains the official stop name followed by all translated transport
modes. The panel passes only the selected feature's official BAV identifier to
the `transport.opendata.ch` stationboard client. Results are validated,
deduplicated, sorted by predicted departure time, and cached for 45 seconds.
The UI groups departures by their localized calendar date in the
`Europe/Zurich` time zone and shows the line, destination, predicted time, and
positive delay when available. The date heading includes the weekday so sparse
or weekend timetables do not make a next-day departure look like a same-day
service. Requests are aborted when another stop is selected or the popup is
closed, and timetable failure does not hide the stop or its two localized
SBB/CFF/FFS deep links. If no stop is hit, the same map interaction checks a
visible hiking closure and then a visible military danger zone. Both official
HTML popups pass through the shared sanitizer; the danger-zone module also
removes PDF download links.

For dynamic routing, `src/routing/swissTlmApi.ts` calls the official GeoAdmin
`MapServer/identify` endpoint for two technical layers:

- `ch.swisstopo.swisstlm3d-strassen` for roads and paths;
- `ch.swisstopo.swisstlm3d-wanderwege` for official hiking routes.

The dynamic loader uses regular 2.4 km routing cells. Each cell is internally
split into smaller identify requests, and a request that reaches the API's
200-feature limit is recursively subdivided rather than silently accepting a
truncated result. Empty cells are valid near borders, lakes, and areas outside
swissTLM3D coverage. This remains a bounded on-demand experiment rather than a
national bulk-data architecture.

## 7. Coordinate reference systems

The OpenLayers view and tile layers use Web Mercator (`EPSG:3857`).

Human-readable centers and bounds, browser geolocation, and SearchServer
results use WGS 84 longitude/latitude (`EPSG:4326`). OpenLayers transforms those
coordinates with `fromLonLat()` before displaying them.

Downloaded swissTLM3D data is distributed in LV95 (`EPSG:2056`). The current
dynamic routing prototype asks GeoAdmin to return geometries directly in
`EPSG:3857` so
they can be displayed and routed without a second client-side reprojection.
When Z coordinates are returned, they are preserved in graph-node identity to
avoid connecting vertically separated crossings.

## 8. Location search

`src/search/locationSearch.ts` calls:

```text
https://api3.geo.admin.ch/rest/services/ech/SearchServer
```

The request uses `type=locations` and limits `origins` to:

- `gg25` for communes;
- `zipcode` for localities and postal codes;
- `gazetteer` for geographic names.

The UI starts searching after two characters and 300 milliseconds of inactivity.
Each effect owns an `AbortController`, so changing the query cancels the older
request.

SearchServer labels may contain simple HTML emphasis tags. The API client parses
them as an HTML document, removes italic classification text, and returns only
plain text to React. The UI never injects returned HTML.

The component supports mouse, touch, and keyboard interaction:

- arrow keys change the active result;
- Enter selects it;
- Escape closes the panel;
- a pointer press outside closes the panel.

Selecting a result transforms its longitude and latitude to `EPSG:3857`,
updates a dedicated marker, and animates the view to zoom level 13.

### 8.1 Interface localization

`src/i18n/I18nContext.tsx` owns the selected language and exposes a typed `t()`
helper. It reads a previously stored choice first, otherwise selects the first
supported browser language, and falls back to English. The provider synchronizes
the document `lang` attribute, metadata description, Swiss `Intl` locale, and
local storage.

`src/i18n/translations.ts` contains complete French, German, Italian, and English
dictionaries. User-facing React text, accessibility labels, temporary errors,
route statistics, elevation-profile labels, and GPX track names use these keys.
The compact `LanguageSelector` is part of the right-side map controls, so
localization does not require a permanent settings panel.

Location search passes the selected two-letter language to SearchServer. Search
origins remain language-neutral in the API module and are translated only by the
UI component. Changing language reruns an open search and applies the matching
Swiss number-format locale to route figures and elevation axes.

## 9. Browser geolocation

The location control uses `navigator.geolocation.getCurrentPosition()` only
after an explicit user action.

The browser may display a permission prompt. The application does not request
the position during startup and does not use continuous tracking.

A successful position updates a dedicated vector marker, recenters the map, and
raises the view to at least zoom level 17. Positions outside the configured map
extent are rejected.

Browser geolocation requires a secure context. Development on `localhost` is
supported, while a deployed version must use HTTPS.

## 10. Fullscreen mode

The fullscreen control calls `requestFullscreen()` on the root `.app` element,
so the map, search field, controls, and temporary messages remain available.

The browser owns the actual fullscreen lifecycle. Pressing `Escape` exits the
mode without application-specific keyboard handling. A `fullscreenchange`
listener keeps the React button state synchronized even when fullscreen is
left through the browser UI or the Escape key.

Entering or leaving fullscreen changes the viewport dimensions. The listener
therefore schedules `map.updateSize()` on the next animation frame so
OpenLayers recalculates its canvas and visible tile area.

## 11. Manual route creation and dynamic regional routing

`App.tsx` owns the route-creation mode because that state affects the map cursor,
the visible controls, and whether the OpenLayers `singleclick` listener is
attached.

Route history is immutable and consists of ordered `RouteStep` objects. A step
contains:

- the displayed waypoint;
- the exact section geometry created from the preceding waypoint;
- the creation mode (`straight` or `network`).

Undo moves the last complete step to a redo stack. Redo restores the stored
step without recalculating it or issuing another network request. Adding a new
step clears the redo stack.

When snapping is disabled, the new section is the direct line between the two
waypoints. When snapping is enabled, the first click loads a 3 × 3 group of
regular cells around the selected position and snaps to the resulting network.
Later clicks load a narrow cell corridor between the previous waypoint and the
new position. Completed cells remain cached in memory and are not requested
again during the browser session.

Missing routing coverage is treated differently from an API failure. If the
loaded cells contain no walkable graph, the first waypoint is placed freely. If
no nearby or connected path exists for a later click, that single incoming
section is stored as a straight segment. The global snap option remains enabled,
so the next click still attempts swissTLM3D routing. This keeps cross-border
routes continuous without hiding genuine request, parsing, or size-limit errors.

`src/routing/swissTlmApi.ts` owns the GeoAdmin request contract, response
validation, geometry normalization, recursive request subdivision, result
deduplication, cancellation, and optional empty-cell handling.

`src/routing/networkRouter.ts` converts every pair of consecutive swissTLM3D
vertices into graph edges. Endpoints are quantized to absorb tiny coordinate
differences, while available elevation is included in the node key so a bridge
and a road below it are not connected merely because their XY coordinates
cross. Clearly non-walkable road types are excluded. Other road types receive
cost factors based on width, surface, traffic importance, access restrictions,
and proximity to official hiking geometry.

Hiking geometry is matched with a spatial grid plus distance and direction
checks. The graph uses a second spatial grid to find nearby snapping candidates.
A* then calculates a section between the snapped start and end positions. The
heuristic uses a lower bound below every configured cost factor so it remains
admissible.

`src/map/route.ts` owns the OpenLayers representation. It concatenates stored
section geometries into one red `LineString` with a white casing and creates one
red-outlined `Point` feature per waypoint. Red is used deliberately so planned
routes do not resemble blue hydrographic features. Rebuilding remains
intentionally simple while routes are small and waypoints are not draggable.

`src/components/RouteControls.tsx` renders the compact toolbar. Undo and redo
are enabled from history state. The snap button selects network or straight
creation; it becomes available after the first waypoint and is temporarily
disabled while cells are loading or a route is being calculated. Disabled
route actions use an opaque light-grey background so map details do not bleed
through the toolbar. The route toggle displays a small animated spinner during
asynchronous network work.

`src/metrics/routeMetrics.ts` calculates horizontal distance locally from the
flattened route geometry. For altitude-dependent figures, it converts the route
from Web Mercator through WGS 84 to approximate LV95 coordinates and sends a
bounded POST request to GeoAdmin's elevation-profile service. The official
swisstopo approximation is sufficiently precise for terrain samples spaced at
about 20 metres. The service applies a small moving-average offset before the
client accumulates positive and negative elevation changes.

`src/components/RouteStatistics.tsx` renders the floating bottom summary and
owns the show/hide state of the profile panel. It shows distance immediately,
uses an ellipsis while elevations are loading, and keeps distance visible with
dashes for the remaining values if the external profile request fails. Walking
time follows the Swiss rule of thumb and is rounded to five minutes because it
is an estimate excluding breaks.

`src/components/RouteElevationProfile.tsx` draws the ordered GeoAdmin samples
as a lightweight responsive SVG above the summary bar. It scales cumulative
distance horizontally and elevation vertically, uses the route red for the
profile line, and performs no extra network request.

Reversal uses `reverseRouteSteps()` to reverse both waypoint order and every
stored section geometry without issuing another routing request. The redo stack
is cleared because its entries belong to the previous direction. Deletion clears
the applied and redo histories while keeping route-creation mode active. GPX
export is enabled after two waypoints and first opens
`src/components/RouteExportDialog.tsx`. The chosen name is then passed to
`src/export/gpx.ts` for both GPX metadata and filename generation. The latest
smoothed elevation samples are passed only when they belong to the current
immutable route geometry.

Routine loading and graph-construction details are intentionally not shown to
the user. Temporary route messages are reserved for actionable problems such as
missing nearby segments, disconnected paths, excessive section length, and
request failures. Leaving route mode aborts the active operation without
discarding cells that completed successfully.

## 12. Read-only GPX import

`RouteImportControl` owns only the hidden file input and compact import button.
It returns the selected `File` to `App.tsx`; no imported data enters React route
history.

`src/import/gpx.ts` parses common GPX tracks and routes locally with
`DOMParser`. Each `trkseg` remains an independent line, and coordinate values
are validated before they are transformed from WGS 84 to the map projection.
Waypoint-only GPX documents are rejected because they do not define an
itinerary. A size limit protects the browser from accidental oversized files.

`src/map/importedRoute.ts` owns a separate purple read-only vector layer below
the red editable route. Loading a new GPX clears and replaces only that layer.
After display, `App.tsx` fits the OpenLayers view to the imported extent; normal
WMTS tile loading then retrieves the map for that location. Route-creation mode,
undo/redo history, statistics, and export remain independent.

## 13. GitHub Pages deployment

The repository is deployed as a GitHub Pages project site:

```text
https://<username>.github.io/swiss-trail-planner/
```

Because the application is hosted below a repository-specific path rather than
the domain root, `vite.config.ts` sets:

```ts
base: '/swiss-trail-planner/'
```

Vite uses this value when generating production asset URLs. Production
artifacts are written to `dist/`.

The workflow `.github/workflows/deploy.yml` runs on every push to `main` and can
also be started manually. It:

1. checks out the repository;
2. installs the exact dependencies from `package-lock.json` with `npm ci`;
3. runs the TypeScript check and Vite build through `npm run build`;
4. uploads `dist/` as a GitHub Pages artifact;
5. deploys that artifact to the `github-pages` environment.

The workflow receives only the permissions required to read the repository and
deploy Pages. Deployment concurrency is limited to one active Pages run, and a
newer push cancels an obsolete deployment.

GitHub Pages serves the application over HTTPS. This is important because
browser geolocation requires a secure context outside `localhost`.

## 14. Geographic constraint

The application uses a rectangular extent covering Switzerland with a small
border margin. It keeps nearby cross-border access visible while preventing
navigation to distant empty areas.

The constraint still applies to the full viewport rather than only its center.
OpenLayers `showFullExtent` is enabled because the Swiss extent is narrower than
a typical desktop viewport: the view may exceed the extent in one dimension so
the complete country remains visible, but it cannot exceed it in both
dimensions. The smooth boundary effect is disabled.

Routing no longer has a fixed geographic extent. Each snapped operation derives
a bounded cell set from the selected positions. A maximum cell count prevents a
single very long section from starting an excessive request burst; the user can
add intermediate waypoints instead. Straight route creation remains available
without this constraint.

## 15. Repository structure

```text
swiss-trail-planner/
├── .github/
│   └── workflows/
│       └── deploy.yml
├── docs/
│   ├── ARCHITECTURE.md
│   └── VALIDATION.md
├── src/
│   ├── closures/
│   │   └── trailClosures.ts
│   ├── dangers/
│   │   └── shootingDangerZones.ts
│   ├── transport/
│   │   └── publicTransportStops.ts
│   ├── components/
│   │   ├── MapInformationPopup.tsx
│   │   ├── MapLayersSelector.tsx
│   │   ├── PublicTransportStopPopup.tsx
│   │   ├── LanguageSelector.tsx
│   │   ├── LocationSearch.tsx
│   │   ├── RouteControls.tsx
│   │   ├── RouteElevationProfile.tsx
│   │   ├── RouteExportDialog.tsx
│   │   ├── RouteImportControl.tsx
│   │   ├── RouteStatistics.tsx
│   │   ├── ShootingDangerZonePopup.tsx
│   │   └── TrailClosurePopup.tsx
│   ├── export/
│   │   └── gpx.ts
│   ├── import/
│   │   └── gpx.ts
│   ├── metrics/
│   │   └── routeMetrics.ts
│   ├── i18n/
│   │   ├── I18nContext.tsx
│   │   └── translations.ts
│   ├── map/
│   │   ├── geoAdminPopup.ts
│   │   ├── config.ts
│   │   ├── importedRoute.ts
│   │   ├── route.ts
│   │   ├── searchResult.ts
│   │   └── userLocation.ts
│   ├── routing/
│   │   ├── networkRouter.ts
│   │   ├── swissTlmApi.ts
│   │   └── dynamicRoutingNetwork.ts
│   ├── search/
│   │   └── locationSearch.ts
│   ├── App.tsx
│   ├── main.tsx
│   └── styles.css
├── .editorconfig
├── .gitignore
├── index.html
├── LICENSE
├── package-lock.json
├── package.json
├── README.md
├── tsconfig.json
└── vite.config.ts
```

## 16. File responsibilities

### `src/App.tsx`

Owns the OpenLayers map instance and coordinates map-level behavior.

It creates the tile and vector layers, replaces the selected base-map source,
handles map, geolocation, fullscreen, GPX reference loading, information-layer
visibility and feature inspection, route-creation mode, immutable route history,
dynamic graph loading, route statistics, and temporary routing status. It
reacts to selected search results and cleans up imperative resources and pending
requests when React unmounts.

### `src/components/MapLayersSelector.tsx`

Renders one floating Layers button and a temporary menu with two sections. Base
maps are mutually exclusive, while information overlays are independently
switchable. The component does not know about OpenLayers; `App.tsx` owns the
actual layer sources and visibility. Outside pointer presses and Escape close
the menu. It owns independent switches for hiking closures, military danger
zones, and public-transport stops without adding another permanent map button.

### `src/components/MapInformationPopup.tsx`

Provides the shared non-modal information panel, close behavior, loading and
error states, and sanitized HTML container used by official information layers.

### `src/components/TrailClosurePopup.tsx`

Supplies closure-specific translations to the shared information panel. Escape
and the close button dismiss the panel without changing map, route, or layer
state.

### `src/components/ShootingDangerZonePopup.tsx`

Supplies shooting-notice and military danger-zone translations to the shared
information panel. Escape and the close button dismiss the panel without
changing map, route, or layer state.

### `src/components/PublicTransportStopPopup.tsx`

Renders the compact structured stop panel. The official stop name and all
translated modes share the same bold header treatment. The component aborts
superseded stationboard requests, groups the next departures by Swiss local date,
formats dates and times in the active locale, and keeps localized links that
prefill the stop as departure or destination on the official SBB/CFF/FFS
timetable.

### `src/closures/trailClosures.ts`

Owns the ASTRA layer identifier, WMS source factory, scale-aware identify
request, localized HTML-popup request, response validation, cancellation, and
popup retrieval. Network contracts remain outside React; shared HTML
sanitization lives under `src/map/geoAdminPopup.ts`.

### `src/dangers/shootingDangerZones.ts`

Owns the Swiss Armed Forces layer identifier, WMS source factory, scale-aware
identify request, returned GeoJSON polygon parsing, selected-area vector layer,
localized HTML-popup request, response validation, cancellation, and compact
popup cleanup. It reuses the shared HTML sanitizer and then removes PDF download
links while retaining the principal official metadata and current shooting
dates.

### `src/transport/publicTransportStops.ts`

Owns the BAV layer identifier, abortable viewport identify requests, the
passenger-scale identify clamp, bounded subdivision for dense results,
multilingual attribute normalization, filtering of numeric operating-only,
out-of-service, empty-mode, or unsupported-mode points, explicit accepted-mode
classification, narrowly scoped name-qualifier fallback, strict deduplication by
official feature identifier, preservation of multimodal metadata on one official
stop, close-symbol fan layouts for distinct neighbouring stops, vector-layer
creation, selection highlighting, and client-side symbol styling.

### `src/transport/stationBoard.ts`

Wraps the documented `transport.opendata.ch/v1/stationboard` resource. It tries
both raw and zero-padded forms of the selected official identifier, validates the
loose JSON contract, normalizes line labels and predicted times, removes duplicate
journeys, sorts departures, and maintains the short in-memory cache. It never
combines timetables from neighbouring map features. The module sends no custom
headers because the provider documents browser CORS with that restriction.

### `src/map/geoAdminPopup.ts`

Sanitizes official GeoAdmin closure and military danger-zone popup fragments,
keeping only safe semantic elements, links, and images. Public-transport stop
panels use structured feature data and do not inject provider HTML.

### `src/components/LanguageSelector.tsx`

Renders the compact native language select inside the floating map controls. It
uses the shared language context and intentionally contains no translation data
or persistence logic.

### `src/components/LocationSearch.tsx`

Owns the search-field interface:

- query state;
- debounce timing;
- request cancellation lifecycle;
- result-panel visibility;
- keyboard navigation;
- result selection.

It does not know about OpenLayers. It reports a typed result through its
`onSelect` callback.

### `src/components/RouteControls.tsx`

Renders the route-mode toggle and the contextual route action buttons. It is a
controlled component: `App.tsx` supplies availability state and callbacks for
snap, undo, redo, reversal, deletion, and GPX export.

### `src/components/RouteImportControl.tsx`

Renders the compact GPX import button and a hidden native file input. It resets
the input before opening so the same filename can be selected again, then
forwards the chosen file without parsing or map knowledge.

### `src/components/RouteExportDialog.tsx`

Displays a temporary native modal dialog before GPX generation. It proposes a
localized route name, selects it for quick replacement, supports Enter and
Escape, and returns only a trimmed non-empty value to `App.tsx`.

### `src/components/RouteStatistics.tsx`

Formats and renders the compact distance, ascent, descent, and duration bar. It
owns the local profile visibility state and the accessible toggle, but performs
no network requests or geographic calculations.

### `src/components/RouteElevationProfile.tsx`

Projects ordered distance/elevation samples into a compact responsive SVG with
axis guides, minimum and maximum altitude, and a route-coloured profile line.

### `src/metrics/routeMetrics.ts`

Calculates geodesic distance, converts route coordinates to LV95 for the
official elevation-profile service, validates ordered distance/elevation
samples, accumulates ascent and descent, and applies the standard Swiss
walking-time estimate. The same samples feed the profile chart. Requests are
abortable so stale route histories cannot update the UI.

### `src/export/gpx.ts`

Converts the complete displayed route geometry from Web Mercator to WGS 84,
builds a GPX 1.1 track, and starts a browser download through a temporary object
URL. The name entered in the export dialog is XML-escaped for metadata and the
track node, sanitized for a portable filename, and used for both outputs. The
module keeps routed intermediate vertices to preserve sharp bends, merges in
the regularly spaced profile distances, and interpolates the smoothed terrain
altitude into `<ele>` values. If no valid profile is available, it falls back to
the previous geometry-only export.

### `src/import/gpx.ts`

Validates file size policy, parses GPX XML, extracts named tracks and routes,
keeps disconnected track segments separate, rejects invalid coordinates, and
returns WGS 84 geometry without touching OpenLayers state.

### `src/map/importedRoute.ts`

Creates and updates the independent read-only GPX vector layer. Its purple
casing style distinguishes imported references from the red editable route and
blue hydrography.

### `src/map/route.ts`

Defines the immutable route-step shape, flattens stored section geometry,
reverses complete routes without recalculation, creates the route vector layer,
and rebuilds its line and waypoint features. It owns route geometry helpers and
styling but not route history or UI state.

### `src/routing/swissTlmApi.ts`

Fetches bounded road and hiking geometries from the GeoAdmin identify endpoint.
It owns request tiling, recursive subdivision at result limits, response
normalization, attribute extraction, deduplication, cancellation, and empty-cell
handling.

### `src/routing/networkRouter.ts`

Builds the walkable regional graph, indexes line segments, matches official
hiking geometry, snaps waypoints, applies routing costs, and calculates A*
paths. It contains no React or OpenLayers map lifecycle state.

### `src/routing/dynamicRoutingNetwork.ts`

Owns the dynamic routing-cell strategy. It derives local or corridor cell sets
from selected positions, limits cell request concurrency, caches completed cell
data and recent graphs, retries disconnected sections with a wider corridor,
and protects the API from excessively large single operations.

### `src/search/locationSearch.ts`

Owns the SearchServer HTTP contract, response validation, label normalization,
language-aware requests, origin identifiers, duplicate removal, and result
limits. It deliberately returns language-neutral origins so React translates
category labels.

### `src/i18n/I18nContext.tsx`

Detects, persists, and publishes the current language and Swiss number-format
locale. It also updates the document language and description metadata.

### `src/i18n/translations.ts`

Defines the supported languages, locale metadata, typed translation keys, and
complete translation dictionaries. Adding a key to French forces every other
language to provide the same key at compile time.

### `src/map/searchResult.ts`

Creates and updates the vector marker for the selected search result.

### `src/map/userLocation.ts`

Creates and updates the separate vector marker for browser geolocation.

### `src/map/config.ts`

Centralizes provider identifiers, attribution, map extent, zoom settings, and
tile-source factories.

### `src/styles.css`

Defines the full-screen layout, left-side search control, right-side map
controls, shared information panel, route statistics, result panels, status
messages, and OpenLayers control placement.

### Remaining root files

- `src/main.tsx` mounts React, the language provider, and styles.
- `index.html` is the browser entry point.
- `package.json` declares dependencies and npm scripts.
- `package-lock.json` locks dependency versions.
- `vite.config.ts` configures React and the GitHub Pages base path.
- `.github/workflows/deploy.yml` builds and deploys `dist/` to GitHub Pages.
- `tsconfig.json` enables strict TypeScript.
- `.editorconfig` and `.gitignore` define repository conventions.
- `README.md` is the quick-start guide.
- `docs/VALIDATION.md` contains repeatable release checks, routing scenarios,
  regression locations, and a test log.
- `LICENSE` contains the MIT license.

## 17. Runtime flow

1. The browser loads the React application and resolves a stored or browser language.
2. The language provider updates document metadata and exposes localized strings.
3. `App` creates the OpenLayers map, tile layers, marker layers, editable route layer, and imported-route layer.
4. The default color base map begins loading from `wmts.geo.admin.ch`.
5. The Layers menu changes the base-map source or toggles information overlays.
6. The rendered hiking overlay starts loading when zoom moves beyond level 12.
7. The official closure WMS is enabled by default unless a stored preference hides it, and appears only beyond the hiking-overlay zoom threshold.
8. The official military shooting-danger WMS is enabled by default unless a stored preference hides it, uses the same detailed-zoom threshold, and has a separate vector layer for the selected polygon.
9. The public-transport stop vector layer remains disabled by default unless a stored preference enables it. At detailed zoom levels, move-end events load and filter the visible passenger stops.
10. A map click inspects the loaded stop vectors first, then a visible hiking closure, and finally a visible military danger zone.
11. A stop opens a compact structured panel immediately and starts an abortable stationboard request; closure and danger-zone polygons fetch localized official popups through the shared sanitizer, while a selected danger zone is highlighted from its returned GeoJSON geometry and PDF links are removed from military notices.
12. Selecting a GPX parses it locally, replaces the read-only reference layer,
    and fits the map to the imported geometry.
13. The route button toggles route-creation mode and the crosshair cursor.
14. Entering route mode attaches a map `singleclick` listener and reveals the
    route toolbar.
15. With snapping disabled, a click stores a direct section immediately.
16. The first snapped click derives and loads a local 3 × 3 cell group while
    the route toggle shows a compact spinner.
17. Dense identify requests are subdivided when either layer reaches 200 results.
18. Returned road vertices become graph nodes and edges; hiking geometry marks
    preferred edges through spatial matching.
19. The first clicked point is snapped to the nearest walkable segment.
20. Later clicks derive a corridor of cells between waypoints, load only missing
    cells, and run A* on the resulting graph.
21. A disconnected or empty corridor is retried once with a wider cell radius.
22. If no routable path remains, the current click becomes a free point or a
    straight fallback section while snap mode stays enabled.
23. Updating route history rebuilds the route line and waypoint features.
24. Distance is recalculated locally from the flattened route geometry.
25. After a short debounce, an abortable profile request refreshes ascent,
    descent, estimated walking time, and the reusable chart samples.
26. The profile button reveals or hides the SVG chart without another request.
27. Undo moves the last complete step to redo; redo restores it without routing.
28. Reversal rebuilds immutable steps in the opposite order and clears redo.
29. Deletion clears both applied and redo histories and hides the summary.
30. GPX export opens a modal naming form before any XML is generated.
31. Confirming the form converts the flattened route to WGS 84, merges exact
    route vertices with regular elevation samples, and downloads a GPX track
    whose internal name and proposed filename come from the same user value.
32. Changing language updates interface text, number formatting, document
    metadata, and subsequent GeoAdmin requests without recreating the map.
33. Leaving route mode removes the click listener and aborts active network work
    while keeping completed cells, route geometry, and statistics available.
34. The fullscreen button requests fullscreen for the root application element.
35. A `fullscreenchange` event synchronizes UI state and resizes OpenLayers.
36. Location search and browser geolocation continue to operate independently.
37. On unmount, map listeners, timers, requests, references, and the map target
    are cleaned up by their owning components.
38. A push to `main` triggers the Pages workflow, which builds and deploys
    `dist/`.


## 18. Error handling

Initial base-map failure is blocking because the application cannot function
without a map. Isolated later tile failures do not hide an already usable map.

Hiking-overlay, closure-WMS, military danger-zone WMS, public-transport
viewport-loading, and stationboard failures remain non-blocking.

Search failures display a temporary result-panel message and allow immediate
retry through another query. Aborted searches are ignored.

Geolocation failures display a temporary message beside the controls and can be
retried by clicking the button again.

Missing nearby segments, empty coverage, and disconnected graphs are normal
routing outcomes rather than blocking errors. After one wider-corridor retry,
the editor silently stores a free first waypoint or a straight incoming
section. Snap mode remains enabled for the next click.

Overly large single sections, GeoAdmin transport or parsing failures, and
result-limit overflow remain errors; they do not modify the existing route. An
active operation is aborted when route mode is left or the application unmounts.
There is no persistent logging or general retry mechanism yet.

Information-layer loading, identify, and popup failures do not affect map
navigation or route state. Closure and military danger-zone panels report a
localized error, and turning an active layer off aborts its pending feature
work. A failed stop refresh keeps the map usable and does not expose unfiltered
operating points.

Elevation-profile failures are non-blocking. The distance remains visible,
altitude-dependent values become dashes, and route editing continues normally.
Superseded profile requests are aborted after route mutations.

Invalid, empty, or oversized GPX files leave both the existing imported layer
and editable route untouched and produce a translated temporary error. Imported
GPX handling performs no network request.

## 19. Code conventions

- Keep strict TypeScript enabled.
- Centralize provider and geographic constants.
- Keep network contracts outside React components.
- Keep every user-facing string in the typed translation dictionaries.
- Keep search origins language-neutral and translate them in the UI layer.
- Never inject SearchServer label HTML into the DOM.
- Sanitize official HTML-popup responses before rendering their limited semantic markup.
- Abort superseded network requests.
- Preserve explicit layer ordering.
- Request privacy-sensitive capabilities only after explicit user input.
- Keep fullscreen state synchronized through `fullscreenchange` rather than
  assuming a button click always succeeds.
- Keep route controls compact and expose active modes through both color and
  cursor changes.
- Keep route history immutable so undo and redo remain predictable.
- Store generated section geometry instead of recalculating it during redo.
- Keep experimental identify requests geographically bounded and abortable.
- Preserve available swissTLM3D elevation when identifying graph nodes.
- Keep elevation-profile requests abortable and independent from route editing.
- Recalculate the OpenLayers size after viewport mode changes.
- Remove listeners and clear timers during cleanup.
- Comments should explain why, not restate obvious code.
- Give non-trivial modules a business-context header.
- Document units and trade-offs for numeric tuning constants.
- Use JSDoc for data contracts and complex public functions, including
  `@throws` for expected failures.
- Explain sensitive algorithmic blocks such as A*, heaps, adaptive subdivision,
  concurrency limits, caches, and stale-result guards.
- `npm run build` must succeed before an important commit.
- Production asset paths must remain compatible with the configured Pages base.

## 20. Validation and possible evolution

Repeatable release checks, regional routing scenarios, known regression
locations, browser coverage, and a reusable test log live in
`docs/VALIDATION.md`. This keeps operational validation separate from the
architecture description.

The main product scope is implemented. Further work should be driven by observed
usage or validation results rather than by a fixed feature roadmap. Possible
follow-ups include waypoint movement or insertion, focused automated regression
tests, conservative timetable refresh, and a preprocessed routing graph or
backend only if measured browser-routing limits justify that complexity.

## 21. When to evolve the architecture

Create a new abstraction when several components reuse the same map logic,
OpenLayers interactions become numerous, shared state outgrows `App`, additional
network APIs appear, or unit tests require isolated pure functions.
