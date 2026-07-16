# Swiss Trail Planner Architecture

> Documented state: native LV95 (`EPSG:2056`) map rendering with selectable
> raster backgrounds, hiking, closure, military shooting-danger, and
> public-transport overlays,
> search, geolocation, fullscreen, manual route creation with draggable,
> insertable, and individually removable waypoints, optional loop closure, route
> statistics, elevation profile, GPX export, and experimental
> on-demand swissTLM3D routing around user-selected positions.

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
- display the official swissTLM3D hiking-trail portrayal at detailed zoom levels and hide or restore it independently;
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
- drag an existing waypoint and recalculate only its adjacent sections after release;
- click an existing waypoint to remove it and reconnect its neighbours;
- drag an existing route section to insert a new waypoint and reshape that section;
- show contextual hover guidance for waypoint and route-section editing;
- create straight segments when snapping is disabled or a snapped section cannot be resolved;
- load swissTLM3D road and hiking geometries dynamically around selected waypoints;
- build a regional walkable graph and calculate snapped sections with A*;
- prefer official hiking-trail sections through routing costs;
- undo and redo complete route edits with their exact stored geometry;
- reverse the complete route without recalculating sections;
- close the route with a dedicated final section back to the first waypoint, or reopen it without losing the normal route;
- clear the complete route;
- export the displayed route geometry and smoothed elevations as a GPX 1.1 track;
- load one external GPX track or route as the current read-only itinerary;
- replace the editable route on successful GPX import and clear the imported GPX when a new editable route starts;
- calculate imported GPX distance, ascent, descent, walking time, and elevation profile without inventing links across separate track segments;
- display distance, ascent, descent, and estimated walking time in a compact bar;
- reveal or hide a compact elevation profile from the summary bar;
- show the nearest itinerary position while hovering the map route and mirror it into the open elevation profile;
- reveal a compact route action strip for snap mode, reversal, loop closure, deletion, and export;
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
14. draggable waypoint editing;
15. route-section dragging for waypoint insertion;
16. individual waypoint deletion with contextual hover guidance;
17. repeatable routing-data preparation;
18. reliable national hiking routing.

Each milestone should remain testable and usable before the next one begins.

### 3.3 Avoid premature abstraction

Provider and geographic configuration live in `src/map/config.ts`. Marker
creation is isolated in small map modules, while location search and route
controls are separate presentational components. Editable route rendering and
its focused route-shaping pointer interaction remain together in `src/map/route.ts`;
the imported route stays in its own map module and shares only the current-itinerary metrics pipeline. A broader map-controller
abstraction is still unnecessary for one bounded editing interaction.

OpenLayers map ownership remains in `App.tsx` because there is still only one
map view. Network fetching and graph algorithms are isolated under
`src/routing/`; several additional drawing interactions may later justify a
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
   │      ├── route edit snapshots, single-current-itinerary imported-GPX state, statistics, and temporary routing status
   │      ├── browser Geolocation API
   │      └── browser Fullscreen API
   │
   ├── App.tsx
   │      ├── owns OpenLayers lifecycle, route-editing state, and adjacent-section recalculation
   │      ├── requests dynamic routing cells for snapped clicks
   │      └── refreshes elevation statistics after editable-route or imported-GPX changes
   │
   ├── OpenLayers Map / View (`EPSG:2056`)
   │      ├── WMTS TileLayer: national map in the native LV95 grid
   │      ├── WMTS TileLayer: hiking trails in the native LV95 grid
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
| OpenLayers 10 | Map, native LV95 view, layers, projections, markers, controls, and route-shaping pointer interaction |
| proj4 | EPSG:2056 definition and OpenLayers transformation registration |
| Vite 8 | Development server, production build, and Pages base path |
| geo.admin.ch SearchServer | Official location search |
| GeoAdmin identify API | On-demand swissTLM3D geometries and information-feature selection |
| GeoAdmin HTML popup API | Localized official closure and military danger-zone metadata |
| GeoAdmin WMS | Official server-rendered closure, detour, and military danger-zone symbology |
| OpenLayers vector styling | Filtered public-transport stops with locally bundled SVG symbols by normalized mode |
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

