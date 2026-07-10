# Swiss Trail Planner Architecture

> Documented state: raster base map with official hiking-trail overlay.

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
- pan and zoom;
- restrict navigation to Switzerland and a small border area;
- display a metric scale;
- display the swisstopo attribution;
- report an initial base-map tile-loading failure.

It does not yet include:

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

No permanent toolbar occupies the top of the window. Future tools should use
compact buttons, floating panels, or collapsible controls so the map retains as
much space as possible.

### 3.2 Incremental delivery

The project evolves through independent functional layers:

1. raster background;
2. rendered hiking-trail overlay;
3. raw swissTLM3D vector display and inspection;
4. manual route drawing and GPX export;
5. routable graph preparation;
6. hiking routing.

Each milestone should remain testable and usable before the next one begins.

### 3.3 Avoid premature abstraction

The current architecture remains intentionally small. Provider and geographic
configuration live in `src/map/config.ts`, while map creation remains in
`App.tsx`.

When drawing tools, feature selection, additional layers, and routing are
introduced, OpenLayers logic can move into dedicated modules or hooks.

### 3.4 Comments explain decisions

Comments should not restate obvious code. They should document:

- an architecture decision;
- an external constraint;
- non-obvious behavior;
- a lifecycle precaution;
- a geographic value chosen by the project.

Public or reusable functions may receive short JSDoc comments when their
contract is not immediately obvious.

## 4. Technical overview

```text
Browser
   │
   ├── index.html
   │      │
   │      ▼
   ├── React 19 + TypeScript
   │      │
   │      ▼
   ├── App.tsx
   │      │ creates and destroys
   │      ▼
   ├── OpenLayers Map / View
   │      │
   │      ├── TileLayer: national map (JPEG)
   │      └── TileLayer: hiking trails (transparent PNG)
   │
   └── HTTPS XYZ requests to wmts.geo.admin.ch
```

No project-owned service runs on the server. The Vite development server only
compiles and serves frontend assets.

## 5. Technologies

| Technology | Role |
|---|---|
| React 19 | UI components and loading states |
| TypeScript 5 | Static typing and compile-time verification |
| OpenLayers 10 | Map, view, layers, tiles, projections, and controls |
| Vite 8 | Development server and production build |
| HTML/CSS | Page structure and full-screen layout |
| npm | Dependency installation and lockfile management |

### Why OpenLayers?

OpenLayers provides first-class support for raster layers, mapping services,
projections, layer ordering, and extent constraints. These features fit a
project that will eventually consume several swisstopo geodata formats.

### Why use direct XYZ URLs?

An earlier implementation parsed WMTS capabilities during startup. That
approach failed because of a projection mismatch while the capabilities
document was being interpreted.

The current implementation therefore uses the official XYZ URL pattern
directly in `EPSG:3857`. The national map uses JPEG tiles, while the hiking
overlay uses transparent PNG tiles.

The hiking layer has a layer-level `minZoom` constraint. Its configured value
is 11, which is an exclusive OpenLayers boundary, so the overlay normally first
appears at integer zoom level 12. This keeps overview maps readable and avoids
downloading trail tiles before the base map shows useful road detail.

## 6. Rendered overlay versus vector data

The layer `ch.swisstopo.swisstlm3d-wanderwege` is currently consumed through
WMTS-compatible XYZ tiles.

This means the browser receives already-rendered images. The implementation can
display the official trail symbology efficiently, but it cannot access the
individual trail geometries or attributes contained in the source dataset.

The current layer can therefore be used to validate:

- visual alignment with the national map;
- official trail categories and symbology;
- rendering quality at different zoom levels;
- browser-side tile performance.

It cannot yet be used for:

- selecting a trail segment;
- reading its attributes;
- snapping a waypoint to a segment;
- constructing a routing graph;
- calculating a route.

Those capabilities require the raw vector dataset or a suitable vector service.

## 7. Coordinate reference systems

The OpenLayers view and both tile layers use Web Mercator, `EPSG:3857`.

Values that are easier for humans to understand, such as the initial center and
application bounds, are declared in WGS 84 longitude/latitude (`EPSG:4326`) and
then transformed to `EPSG:3857` by OpenLayers.

Raw swissTLM3D data is distributed in LV95 (`EPSG:2056`). Its conversion must
be handled explicitly when raw vector data is introduced.

## 8. Geographic constraint

The application defines a rectangular extent covering Switzerland with a small
border margin.

This extent has two goals:

- keep nearby cross-border access visible;
- prevent users from panning to distant empty areas.

The restriction applies to the full visible viewport, not only to its center.
OpenLayers' smooth extent constraint is disabled so the boundary feels firm.

The current extent is a UI decision, not an official administrative geometry.
It can be adjusted after user testing.

## 9. Repository structure

```text
swiss-trail-planner/
├── docs/
│   └── ARCHITECTURE.md
├── src/
│   ├── map/
│   │   └── config.ts
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

## 10. File responsibilities

### `index.html`

HTML entry point loaded by the browser.

It contains the `#root` element used by React and references `src/main.tsx` as
the main module.

