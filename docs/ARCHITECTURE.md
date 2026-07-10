# Swiss Trail Planner Architecture

> Documented state: raster map, hiking overlay, search, geolocation, and fullscreen controls.

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
- pan and zoom with custom floating controls;
- restrict navigation to Switzerland and a small border area;
- display a metric scale and swisstopo attribution;
- report map, search, and geolocation failures.

It does not yet include:

- continuous user tracking or route recording;
- raw swissTLM3D vector geometries;
- feature inspection or attribute queries;
- route drawing;
- routing;
- distance or elevation calculations;
- GPX export;
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
4. raw swissTLM3D vector display and inspection;
5. manual route drawing and GPX export;
6. routable graph preparation;
7. hiking routing.

Each milestone should remain testable and usable before the next one begins.

### 3.3 Avoid premature abstraction

Provider and geographic configuration live in `src/map/config.ts`. Marker
creation is isolated in small map modules, and the location-search UI and API
client are separated from `App.tsx`.

OpenLayers map ownership remains in `App.tsx` because there is still only one
map view. More extensive drawing and routing interactions may later justify a
dedicated hook or map-controller module.

### 3.4 Comments explain decisions

Comments should not restate obvious code. They should document architecture
decisions, external constraints, non-obvious behavior, lifecycle precautions,
and geographic values chosen by the project.

## 4. Technical overview

```text
Browser
   │
   ├── React 19 + TypeScript
   │      │
   │      ├── LocationSearch component
   │      │      └── geo.admin.ch SearchServer
   │      ├── floating zoom, geolocation, and fullscreen controls
   │      ├── browser Geolocation API
   │      └── browser Fullscreen API
   │
   ├── App.tsx
   │      │ creates and destroys
   │      ▼
   ├── OpenLayers Map / View
   │      │
   │      ├── TileLayer: national map (JPEG)
   │      ├── TileLayer: hiking trails (transparent PNG)
   │      ├── VectorLayer: selected search result
   │      └── VectorLayer: user location
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
frontend assets during development.

## 5. Technologies

| Technology | Role |
|---|---|
| React 19 | UI components, search state, and status messages |
| TypeScript 5 | Static typing and compile-time verification |
| OpenLayers 10 | Map, view, layers, projections, markers, and controls |
| Vite 8 | Development server, production build, and Pages base path |
| geo.admin.ch SearchServer | Official location search |
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
trail geometries or attributes. Raw vector data will still be required for
selection, snapping, and routing.

## 7. Coordinate reference systems

The OpenLayers view and tile layers use Web Mercator (`EPSG:3857`).

Human-readable centers and bounds, browser geolocation, and SearchServer
results use WGS 84 longitude/latitude (`EPSG:4326`). OpenLayers transforms those
coordinates with `fromLonLat()` before displaying them.

Raw swissTLM3D data is distributed in LV95 (`EPSG:2056`) and will require
explicit conversion when introduced.

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


## 11. GitHub Pages deployment

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

## 12. Geographic constraint

The application uses a rectangular extent covering Switzerland with a small
border margin. It keeps nearby cross-border access visible while preventing
navigation to distant empty areas.

The constraint applies to the full viewport, not only its center, and the
smooth boundary effect is disabled.

## 13. Repository structure

```text
swiss-trail-planner/
├── .github/
│   └── workflows/
│       └── deploy.yml
├── docs/
│   └── ARCHITECTURE.md
├── src/
│   ├── components/
│   │   └── LocationSearch.tsx
│   ├── map/
│   │   ├── config.ts
│   │   ├── searchResult.ts
│   │   └── userLocation.ts
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

## 14. File responsibilities

### `src/App.tsx`

Owns the OpenLayers map instance and coordinates map-level behavior.

It creates the tile layers and marker layers, handles map, geolocation, and
fullscreen state, reacts to a selected search result, and cleans up imperative
resources when React unmounts the component.

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
- `LICENSE` contains the MIT license.

## 15. Runtime flow

1. The browser loads the React application.
2. `App` creates the OpenLayers map, tile layers, and vector markers.
3. The base map begins loading from `wmts.geo.admin.ch`.
4. The hiking overlay starts loading when zoom moves beyond level 12.
5. The fullscreen button requests fullscreen for the root application element.
6. A `fullscreenchange` event synchronizes UI state and resizes OpenLayers.
7. Typing two characters schedules a SearchServer request after 300 ms.
8. A changed query aborts the previous request.
9. Selecting a result updates the red search marker and recenters the map.
10. Clicking geolocation requests permission and updates the blue user marker.
11. Pressing `Escape` exits fullscreen through the browser.
12. On unmount, listeners, timers, requests, references, and the map target are
    cleaned up by their owning components.
13. A push to `main` triggers the Pages workflow.
14. GitHub Actions runs `npm ci`, builds `dist/`, and deploys the artifact.

## 16. Error handling

Initial base-map failure is blocking because the application cannot function
without a map. Isolated later tile failures do not hide an already usable map.

Hiking-overlay failure remains non-blocking.

Search failures display a temporary result-panel message and allow immediate
retry through another query. Aborted searches are ignored.

Geolocation failures display a temporary message beside the controls and can be
retried by clicking the button again.

There is no persistent logging or automatic retry mechanism yet.

## 17. Code conventions

- Keep strict TypeScript enabled.
- Centralize provider and geographic constants.
- Keep network contracts outside React components.
- Never inject SearchServer label HTML into the DOM.
- Abort superseded network requests.
- Preserve explicit layer ordering.
- Request privacy-sensitive capabilities only after explicit user input.
- Keep fullscreen state synchronized through `fullscreenchange` rather than
  assuming a button click always succeeds.
- Recalculate the OpenLayers size after viewport mode changes.
- Remove listeners and clear timers during cleanup.
- Comments should explain why, not restate obvious code.
- `npm run build` must succeed before an important commit.
- Production asset paths must remain compatible with the configured Pages base.

## 18. Planned evolution

### Phase 2B — Display raw swissTLM3D vectors

Load a limited vector sample and validate reprojection, alignment, attributes,
selection, styling, and rendering performance.

Loading all of Switzerland as one GeoJSON file is not viable. Production-scale
display will probably require preprocessing or vector tiles.

### Phase 3 — Route editing

Add waypoints, an editable line, point deletion and movement, distance
calculation, and GPX export.

### Phase 4 — Routing

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

The final backend and graph engine have not been selected yet.

## 19. When to evolve the architecture

Create a new abstraction when several components reuse the same map logic,
OpenLayers interactions become numerous, shared state outgrows `App`, additional
network APIs appear, or unit tests require isolated pure functions.