The selectable backgrounds and rendered hiking overlay use the official WMTS
service directly in the native Swiss LV95 grid (`EPSG:2056`).
`src/map/projection.ts` contains the published resolution pyramid, matrix sizes,
and projection registration; `src/map/config.ts` builds explicit OpenLayers
`WMTSTileGrid` instances rather than relying on an XYZ/Web-Mercator shortcut.

The view exposes native matrix levels 0 through 28 and may interpolate smoothly
between them. Matrix 24 belongs to the documented pyramid but is not requested
because the service does not expose it. Ordinary national-map and overlay
sources request matrices 0 through 23, 25, and 26. SWISSIMAGE additionally
requests matrices 27 and 28; ordinary sources are allowed to stretch their
finest published tiles at those two client zoom levels.

The single OpenLayers base layer swaps between three official sources:

- `ch.swisstopo.pixelkarte-farbe` for the color national map;
- `ch.swisstopo.pixelkarte-grau` for the mixed-scale grey national map;
- `ch.swisstopo.landeskarte-grau-10` for detailed grey rendering at close zooms;
- `ch.swisstopo.swissimage` for the current SWISSIMAGE aerial orthophoto mosaic.

Changing the source preserves the native LV95 view and every overlay. The
hiking overlay uses transparent PNG tiles and has `minZoom` set to 18. Because
OpenLayers treats this boundary as exclusive, it normally appears from native
level 19, whose resolution is 20 metres per pixel. The overlay remains above
all three backgrounds, is enabled by default, and can be hidden independently
from the first information-layer switch. The explicit choice is persisted in
local browser storage.

The hiking overlay is already rendered and therefore cannot expose individual
trail geometries or attributes. Its visibility affects portrayal only and does
not change the separate swissTLM3D geometry used by route calculation.

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
its geometry in EPSG:2056 GeoJSON. The official WMS and a small client-side
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
selected attributes into client-side OpenLayers features. The identify scale
is capped at native level 25 (1 metre per pixel): closer
portrayals expose technical sub-points such as platform numbers instead of
stable passenger stops.
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
Symbols use 20 pixels at broad urban and regional scales, 23 pixels from native
levels 21 through 24, then grow to 29 pixels at level 25, 33 pixels at level 26,
and 37 pixels from level 27. This keeps dense city views readable while
preserving clear symbols during detailed hiking planning. Locally bundled SVG
pictograms use a darker Swiss-map
blue and remain sharp when OpenLayers renders them on high-density displays.
Selection halos and close-stop fan-out spacing scale with the same size changes.
When distinct official features would overlap at medium zoom, a deterministic
pixel displacement fans them apart; the displacement is removed once their real
coordinates are visually distinct at a closer zoom. The layer is disabled by
default and its visibility preference is stored locally.

A click first checks the already loaded stop vectors. A hit adds a dedicated
selection halo below the icon and opens a compact project-owned panel. Its
header keeps the official stop name on its own line and shows the available
transport modes below it as compact SVG pictograms with translated alternative
text and tooltips. The panel passes only the selected feature's official BAV identifier to
the `transport.opendata.ch` stationboard client. Results are validated,
deduplicated, sorted by predicted departure time, and cached for 45 seconds.
The UI groups departures by their localized calendar date in the
`Europe/Zurich` time zone and shows the line, destination, predicted time, and
positive delay when available. On desktop, the transport panel uses intrinsic
sizing between 23 and 29 rem: short destination lists remain compact, while longer
names can expand the panel before ellipsis is required. The stop-name header and
fixed CFF action labels are excluded from intrinsic sizing so timetable content
determines the width; a long stop name wraps within that result instead of expanding
the panel. Narrow viewports still use the available responsive width.
The line column follows the widest displayed service label within compact minimum
and maximum bounds, so short labels do not waste destination space while unusually
long labels remain safely truncated. A small dedicated gap separates the line badge
from the destination. When at least one displayed service has a positive delay, fixed
time and delay columns keep delayed services aligned with on-time departures. When no
displayed service is delayed, the unused delay column is removed.
The final time or delay column keeps a small inset from the panel edge in both layouts,
so the timetable remains aligned without looking cramped. A predicted departure with a
positive delay uses the same pure-red emphasis as its explicit delay value, while
the numeric `+X min` indicator remains visible so the status is not conveyed by
colour alone.
The date heading includes the weekday so
sparse or weekend timetables do not make a next-day departure look like a
same-day service. Requests are aborted when another stop is selected or the popup is
closed, and timetable failure does not hide the stop or its two localized
SBB/CFF/FFS deep links. If no stop is hit, the same map interaction checks a
visible hiking closure and then a visible military danger zone. Both official
HTML popups pass through the shared sanitizer; the danger-zone module also
removes PDF download links.