### `src/main.tsx`

React entry point.

It:

- imports OpenLayers styles;
- imports project styles;
- validates the presence of `#root`;
- mounts `App` with `createRoot`;
- enables `StrictMode` in development.

### `src/App.tsx`

Root component and integration boundary between React and OpenLayers.

It:

- reserves a DOM element for OpenLayers through a React ref;
- creates the two tile sources;
- creates the base-map layer and hiking-trail overlay;
- orders the hiking layer above the base map;
- applies the hiking layer's minimum zoom threshold;
- instantiates the map, view, and scale control;
- listens to base-map tile-loading events;
- handles the `loading`, `ready`, and `error` states;
- removes listeners and detaches the map on unmount.

OpenLayers is imperative, so the map is created inside a `useEffect`. React
owns the surrounding UI, while OpenLayers owns the map canvas and map-specific
DOM.

### `src/map/config.ts`

Central map and provider configuration.

It contains:

- the two swisstopo layer identifiers;
- the required attribution;
- the initial center;
- the allowed extent;
- map zoom levels and the hiking-overlay visibility threshold;
- a shared XYZ source factory;
- factories for the JPEG base map and PNG hiking overlay.

The hiking-source documentation explicitly records that the tile layer is only
a rendered representation and cannot be used directly for routing.

### `src/styles.css`

Global application styles.

It:

- gives the full window to `html`, `body`, `#root`, and the map;
- disables page scrolling;
- positions status messages;
- places the OpenLayers scale and attribution controls.

### `package.json`

Declares runtime dependencies, development dependencies, and npm scripts.

Available scripts:

```text
npm run dev      start the development server
npm run build    run the TypeScript check and Vite production build
npm run preview  preview the production build
```

### `package-lock.json`

Locks exact dependency versions so installations remain reproducible across
machines.

### `vite.config.ts`

Configures Vite and enables the React plugin.

### `tsconfig.json`

Enables strict TypeScript checking, React JSX support, and modern module
resolution.

### `.editorconfig`

Defines basic editor consistency rules: UTF-8, line endings, indentation, and
trailing whitespace handling.

### `.gitignore`

Excludes dependencies, build output, logs, local IDE files, and local
environment files.

### `README.md`

Developer and repository visitor quick-start guide.

It remains intentionally shorter than this architecture document.

### `LICENSE`

MIT license for the project's source code.

The source code license does not replace swisstopo's geodata usage and
attribution requirements.

## 11. Runtime flow

1. The browser loads `index.html`.
2. `src/main.tsx` mounts React into `#root`.
3. React renders `App`.
4. `App` runs its effect after the first render.
5. The effect creates the base-map and hiking-trail XYZ sources.
6. OpenLayers creates two ordered tile layers.
7. The base map requests visible tiles from `wmts.geo.admin.ch`.
8. The hiking overlay starts requesting and rendering tiles only after the view
   zoom moves beyond level 11.
9. The first successful base-map tile removes the loading message.
10. If the initial base map fails, an error message is displayed.
11. On unmount, listeners are removed and the map target is detached.

## 12. Error handling

The current version treats failure of the initial base map as fatal.

A single base-map tile error that occurs after the map has already loaded does
not hide the entire map. This prevents a local or temporary failure from making
an otherwise usable map unavailable.

The hiking overlay is deliberately non-blocking in this milestone: its failure
does not hide a successfully loaded base map. Dedicated layer-status reporting
can be added when the application gains a layer panel or notification system.

There is no application logging or automatic retry mechanism yet.

## 13. Code conventions

- Keep strict TypeScript enabled.
- Use explicit module imports.
- Centralize provider and map constants.
- Do not scatter geographic values across React components.
- Preserve explicit layer ordering.
- Remove every OpenLayers listener added inside an effect during cleanup.
- Comments should explain why, not restate obvious code.
- Keep files small and focused on one responsibility.
- Add abstractions only when they simplify multiple real use cases.
- `npm run build` must succeed before an important commit.

## 14. Planned evolution

### Phase 2B — Display raw swissTLM3D vectors

Load a limited vector sample and validate:

- reprojection from `EPSG:2056`;
- geometric alignment;
- useful attributes;
- feature selection;
- rendering performance;
- styles by trail type.

Loading all of Switzerland as one GeoJSON file is not a viable target.
Production-scale display will probably require data tiling, preprocessing, or a
vector-tile service.

### Phase 3 — Route editing

Add:

- waypoints;
- an editable line;
- point deletion and movement;
- length calculation;
- GPX export.

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

## 15. When to evolve the architecture

A new abstraction or directory becomes justified when one of these cases
appears:

- multiple components reuse the same map logic;
- several more layers must be created and ordered;
- OpenLayers interactions become numerous;
- shared state outgrows the root component;
- network calls other than tile requests are introduced;
- unit tests require isolated pure functions;
- a backend or offline data-processing step is added.
