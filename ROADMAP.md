# Swiss Trail Planner Roadmap

This roadmap describes the planned evolution of Swiss Trail Planner.

It complements `README.md` and `docs/ARCHITECTURE.md`:

- `README.md` provides a concise project overview and setup instructions.
- `docs/ARCHITECTURE.md` documents the current implementation.
- `ROADMAP.md` describes completed milestones and future work.

The roadmap should be updated when priorities or major technical decisions
change.

## Product direction

Swiss Trail Planner is an open-source web application for planning hiking
routes in Switzerland using official swisstopo maps and geodata.

The application should remain lightweight and map-centered:

- one active route at a time;
- no route library in the initial product scope;
- no permanent toolbar covering a large part of the map;
- compact floating controls and collapsible panels;
- direct GPX export;
- routing based primarily on swissTLM3D data.

## Completed milestones

### Milestone 1 — Raster map foundation

- [x] Create the React, TypeScript, Vite, and OpenLayers application.
- [x] Display the official swisstopo national raster map.
- [x] Use a full-screen map layout.
- [x] Restrict navigation to Switzerland and a small border margin.
- [x] Add a metric scale and swisstopo attribution.
- [x] Handle initial tile-loading failures.
- [x] Add project documentation.
- [x] Deploy the application to GitHub Pages.

### Milestone 2 — Hiking overlay and map navigation

- [x] Display the official swissTLM3D hiking-trail overlay.
- [x] Switch between color, grey, and SWISSIMAGE aerial backgrounds.
- [x] Show the overlay only at detailed zoom levels.
- [x] Add large custom zoom controls.
- [x] Add one-click browser geolocation.
- [x] Display the user's current position as a map marker.
- [x] Add fullscreen mode with Escape-to-exit behavior.
- [x] Add location search using the official geo.admin.ch SearchServer.
- [x] Search communes, localities, postal codes, and geographic names.
- [x] Display the selected search result as a map marker.
- [x] Support French, German, Italian, and English interface languages.
- [x] Detect the browser language and persist an explicit language choice.
- [x] Display the official hiking-trail closures and detours WMS overlay.
- [x] Add a unified Layers menu for base maps and optional information overlays.
- [x] Show closures by default and remember the user's visibility choice.
- [x] Add localized click information for visible closures.
- [x] Add optional official public-transport stops to the Layers menu.
- [x] Filter passenger-relevant stops, preserve mode-specific symbols, and show compact localized stop details.
- [x] Load and display the next public-transport departures on demand.

## Current focus

Route editing and the browser routing prototype have advanced before the visible
raw-vector inspection tools. Milestone 3 remains relevant because inspecting
source geometries and attributes will help diagnose topology and route-choice
problems.

The route editor now creates ordered waypoints with immutable segment geometry,
and undo and redo are functional. Browser-only routing loads swissTLM3D cells
around the positions selected by the user, snaps waypoints to walkable segments,
and calculates paths with A*. Straight segments remain available when snapping
is disabled, and individual sections fall back to straight geometry when no
routable swissTLM3D path is available.

The loader caches completed cells and expands along each new route section. It
is still an experimental regional strategy intended to reveal topology,
attribute, API-volume, and route-quality problems before a national data
pipeline or backend is selected.

The public-transport stop layer is geographic and informational only. It
filters out operating-only and explicitly out-of-service points, groups nearby
multimodal records, highlights the selected stop, and shows its official name
with all detected transport modes. The compact panel loads the next departures
from `transport.opendata.ch`, while links can still hand the stop to the official
SBB/CFF/FFS timetable as a departure or destination. Automatic background
refresh remains deliberately deferred.

## Planned milestones

### Milestone 3 — Raw swissTLM3D vector prototype

Goal: display and inspect real vector geometries rather than rendered map tiles.

Tasks:

- [x] Identify `TLM_STRASSE` / the swissTLM3D roads-and-paths layer as the
      initial routing source.
- [x] Start with a small Vandoeuvres test area instead of loading the whole
      country.