For dynamic routing, `src/routing/swissTlmApi.ts` calls the official GeoAdmin
`MapServer/identify` endpoint for two technical layers:

- `ch.swisstopo.swisstlm3d-strassen` for roads and paths;
- `ch.swisstopo.swisstlm3d-wanderwege` for official hiking routes.

The dynamic loader requests geometries directly in `EPSG:2056` and uses regular
2.4 km routing cells whose dimensions are now true LV95 metres. Each cell is
internally
split into smaller identify requests, and a request that reaches the API's
200-feature limit is recursively subdivided rather than silently accepting a
truncated result. Empty cells are valid near borders, lakes, and areas outside
swissTLM3D coverage. This remains a bounded on-demand experiment rather than a
national bulk-data architecture.

## 7. Coordinate reference systems

The OpenLayers view, WMTS backgrounds, WMS overlays, vector features, editable
route, imported-route display, and dynamic routing graph all use Swiss LV95
(`EPSG:2056`). Keeping internal geometry in the national metric projection
avoids browser reprojection of the swisstopo raster maps and gives routing,
snapping, hit tolerances, and cell sizes a consistent metre-based coordinate
system.

`src/map/projection.ts` defines EPSG:2056 through `proj4`, registers it with
OpenLayers before map creation, publishes the official LV95 WMTS extent and
resolution pyramid, and owns the two explicit WGS 84 boundary conversions.

WGS 84 longitude/latitude (`EPSG:4326`) remains the exchange format for browser
geolocation, SearchServer results, and GPX files. These coordinates are
converted to LV95 when they enter the map and converted back only for GPX export
or geodesic calculations. GeoAdmin identify requests use `sr=2056`, so closure,
danger-zone, public-transport, and swissTLM3D geometries arrive directly in the
map projection. When swissTLM3D Z coordinates are returned, elevation remains
part of graph-node identity to avoid connecting vertically separated crossings.

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
Whenever the search field receives focus, `LocationSearch` notifies `App.tsx` to
close any public-transport, hiking-closure, or shooting-danger information
panel, clear its visual selection, and abort pending popup work. This also covers
a previously entered query whose cached suggestions reopen immediately on
focus, preventing the temporary list from being hidden by an older map-
information panel. Each search effect owns an `AbortController`, so changing the
query also cancels the older search request.

SearchServer labels may contain simple HTML emphasis tags. The API client parses
them as an HTML document, removes italic classification text, and returns only
plain text to React. The UI never injects returned HTML.

The component supports mouse, touch, and keyboard interaction:

- arrow keys change the active result;
- Enter selects it;
- Escape closes the panel;
- a pointer press outside closes the panel.

Selecting a result transforms its WGS 84 longitude and latitude to
`EPSG:2056`, updates a dedicated marker, and animates the view to native level
19 (20 metres per pixel).

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
raises the view to at least native level 21 (5 metres per pixel). Positions
outside the configured map extent are rejected.

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

The current route is an immutable `RouteState`. Its ordered `RouteStep` array
stores:

- the displayed waypoint;
- the exact section geometry created from the preceding waypoint;
- the section mode (`straight` or `network`).

A closed route additionally stores one optional `RouteClosure`: the exact final
section from the last waypoint back to the first and its routing mode. The
closure deliberately has no second waypoint marker, so the start remains a
single editable point.

`RouteHistory` stores stacks of complete prior and undone route states. Adding,
moving, inserting, or deleting a waypoint, reversing the route, and closing or
reopening the loop each create one snapshot-based edit. Undo and redo exchange
complete immutable states, so exact geometry is restored without recalculation
or another network request. A new edit clears the redo states. Complete deletion
intentionally clears all route history.

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

`src/map/route.ts` owns the OpenLayers representation. It concatenates normal
stored sections and the optional closing section into one red `LineString` with
a white casing, while creating exactly one red-outlined `Point` feature per
waypoint. Red is used deliberately so planned routes do not resemble blue
hydrographic features. Waypoint features carry their route index for hit
detection.

