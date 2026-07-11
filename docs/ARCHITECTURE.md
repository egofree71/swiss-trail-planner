# Swiss Trail Planner Architecture

> Documented state: raster map, hiking overlay, search, geolocation,
> fullscreen, manual route creation, GPX export, and experimental on-demand
> swissTLM3D routing around user-selected positions.

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

- display the swisstopo color raster map;
- display the official swissTLM3D hiking-trail portrayal at detailed zoom levels;
- search official Swiss location indexes;
- display a selected search result as a vector marker;
- request and display the user's current position;
- enter and leave browser fullscreen mode;
- enter a visual route-creation mode with a crosshair map cursor;
- add ordered route waypoints by clicking or tapping the map;
- create straight segments when snapping is disabled;
- load swissTLM3D road and hiking geometries dynamically around selected waypoints;
- build a regional walkable graph and calculate snapped sections with A*;
- prefer official hiking-trail sections through routing costs;
- undo and redo exact straight or routed route steps;
- reverse the complete route without recalculating sections;
- clear the complete route;
- export the displayed route geometry as a GPX 1.1 track;
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
- waypoint movement, insertion, or individual deletion;
- distance or elevation calculations;
- elevation values in GPX export;
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
3. basic map controls, geolocation, and location search;
4. route-creation interface shell;
5. straight-line route creation with undo and redo;
6. dynamic cell-based swissTLM3D routing around selected waypoints;
7. route reversal, deletion, and GPX export;
8. waypoint editing, distance, and elevation;
9. repeatable routing-data preparation;
10. reliable national hiking routing.

Each milestone should remain testable and usable before the next one begins.

### 3.3 Avoid premature abstraction

Provider and geographic configuration live in `src/map/config.ts`. Marker
creation is isolated in small map modules, while location search and route
controls are separate presentational components. The current route display is
kept in `src/map/route.ts` rather than adding a broader map-controller
abstraction before drag and selection interactions require one.

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
   │      ├── RouteControls component
   │      ├── route history and temporary routing status
   │      ├── browser Geolocation API
   │      └── browser Fullscreen API
   │
   ├── App.tsx
   │      ├── owns OpenLayers lifecycle and route-editing state
   │      └── requests dynamic routing cells for snapped clicks
   │
   ├── OpenLayers Map / View
   │      ├── TileLayer: national map (JPEG)
   │      ├── TileLayer: hiking trails (transparent PNG)
   │      ├── VectorLayer: route geometry and waypoints
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
          ├── wmts.geo.admin.ch
          └── api3.geo.admin.ch

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
| React 19 | UI components, search state, and status messages |
| TypeScript 5 | Static typing and compile-time verification |
| OpenLayers 10 | Map, view, layers, projections, markers, and controls |
| Vite 8 | Development server, production build, and Pages base path |
| geo.admin.ch SearchServer | Official location search |
| GeoAdmin identify API | On-demand prototype access to swissTLM3D line geometries |
| Custom graph builder and A* | Experimental browser routing for dynamically loaded regions |
| Browser Geolocation API | On-demand user position lookup |
| Browser Fullscreen API | Distraction-free map display |
| HTML/CSS | Full-screen layout, floating controls, and result panel |
| GitHub Actions | Automated GitHub Pages deployment |
| GitHub Pages | Static production hosting over HTTPS |
| npm | Dependency installation and lockfile management |

## 6. Map services

The national map and hiking overlay use direct XYZ-compatible WMTS URLs in
`EPSG:3857`.

The national map uses JPEG tiles. The hiking overlay uses transparent PNG tiles
and has `minZoom` set to 12. Because OpenLayers treats this boundary as
exclusive, the overlay normally appears at integer zoom level 13.

The hiking overlay is already rendered and therefore cannot expose individual
trail geometries or attributes.

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

## 9. Browser geolocation

The location control uses `navigator.geolocation.getCurrentPosition()` only
after an explicit user action.

