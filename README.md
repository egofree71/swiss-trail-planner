# Swiss Trail Planner

Swiss Trail Planner is an open-source, map-centered web application for
planning hiking routes in Switzerland with official swisstopo maps and geodata.
It is intentionally lightweight, frontend-only, and focused on one route at a
time.

## Table of contents

- [Features](#features)
- [Quick start](#quick-start)
- [Basic usage](#basic-usage)
- [Data sources and limitations](#data-sources-and-limitations)
- [Documentation](#documentation)
- [Production build and deployment](#production-build-and-deployment)
- [License](#license)

## Features

| Area | Available functionality |
|---|---|
| Map | Full-screen OpenLayers map with official swisstopo color, grey, and aerial backgrounds, hiking trails, search, geolocation, scale, and fullscreen mode |
| Route planning | Ordered waypoints, optional swissTLM3D snapping, straight fallback segments, undo, redo, reversal, and route deletion |
| Route information | Distance, ascent, descent, estimated walking time, and a collapsible elevation profile |
| Import and export | Read-only GPX reference loading and named GPX export with smoothed elevations when available |
| Safety | Official hiking-trail closures and detours, plus military shooting notices and danger zones with localized details |
| Public transport | Passenger-relevant stops, mode-specific symbols, next departures grouped by date, and links to the official SBB/CFF/FFS timetable |
| Interface | Compact floating controls, no permanent toolbar, and French, German, Italian, and English translations |

## Quick start

Vite 8 requires Node.js 20.19 or later, or Node.js 22.12 or later. A recent LTS
release is recommended.

```bash
node --version
npm --version
npm install
npm run dev
```

Vite then displays a local address, usually:

```text
http://localhost:5173/
```

## Basic usage

1. Use the **Layers** button to choose a background and enable or disable
   information overlays.
2. Activate route creation, then click or tap the map to add waypoints.
3. Keep snapping enabled to follow available swissTLM3D roads and paths, or
   disable it to create straight segments. A section also falls back to a
   straight line when no routable path can be resolved.
4. Use the route controls to undo, redo, reverse, delete, or export the current
   itinerary.
5. Load a GPX file to display it as an independent purple, read-only reference
   while planning a new red route.
6. Outside route-creation mode, click visible closures, danger zones, or public
   transport stops to inspect their available information.

The application requests browser geolocation only after the location button is
pressed. Deployed geolocation requires HTTPS.

## Data sources and limitations

The application uses official swisstopo backgrounds and swissTLM3D geodata,
official hiking-closure and military danger-zone layers, Federal Office of
Transport stop data, GeoAdmin services, and `transport.opendata.ch` departure
data.

Current limitations:

- dynamic swissTLM3D routing is experimental and runs entirely in the browser;
- closures and danger zones are informational and do not automatically change
  route calculation;
- waypoint movement, insertion, and individual deletion are not yet available;
- imported GPX routes are read-only;
- routes are not persisted locally or remotely;
- external map, elevation, routing, and timetable services can be temporarily
  unavailable or incomplete.

Detailed provider identifiers, request strategies, filtering rules, layer
ordering, projections, caching, and routing internals are documented in the
architecture document rather than duplicated here.

## Documentation

- [Architecture](docs/ARCHITECTURE.md): current structure, file responsibilities,
  data flows, and technical choices.
- [Validation](docs/VALIDATION.md): release checks, routing scenarios, regression
  cases, and a reusable test log.

## Production build and deployment

```bash
npm run build
```

The production files are written to `dist/`. To preview them locally:

```bash
npm run preview
```

The repository includes a GitHub Actions workflow that builds and deploys the
application to GitHub Pages after a push to `main`. GitHub Pages must use
**GitHub Actions** as its deployment source.

## License

The source code is released under the MIT License.

swisstopo and other external geodata remain subject to their own usage,
licensing, and attribution terms.