The same module creates one focused OpenLayers pointer interaction for existing
waypoints, normal route sections, and the optional closing section. A 12-pixel point tolerance keeps small waypoints
usable on touch screens, while a narrower line tolerance selects the closest
stored incoming section. When several stored sections overlap at the same
screen distance, the section latest in the current route order wins so repeated
out-and-back passages behave deterministically. Pressing either target stops map
panning. Moving an existing point draws an immediate preview with only its
adjacent sections replaced by straight lines. Pulling the route line inserts a
temporary point and splits the selected section into two straight previews. No
network request runs during either drag.

On release, `App.tsx` recalculates only the affected sections. A moved point
updates its incoming and outgoing sections; moving the first or last point of a
closed route also refreshes the closing section. An inserted point replaces one
normal or closing section with two sections that inherit the original routing
intent. Straight sections remain direct; network sections call the dynamic
router and independently fall back to a straight segment if coverage or
connectivity is missing. The insertion edit is committed only after a genuine
drag. A click on an existing waypoint removes it, while a click-only press on a
route section is restored and then handled by the normal map-click flow as a new
endpoint from the current route end. This allows an itinerary to reuse an
already drawn path without confusing that click with section reshaping.
Closed-route endpoint deletion rebuilds the loop around the remaining points. Intermediate deletion
reconnects the surrounding waypoints directly when both sections were straight;
otherwise it recalculates one network section and falls back to a straight
connector when no path is available. Hover-capable pointers receive a compact,
localized contextual label for both waypoint and route-section actions.

`src/components/RouteControls.tsx` renders the compact toolbar. Undo and redo
are enabled from snapshot history state. The snap button selects network or
straight creation; it becomes available after the first waypoint and is
temporarily disabled while cells are loading or a route is being calculated.
The loop button sits between reversal and deletion, uses the current snap mode
to create the final section, shows an active state while closed, and reopens the
route on a second press. Empty-map clicks do not append waypoints while a route
is closed; reopening it makes the last waypoint the editable endpoint again.
Disabled route actions use an opaque light-grey background so map details do not
bleed through the toolbar. The route toggle displays a small animated spinner
during asynchronous network work, including recalculation after a drag or loop
closure.

`src/metrics/routeMetrics.ts` calculates horizontal distance locally from the
flattened LV95 route geometry. For altitude-dependent figures, it sends the
native route coordinates directly in a bounded POST request to GeoAdmin's
elevation-profile service. The service applies a small moving-average offset
before the client accumulates positive and negative elevation changes. The same ordered
samples feed the slope-sensitive hiking-time polynomial published by Schweizer
Wanderwege in *Wanderzeitberechnung, Version 2020.2* (8 June 2020). Each
consecutive sample contributes time from its horizontal distance and local
grade; grades outside the model's published ±40 percent domain are clamped to
that boundary rather than extrapolating the 15th-degree curve.

`src/components/RouteStatistics.tsx` renders the floating bottom summary and
owns the show/hide state of the profile panel. It shows distance immediately,
uses an ellipsis while elevations are loading, and keeps distance visible with
dashes for the remaining values if the external profile request fails. Walking
time follows the Schweizer Wanderwege section-by-section polynomial and is
rounded to five minutes because it remains an estimate excluding breaks.

`src/components/RouteElevationProfile.tsx` draws the ordered elevation samples
as a lightweight responsive SVG above the summary bar. It scales cumulative
distance horizontally and elevation vertically, uses the route red for the
profile line, and performs no extra network request. The header keeps the real
minimum and maximum elevations, while the chart enforces a minimum 40-metre
vertical range with rounded axis bounds so small local variations are not
visually exaggerated. Larger profiles retain automatic scaling with a small
margin around their extrema. Pointer movement interpolates the profile distance
and altitude, draws a vertical chart guide, and publishes only cumulative
distance to the root application. A cumulative distance selected by hovering
the map route drives the same guide and header values while the profile is open.

