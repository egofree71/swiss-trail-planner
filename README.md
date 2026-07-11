# Swiss Trail Planner

Open-source web application for planning hiking routes on official swisstopo
maps and geodata.

The current version displays the Swiss national raster map, the official
swissTLM3D hiking-trail overlay, lightweight map navigation tools, manual
route creation, and experimental on-demand swissTLM3D routing around the
positions selected by the user.

## Current features

- full-screen interactive Swiss national map;
- official hiking trails displayed above the base map at detailed zoom levels;
- search for Swiss communes, localities, postal codes, and geographic names;
- selected search result displayed with a map marker;
- large, separated zoom controls;
- one-click browser geolocation with a map marker;
- fullscreen map mode with automatic exit through the Escape key;
- route-creation mode with a dedicated cursor and inverted active button;
- ordered waypoints and a clearly visible red route added by map clicks or
  taps;
- experimental snapping and A* routing on swissTLM3D roads and paths loaded
  on demand;
- straight-line segments when snapping is disabled;
- functional undo and redo that restore the exact generated segment geometry;
- route reversal, complete route deletion, and GPX track export;
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
straight segments without loading swissTLM3D data.

Undo removes the most recently added waypoint and its segment. Redo restores
the exact stored geometry without repeating the network request. Adding a new
waypoint after an undo clears the redo history. The route remains visible when
route-creation mode is left and can be continued by entering the mode again.

The route can be reversed without another routing request: waypoint order and
each stored section geometry are reversed in memory. Deleting clears the
complete route and its redo history while keeping creation mode active. Export
creates a GPX 1.1 track containing the complete displayed geometry, including
all intermediate swissTLM3D vertices, so another application can reproduce the
same path without recalculating it. Elevation values are not exported yet.

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

Base map:

- XYZ URL template:
  `https://wmts.geo.admin.ch/1.0.0/{layer}/default/current/3857/{z}/{x}/{y}.jpeg`
- Layer:
  `ch.swisstopo.pixelkarte-farbe`

Hiking trails:

- XYZ URL template:
  `https://wmts.geo.admin.ch/1.0.0/{layer}/default/current/3857/{z}/{x}/{y}.png`
- Layer:
  `ch.swisstopo.swisstlm3d-wanderwege`

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

Test dynamic routing in several contrasting Swiss regions, inspect missing or
false connections, and measure API and graph performance before deciding whether
a preprocessed graph or backend is actually necessary.

## License

The source code is released under the MIT License.

swisstopo geodata remains subject to its own usage and attribution terms.