- [x] Replace the fixed test area with dynamic cell loading around selected
      points.
- [x] Request prototype geometries directly in the map projection (`EPSG:3857`).
- [ ] Display the vector sample above the raster map.
- [ ] Validate geometric alignment with the official map.
- [ ] Inspect useful trail and road attributes.
- [ ] Distinguish hiking, mountain-hiking, and alpine-hiking segments.
- [ ] Add temporary feature inspection for development.
- [ ] Measure rendering and loading performance.
- [ ] Decide whether production display should use preprocessing,
      vector tiles, or another delivery format.

Acceptance criteria:

- a small swissTLM3D sample is displayed correctly;
- features align with the swisstopo raster map;
- important attributes can be inspected;
- the prototype does not require loading the full national dataset.

### Milestone 4 — Manual route editing

Goal: create and edit one route directly on the map without automatic routing.

Tasks:

- [x] Add a route-creation interface mode with active cursor feedback.
- [x] Show contextual undo, redo, snap, reverse, delete, and export controls
      in that mode.
- [x] Add waypoints by clicking or tapping the map.
- [x] Draw straight or swissTLM3D-routed geometry between waypoints.
- [ ] Move existing waypoints.
- [ ] Delete waypoints.
- [ ] Insert a waypoint into an existing segment.
- [x] Clear the current route.
- [x] Reverse the complete route without recalculating sections.
- [x] Add undo and redo support for waypoint creation.
- [x] Show route distance.
- [ ] Keep controls compact and collapsible.

Acceptance criteria:

- one route can be created, edited, and cleared;
- route editing works with both mouse and touch input;
- the map remains the main visible element;
- no backend is required.

#### Current dynamic routing prototype

- [x] Load bounded swissTLM3D road and path geometries through GeoAdmin.
- [x] Derive local and corridor cells from user-selected positions.
- [x] Cache completed cells in browser memory and avoid duplicate requests.
- [x] Retry disconnected sections once with a wider corridor.
- [x] Limit a single operation to a safe maximum number of cells.
- [x] Load the official hiking-trail geometry for preference matching.
- [x] Build a walkable graph in the browser.
- [x] Preserve elevation in graph-node identity when the API returns Z values.
- [x] Snap clicked waypoints to nearby network segments.
- [x] Calculate multi-waypoint route sections with A*.
- [x] Keep straight-line creation available when snapping is disabled.
- [x] Fall back to free points or straight sections when swissTLM3D coverage or
      connectivity is unavailable, while keeping snap mode enabled.
- [x] Store routed section geometry so undo and redo require no new API call.
- [x] Validate the initial Vandoeuvres prototype against the official map.
- [ ] Validate known routes in several contrasting Swiss regions.
- [ ] Investigate missing connections, false intersections, and route choices.
- [ ] Measure load time, request count, graph size, and routing latency locally.
- [ ] Decide from measured results whether a preprocessed graph or backend is needed.

### Milestone 5 — GPX export and elevation

Goal: turn the manually edited route into a useful hiking file.

Tasks:

- [x] Define the internal route data model.
- [x] Export the current route as a GPX 1.1 track.
- [x] Ask for a route name and use it in GPX metadata and the filename.
- [x] Include the complete route geometry in the correct order.
- [x] Embed smoothed elevation samples in GPX track points when available.
- [x] Retrieve a smoothed elevation profile for the route.
- [x] Calculate total ascent and descent.
- [x] Display route distance, elevation summary, and estimated walking time.
- [x] Add a compact, collapsible elevation profile.
- [x] Handle missing or incomplete elevation data without blocking editing.
- [x] Load one external GPX itinerary as a read-only reference layer.
- [x] Fit the map to the imported GPX without replacing the editable route.

Acceptance criteria:

- exported GPX files open correctly in common hiking applications;
- elevation-aware GPX files retain the displayed route and a usable altitude profile;
- route distance is accurate enough for planning;
- total ascent and descent are displayed;
- the route can still be edited after calculations.