Reversal uses `reverseRouteState()` to reverse waypoint order, normal sections,
and the optional closing geometry without issuing another routing request. Loop
closure and reopening are each recorded as one snapshot edit and can therefore
be undone exactly. Deletion clears the current route and all undo/redo states
while keeping route-creation mode active. GPX export is enabled after two
waypoints and first opens
`src/components/RouteExportDialog.tsx`. The chosen name is then passed to
`src/export/gpx.ts` for both GPX metadata and filename generation. The latest
smoothed elevation samples are passed only when they belong to the current
immutable route geometry. Export simplification is deliberately separate from
the editable route: each normal or closing section is simplified independently
with a 0.5-metre ground tolerance, so section endpoints and therefore every
user waypoint remain exact. Regular elevation samples closer than one metre to
an already retained geometry vertex are omitted because that vertex receives
the same interpolated elevation. This prevents centimetre-scale point pairs
without changing route history, map display, statistics, or routing.

Routine loading and graph-construction details are intentionally not shown to
the user. Temporary route messages are reserved for actionable problems such as
missing nearby segments, disconnected paths, excessive section length, and
request failures. Leaving route mode aborts the active operation without
discarding cells that completed successfully.

## 12. Read-only GPX import

`RouteImportControl` owns only the hidden file input and compact import button.
It returns the selected `File` to `App.tsx`; imported geometry never becomes
editable route history.

`src/import/gpx.ts` parses common GPX tracks and routes locally with
`DOMParser`. Each `trkseg` remains an independent line, coordinate values are
validated before transformation from WGS 84, and a complete `<ele>` series is
preserved for each segment. If any retained point in the itinerary lacks a
valid elevation, the imported geometry remains valid but the application falls
back to GeoAdmin for the complete profile. Waypoint-only GPX documents are
rejected because they do not define an itinerary. A size limit protects the
browser from accidental oversized files.

A successful import becomes the single current itinerary: active routing is
aborted, route-creation mode is left, editable route history is cleared, and the
new purple read-only geometry replaces any prior GPX. Invalid imports leave the
current itinerary untouched. Starting route creation later clears the imported
layer immediately, without confirmation.

`src/map/importedRoute.ts` owns the purple read-only vector layer. `App.tsx` fits
the view to its extent and feeds its projected segments into the shared metrics
pipeline. Distance is summed per segment. When every retained GPX point has a
valid `<ele>` value, the embedded altitude function is resampled at the same
roughly 20 metre spacing used for editable routes; this preserves the exported
profile while avoiding visible artefacts from irregularly spaced geometry
vertices. GPX files without a complete elevation series use the normal GeoAdmin
profile request instead. Elevation accumulation remains segment-local in both
paths so deliberate GPX gaps do not create fictional connectors. The resulting
cumulative samples feed the same collapsible profile and bottom statistics bar
used by editable routes.

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
│   └── ARCHITECTURE.md
├── src/
│   ├── assets/
│   │   └── public-transport-stops/
│   │       └── boat, bus, cable-car, chairlift, funicular, train, and tram SVG symbols
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
│   │   ├── projection.ts
│   │   ├── route.ts
│   │   ├── routeProfileMarker.ts
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

It creates the native LV95 view, WMTS/WMS and vector layers, replaces the
selected base-map source, and handles map, geolocation, fullscreen,
single-current-itinerary GPX loading, information-layer
visibility and feature inspection, route-creation mode, immutable route edit
snapshots, waypoint move and insertion recalculation, loop closing and reopening, dynamic graph loading, route
statistics, and temporary routing status. It
reacts to selected search results and cleans up imperative resources and pending
requests when React unmounts.

### `src/components/MapLayersSelector.tsx`

Renders one floating Layers button and a temporary menu with two sections. Base
maps are mutually exclusive, while information overlays are independently
switchable. The component does not know about OpenLayers; `App.tsx` owns the
actual layer sources and visibility. Outside pointer presses and Escape close
the menu. It owns independent switches for rendered hiking trails, hiking
closures, military danger zones, and public-transport stops without adding
another permanent map button. Hiking trails appear first because they are the
primary planning overlay and remain enabled by default.

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