The browser may display a permission prompt. The application does not request
the position during startup and does not use continuous tracking.

A successful position updates a dedicated vector marker, recenters the map, and
raises the view to at least zoom level 15. Positions outside the configured map
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

Reversal uses `reverseRouteSteps()` to reverse both waypoint order and every
stored section geometry without issuing another routing request. The redo stack
is cleared because its entries belong to the previous direction. Deletion clears
the applied and redo histories while keeping route-creation mode active. GPX
export is enabled after two waypoints and delegates XML generation and browser
download to `src/export/gpx.ts`.

Routine loading and graph-construction details are intentionally not shown to
the user. Temporary route messages are reserved for actionable problems such as
missing nearby segments, disconnected paths, excessive section length, and
request failures. Leaving route mode aborts the active operation without
discarding cells that completed successfully.

## 12. GitHub Pages deployment

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

## 13. Geographic constraint

The application uses a rectangular extent covering Switzerland with a small
border margin. It keeps nearby cross-border access visible while preventing
navigation to distant empty areas.

The constraint applies to the full viewport, not only its center, and the
smooth boundary effect is disabled.

Routing no longer has a fixed geographic extent. Each snapped operation derives
a bounded cell set from the selected positions. A maximum cell count prevents a
single very long section from starting an excessive request burst; the user can
add intermediate waypoints instead. Straight route creation remains available
without this constraint.

## 14. Repository structure

```text
swiss-trail-planner/
├── .github/
│   └── workflows/
│       └── deploy.yml
├── docs/
│   └── ARCHITECTURE.md
├── src/
│   ├── components/
│   │   ├── LocationSearch.tsx
│   │   └── RouteControls.tsx
│   ├── export/
│   │   └── gpx.ts
│   ├── map/
│   │   ├── config.ts
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
├── ROADMAP.md
├── tsconfig.json
└── vite.config.ts
```

## 15. File responsibilities

### `src/App.tsx`

Owns the OpenLayers map instance and coordinates map-level behavior.

It creates the tile and vector layers, handles map, geolocation, fullscreen,
route-creation mode, immutable route history, dynamic graph loading, and
temporary routing status. It reacts to selected search results and cleans up
imperative resources and pending requests when React unmounts.

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

### `src/export/gpx.ts`

Converts the complete displayed route geometry from Web Mercator to WGS 84,
builds a GPX 1.1 track, and starts a browser download through a temporary object
URL. It exports routed intermediate vertices rather than only user waypoints so
external applications preserve the exact path.

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
origin labels, duplicate removal, and result limits.

### `src/map/searchResult.ts`

Creates and updates the vector marker for the selected search result.

### `src/map/userLocation.ts`

Creates and updates the separate vector marker for browser geolocation.

### `src/map/config.ts`

Centralizes provider identifiers, attribution, map extent, zoom settings, and
tile-source factories.

### `src/styles.css`

Defines the full-screen layout, left-side search control, right-side map
controls, result panel, status messages, and OpenLayers control placement.

### Remaining root files

- `src/main.tsx` mounts React and imports styles.
- `index.html` is the browser entry point.
- `package.json` declares dependencies and npm scripts.
- `package-lock.json` locks dependency versions.
- `vite.config.ts` configures React and the GitHub Pages base path.
- `.github/workflows/deploy.yml` builds and deploys `dist/` to GitHub Pages.
- `tsconfig.json` enables strict TypeScript.
- `.editorconfig` and `.gitignore` define repository conventions.
- `README.md` is the quick-start guide.
- `ROADMAP.md` tracks milestones, priorities, and open technical decisions.
- `LICENSE` contains the MIT license.

## 16. Runtime flow