### Milestone 6 — Routing-data preparation

Goal: transform swissTLM3D road and trail data into a routable graph.

Tasks:

- [ ] Select the swissTLM3D network layers and attributes to use.
- [ ] Define walkable and non-walkable segment rules.
- [ ] Handle roads, paths, stairs, bridges, tunnels, and crossings.
- [ ] Preserve hiking categories and access restrictions.
- [ ] Detect and repair relevant topology gaps.
- [ ] Avoid false intersections at bridges and tunnels.
- [ ] Build graph nodes and edges.
- [ ] Define routing costs and penalties.
- [ ] Create repeatable preprocessing scripts.
- [ ] Document data versions and processing steps.
- [ ] Decide how prepared graph data will be distributed.

Acceptance criteria:

- the preprocessing pipeline can be rerun from documented source data;
- a connected graph is produced for a limited test region;
- topology errors can be inspected and corrected;
- hiking metadata remains available in the graph.

### Milestone 7 — Automatic hiking routing

Goal: calculate a route between waypoints using the prepared swissTLM3D graph.

Tasks:

- [ ] Snap waypoints to suitable nearby network segments.
- [ ] Implement or integrate A* or Dijkstra routing.
- [ ] Route through multiple waypoints.
- [ ] Recalculate affected sections after waypoint edits.
- [ ] Prefer official hiking trails where appropriate.
- [ ] Penalize undesirable roads.
- [ ] Exclude motorways and pedestrian-prohibited segments.
- [ ] Handle disconnected route requests clearly.
- [ ] Return route geometry and metadata to the frontend.
- [ ] Integrate routed geometry with GPX export.

Initial routing profile:

- standard hiking routes preferred;
- ordinary paths allowed;
- minor roads allowed with a penalty;
- major roads strongly penalized;
- motorways excluded;
- alpine hiking routes excluded by default;
- via ferrata excluded by default.

Acceptance criteria:

- routes can be calculated between two or more waypoints;
- editing a waypoint updates the route;
- failures are explained clearly;
- exported GPX follows the routed geometry.

### Milestone 8 — Optional routing profiles

Goal: support different hiking difficulty levels without overcomplicating the
interface.

Possible profiles:

- [ ] Hiking
- [ ] Mountain hiking
- [ ] Alpine hiking

Possible controls:

- [ ] allow or avoid alpine trails;
- [ ] prefer official hiking routes;
- [ ] avoid paved roads;
- [ ] limit steepness where data permits.

This milestone should start only after the standard hiking profile is reliable.

## Technical decisions still open

The following decisions should remain open until prototypes provide enough
evidence:

- frontend-only routing versus a dedicated backend;
- custom routing engine versus an existing graph engine;
- PostGIS and pgRouting versus another storage and routing stack;
- vector tiles versus another swissTLM3D delivery method;
- client-side versus server-side elevation processing;
- distribution and update strategy for prepared national data.

Avoid choosing these components before the relevant milestone requires them.

## Quality and maintenance

For every milestone:

- [ ] use the latest repository ZIP supplied by the user as the source of truth;
- [ ] keep code comments and technical documentation in English;
- [ ] keep UI text in French unless localization is introduced;
- [ ] update `README.md` when user-facing functionality changes;
- [ ] update `docs/ARCHITECTURE.md` when architecture changes;
- [ ] update this roadmap when milestones or priorities change;
- [ ] run `npm run build`;
- [ ] test locally before proposing a commit;
- [ ] include only new or modified files in generated ZIP archives;
- [ ] avoid premature abstractions.

## Out of scope for the initial product

The following features are not priorities for the first complete version:

- user accounts;
- cloud route storage;
- social sharing;
- route libraries;
- comments or ratings;
- multi-user collaboration;
- native mobile applications;
- navigation guidance while walking;
- support for countries outside Switzerland.

These features can be reconsidered after route creation, routing, elevation,
and GPX export are reliable.