Renders the compact structured stop panel. The official stop name occupies its
own header line, while the available transport modes appear below it as the same
SVG pictograms used on the map. Translated alternative text and tooltips preserve
mode identification without repeating labels inside long or already qualified
stop names. The component aborts superseded stationboard requests, groups the
next departures by Swiss local date, formats dates and times in the active locale,
and conditionally adds a separate aligned delay column only when at least one
visible service is delayed. Otherwise the departure times use the freed space. The
line-badge column follows the widest visible label within bounded minimum and maximum
widths, leaving more room for destinations when all labels are short and truncating
exceptional labels safely. Its popup width follows the longest useful timetable
content between compact desktop minimum and maximum bounds, without letting the
stop-name header or CFF action labels force expansion. Long stop names wrap inside
the timetable-driven width. In both layouts, the final numeric column keeps a small
right-side inset rather than sitting flush against the panel edge. The adaptive
desktop panel retains compact column spacing. It also keeps
localized links that prefill the stop as departure or destination on the
official SBB/CFF/FFS timetable.

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
creation, zoom-responsive symbol sizing, proportional selection highlighting,
and client-side SVG symbol styling.

### `src/assets/public-transport-stops/*.svg`

Defines the locally bundled transport-mode pictograms used by the filtered stop
overlay. The common 24-unit vector canvas, dark-blue `#2D327D` background, white
transport silhouettes, and explicit geometry keep the symbols recognizable and
sharp at every supported map zoom and browser pixel density.

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
- notification when the user starts editing a non-empty query;
- result selection.

It does not know about OpenLayers. It reports search activity and a typed result
through callbacks; `App.tsx` decides which map-information panels and selections
to clear.

### `src/components/RouteControls.tsx`

Renders the route-mode toggle and the contextual route action buttons. It is a
controlled component: `App.tsx` supplies availability state and callbacks for
snap, undo, redo, reversal, loop closure, deletion, and GPX export.

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
altitude guides, adaptive intermediate distance graduations, real minimum and
maximum altitude in the header, rounded display bounds, a minimum 40-metre
vertical range, and a route-coloured profile line.
Pointer exploration adds a chart guide, replaces the header range temporarily
with distance and altitude, and emits cumulative route distance without owning
map state. When the map supplies a hovered route distance, the mounted chart
uses the same guide and header presentation.

### `src/map/routeProfileMarker.ts`

Owns the transient position marker shared by route and profile exploration. It
precomputes geodesic cumulative distances for each displayed route segment,
interpolates profile distance to LV95 coordinates through a binary search, and
finds the closest cumulative distance for map pointer positions. Separate
imported GPX segments remain independent, and perfectly overlapping passages
resolve to the latest position in route order.

### `src/metrics/routeMetrics.ts`

Calculates geodesic distance from LV95 route geometry, sends native coordinates
to the official elevation-profile service, validates ordered distance/elevation
samples, accumulates ascent and descent, and applies the published Schweizer
Wanderwege 15th-degree hiking-time model to each sampled section. The same
samples feed the profile chart. Requests are
abortable so stale route histories cannot update the UI.

### `src/export/gpx.ts`

Simplifies every normal or closing route section independently with iterative
Ramer-Douglas-Peucker in a local metric plane, converts the retained LV95
geometry to WGS 84, builds a GPX 1.1 track, and starts a browser
download through a temporary object URL. Section endpoints are never removed,
which preserves waypoint order and loop closure. The name entered in the export
dialog is XML-escaped for metadata and the track node, sanitized for a portable
filename, and used for both outputs. The module merges in regularly spaced
profile distances, skips profile samples within one metre of a retained geometry
vertex, and interpolates smoothed terrain altitude into `<ele>` values. If no
valid profile is available, it exports the same simplified geometry without
elevations.

### `src/import/gpx.ts`

Validates file size policy, parses GPX XML, extracts named tracks and routes,
keeps disconnected track segments separate, rejects invalid coordinates, and
returns WGS 84 geometry with a complete elevation series when every retained
point supplies a valid `<ele>` value. It does not touch OpenLayers state.

### `src/map/importedRoute.ts`

Creates and updates the read-only GPX vector layer. Its purple casing style
distinguishes an imported current itinerary from the red editable route and
blue hydrography.

### `src/map/route.ts`

Defines immutable route steps, the optional dedicated loop-closing section, and
complete route state. It flattens normal and closing geometry, reverses complete
routes without recalculation, creates the route vector layer, and rebuilds its
line and indexed waypoint features. It also owns waypoint and normal/closing
section hit detection, deterministic newest-section selection for overlapping
geometry, the focused click/drag interaction, contextual hover target reporting,
cursor state, and straight preview rendering for moved or temporarily inserted
waypoints. It does not own immutable route history or
network recalculation.

### `src/routing/swissTlmApi.ts`