1. The browser loads the React application.
2. `App` creates the OpenLayers map, tile layers, marker layers, and route layer.
3. The base map begins loading from `wmts.geo.admin.ch`.
4. The rendered hiking overlay starts loading when zoom moves beyond level 12.
5. The route button toggles route-creation mode and the crosshair cursor.
6. Entering route mode attaches a map `singleclick` listener and reveals the
   route toolbar.
7. With snapping disabled, a click stores a direct section immediately.
8. The first snapped click derives and loads a local 3 × 3 cell group while
   the route toggle shows a compact spinner.
9. Dense identify requests are subdivided when either layer reaches 200 results.
10. Returned road vertices become graph nodes and edges; hiking geometry marks
    preferred edges through spatial matching.
11. The first clicked point is snapped to the nearest walkable segment.
12. Later clicks derive a corridor of cells between waypoints, load only missing
    cells, and run A* on the resulting graph.
13. A disconnected corridor is retried once with a wider cell radius.
14. Updating route history rebuilds the route line and waypoint features.
15. Undo moves the last complete step to redo; redo restores it without routing.
16. Reversal rebuilds immutable steps in the opposite order and clears redo.
17. Deletion clears both applied and redo histories.
18. GPX export converts the flattened route to WGS 84 and downloads a GPX track.
19. Leaving route mode removes the click listener and aborts active network work
    while keeping completed cells and the route available.
20. The fullscreen button requests fullscreen for the root application element.
21. A `fullscreenchange` event synchronizes UI state and resizes OpenLayers.
22. Location search and browser geolocation continue to operate independently.
23. On unmount, map listeners, timers, requests, references, and the map target
    are cleaned up by their owning components.
24. A push to `main` triggers the Pages workflow, which builds and deploys
    `dist/`.

## 17. Error handling

Initial base-map failure is blocking because the application cannot function
without a map. Isolated later tile failures do not hide an already usable map.

Hiking-overlay failure remains non-blocking.

Search failures display a temporary result-panel message and allow immediate
retry through another query. Aborted searches are ignored.

Geolocation failures display a temporary message beside the controls and can be
retried by clicking the button again.

Routing reports points without a nearby walkable segment, disconnected graph
requests, overly large single sections, GeoAdmin failures, and result-limit
overflow with temporary French messages. The existing route is unchanged after
any failure. An active operation is aborted when route mode is left or the
application unmounts. Disconnected sections receive one automatic wider-corridor
retry; there is no persistent logging or general retry mechanism yet.

## 18. Code conventions

- Keep strict TypeScript enabled.
- Centralize provider and geographic constants.
- Keep network contracts outside React components.
- Never inject SearchServer label HTML into the DOM.
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

## 19. Planned evolution

### Phase 2B — Validate dynamic swissTLM3D routing

Test known routes in several contrasting Swiss regions, compare generated
geometry with the official map, measure request and graph performance, and
inspect failures for missing endpoints, false connections, bridges, tunnels,
or incomplete attributes.

The identify-based cell loader now removes the fixed test region and provides
useful evidence about whether browser-only on-demand routing is sufficient. A
preprocessed graph or backend should be selected only if measured limits justify
it.

### Phase 3 — Route editing

Straight and dynamically routed waypoint creation, undo/redo, route reversal,
route clearing, and GPX track export are implemented. The next steps are
waypoint movement and insertion, distance calculation, and elevation handling.

### Phase 4 — Production routing

Introduce a separate data-preparation pipeline:

```text
swissTLM3D
   │
   ▼
cleanup and topology
   │
   ▼
routable graph
   │
   ▼
local engine or API
   │
   ▼
GeoJSON / GPX route
```

The dynamic browser prototype demonstrates that a custom graph and A* can be
used with swissTLM3D. The final preprocessing pipeline, national graph delivery,
and possible backend have not been selected yet.

## 20. When to evolve the architecture

Create a new abstraction when several components reuse the same map logic,
OpenLayers interactions become numerous, shared state outgrows `App`, additional
network APIs appear, or unit tests require isolated pure functions.