Fetches bounded road and hiking geometries from the GeoAdmin identify endpoint
directly in EPSG:2056. It owns request tiling, recursive subdivision at result
limits, response
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

### `src/map/projection.ts`

Registers EPSG:2056 through `proj4`, exposes the official LV95 WMTS extent,
resolutions, matrix availability, and matrix sizes, and provides the only WGS 84
to LV95 conversion helpers used at external data boundaries.

### `src/map/config.ts`

Centralizes provider identifiers, attribution, native LV95 view constraints,
zoom-level semantics, and explicit WMTS tile-grid/source factories.

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
- `LICENSE` contains the MIT license.

## 17. Runtime flow

1. The browser registers EPSG:2056 through `proj4`, then resolves a stored or
   browser language.
2. The language provider updates document metadata and exposes localized strings.
3. `App` creates the native LV95 OpenLayers view, tile layers, marker layers,
   editable route layer, and imported-route layer.
4. The default color base map begins loading from the native `2056` WMTS
   matrix set at `wmts.geo.admin.ch`.
5. The Layers menu changes the base-map source or toggles information overlays.
6. The rendered hiking overlay is enabled by default unless a stored preference
   hides it, and starts loading when the native view moves beyond level 18.
7. The official closure WMS is enabled by default unless a stored preference hides it, and appears only beyond the hiking-overlay zoom threshold.
8. The official military shooting-danger WMS is enabled by default unless a stored preference hides it, uses the same detailed-zoom threshold, and has a separate vector layer for the selected polygon.
9. The public-transport stop vector layer remains disabled by default unless a stored preference enables it. At detailed zoom levels, move-end events load and filter the visible passenger stops.
10. A map click inspects the loaded stop vectors first, then a visible hiking closure, and finally a visible military danger zone.
11. A stop opens a compact structured panel immediately and starts an abortable stationboard request; closure and danger-zone polygons fetch localized official popups through the shared sanitizer, while a selected danger zone is highlighted from its returned GeoJSON geometry and PDF links are removed from military notices.
12. Selecting a valid GPX converts its WGS 84 coordinates to LV95, leaves route
    creation, clears editable route history, replaces the previous imported
    itinerary, and fits the map to its geometry.
13. Independent GPX segments are measured separately, then combined for the
    shared distance, elevation, walking-time, and profile display. Complete
    embedded elevations are regularly resampled; otherwise GeoAdmin supplies
    the profile.
14. Starting editable route creation clears the imported GPX without prompting.
15. The route button toggles route-creation mode and the crosshair cursor.
16. Entering route mode attaches the route-click listener, one focused route
    drag interaction, and the contextual toolbar.
17. With snapping disabled, a map click stores a direct section immediately.
18. The first snapped click derives and loads a local 3 × 3 cell group while
    the route toggle shows a compact spinner.
19. Dense EPSG:2056 identify requests are subdivided when either layer reaches
    200 results.
20. Returned LV95 road vertices become graph nodes and edges; hiking geometry
    marks
    preferred edges through spatial matching.
21. The first clicked point is snapped to the nearest walkable segment.
22. Later clicks derive a corridor of cells between waypoints, load only missing
    cells, and run A* on the resulting graph.
23. A disconnected or empty corridor is retried once with a wider cell radius.
24. If no routable path remains, the current click becomes a free point or a
    straight fallback section while snap mode stays enabled.
25. Pressing an existing waypoint starts a potential move or deletion sequence
    and prevents map panning; a click deletes it, while a drag moves it.
26. Pressing the route line outside a waypoint selects the closest stored normal
    or closing section and starts a potential insertion sequence. Exact overlap
    ties select the section latest in the current route order.
27. Pointer movement draws straight previews only: adjacent sections for a moved
    point, or two halves around a temporary inserted point. No routing request is
    made during the drag. Releasing a route section without a genuine drag
    restores the committed display and lets the delayed map click append a new
    endpoint from the current route end.
28. Releasing a moved point recalculates its affected normal sections and, for
    the first or last point of a closed route, the closing section.
29. Releasing a dragged normal or closing section after a genuine movement
    replaces that section with two sections through the new waypoint; each half
    inherits and independently resolves the original straight or network routing intent.
30. The loop button creates one dedicated section from the final waypoint back
    to the first using the current snap mode, or removes that section to reopen
    the route. No duplicate start waypoint is created.
31. While the loop is closed, empty-map clicks do not append another waypoint;
    the closing section remains draggable and the first and last waypoints remain editable.
32. Every addition, waypoint move, waypoint insertion, waypoint deletion,
    reversal, loop closure, or reopening records the previous complete immutable
    route state and clears obsolete redo states.
33. Updating the committed route state rebuilds the route line and indexed
    waypoint features.
34. Distance is recalculated locally from the flattened route geometry, including
    the optional closing section.
35. After a short debounce, an abortable profile request refreshes ascent,
    descent, estimated walking time, and the reusable chart samples.
36. The profile button reveals or hides the SVG chart without another request.
37. Moving a pointer across the displayed itinerary finds the nearest indexed
    position and shows a transient circle on the map. When the profile is open,
    the same cumulative distance updates its guide, altitude, and distance.
38. Moving a pointer across the chart performs the inverse lookup and updates
    the same transient marker above the corresponding map position.
39. Undo and redo exchange complete stored route states without routing again.
40. Reversal rebuilds normal and closing geometry in the opposite direction as
    one undoable edit.
41. Deletion clears the current route and all undo/redo states and hides the summary.
42. GPX export opens a modal naming form before any XML is generated.
43. Confirming the form converts the flattened LV95 route to WGS 84, merges exact
    route vertices with regular elevation samples, and downloads a GPX track
    whose internal name and proposed filename come from the same user value.
44. Changing language updates interface text, number formatting, document
    metadata, and subsequent GeoAdmin requests without recreating the map.
45. Leaving route mode removes the route-click listener and drag interaction,
    aborts active network work, and restores any uncommitted drag preview while
    keeping completed cells, committed route geometry, and statistics available.
46. The fullscreen button requests fullscreen for the root application element.
47. A `fullscreenchange` event synchronizes UI state and resizes OpenLayers.
48. Focusing the location-search field closes any stop, hiking-closure, or
    shooting-danger popup, clears its selection, and aborts obsolete popup work
    before existing or newly requested suggestions appear. Location search and
    browser geolocation otherwise continue to operate independently.
49. On unmount, map listeners, interactions, timers, requests, references, and
    the map target are cleaned up by their owning components.
50. A push to `main` triggers the Pages workflow, which builds and deploys
    `dist`.

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
section. The same rule applies independently to sections recalculated around a
moved waypoint or created on either side of an inserted waypoint. Snap mode
remains enabled for the next click.

Overly large single sections, GeoAdmin transport or parsing failures, and
result-limit overflow remain errors; they do not modify the existing route. A
failed waypoint move or insertion discards the temporary preview and restores
the last committed route state. An active operation is aborted when route mode is
left or the application unmounts. There is no persistent logging or general
retry mechanism yet.

Information-layer loading, identify, and popup failures do not affect map
navigation or route state. Closure and military danger-zone panels report a
localized error, and turning an active layer off aborts its pending feature
work. A failed stop refresh keeps the map usable and does not expose unfiltered
operating points.

Elevation-profile failures are non-blocking. The distance remains visible,
altitude-dependent values become dashes, and route editing continues normally.
Superseded profile requests are aborted after route mutations.

Invalid, empty, or oversized GPX files leave the current itinerary untouched and
produce a translated temporary error. Parsing remains local. After a successful
import, complete embedded GPX elevations supply the shared statistics and chart
without another elevation request; missing or incomplete elevations fall back
to the normal GeoAdmin profile service.

## 19. Code conventions

- Keep strict TypeScript enabled.
- Centralize provider and geographic constants.
- Keep internal map, overlay, editable-route, and routing geometry in EPSG:2056;
  transform only at WGS 84 exchange boundaries.
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
- Store complete immutable route states so undo and redo never recalculate geometry.
- Defer network work during route dragging until release and recalculate only affected sections.
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

## 20. Possible evolution

The main product scope is implemented. Further work should be driven by observed
usage or validation results rather than by a fixed feature roadmap. Possible
follow-ups include focused automated regression tests, conservative timetable
refresh, and a preprocessed routing graph or
backend only if measured browser-routing limits justify that complexity.

## 21. When to evolve the architecture

Create a new abstraction when several components reuse the same map logic,
OpenLayers interactions become numerous, shared state outgrows `App`, additional
network APIs appear, or unit tests require isolated pure functions.
