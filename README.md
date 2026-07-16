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
| Map | Full-screen OpenLayers map in native Swiss LV95 (EPSG:2056), with official swisstopo color, grey, and aerial backgrounds, hiking trails, search, geolocation, scale, and fullscreen mode |
| Route planning | Ordered waypoints that can be moved, inserted by dragging the route, or deleted individually, visible start and finish markers, sparse hollow direction arrows, optional swissTLM3D snapping, straight fallback segments, undo, redo, reversal, loop closure, and complete route deletion |
| Route information | Distance, ascent, descent, Swiss hiking-time estimate, and a collapsible elevation profile with altitude and distance graduations; pointer position is mirrored in both directions between the map route and the open profile |
| Import and export | Read-only GPX loading with statistics and elevation profile, plus named GPX export with sub-metre geometry simplification and smoothed elevations when available |
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

Vite then displays the project address, usually:

```text
http://localhost:5173/swiss-trail-planner/
```

## Basic usage

1. Use the **Layers** button to choose a background and enable or disable
   information overlays.
2. Activate route creation, then click or tap the map to add waypoints. A
   simple click on an existing red route section also adds the next waypoint
   from the current endpoint, which allows the itinerary to reuse the same path.
   Drag an existing red waypoint to move it, click it to delete it, or drag a
   red route section to insert a waypoint into that stored section. Contextual
   labels describe these actions when a mouse or hover-capable pointer is used.
   Only the affected sections are recalculated after an edit.
3. Keep snapping enabled to follow available swissTLM3D roads and paths, or
   disable it to create straight segments. A section also falls back to a
   straight line when no routable path can be resolved.
4. Use the route controls to undo, redo, reverse, close or reopen a loop, delete,
   or export the current itinerary. Compact **A** and **B** markers identify the
   current start and finish. Sparse hollow arrows centred on the line show travel direction
   without covering waypoints. Reversing an open route swaps A and B and reverses
   the arrows, while a closed loop keeps its split green/red **A/B** marker at the
   same physical start and reverses only the arrows and traversal order. A waypoint
   move, insertion, or individual deletion is restored as one complete undoable
   edit.
5. Load a GPX file as the current purple, read-only itinerary. Its overall start
   and finish use the same **A**, **B**, or split **A/B** markers, while sparse
   hollow purple arrows show the recorded travel direction. Its distance,
   ascent, descent, Swiss hiking-time estimate, and elevation profile use the same
   bottom summary as an editable route. Moving the pointer over either itinerary
   shows its position with a circle on the map; when the profile is open, the same
   position is also mirrored in the chart. Moving over the chart continues to show
   the matching position on the map. Complete embedded GPX elevations are
   reused; GeoAdmin supplies the profile only when they are unavailable.
   Starting a new route replaces the imported itinerary.
6. Outside route-creation mode, click visible closures, danger zones, or public
   transport stops to inspect their available information.

The application requests browser geolocation only after the location button is
pressed. Deployed geolocation requires HTTPS.

## Data sources and limitations

The application uses official swisstopo backgrounds and swissTLM3D geodata,
official hiking-closure and military danger-zone layers, Federal Office of
Transport stop data, GeoAdmin services, and `transport.opendata.ch` departure
data. The map, editable route, information layers, and routing graph use native
Swiss LV95 coordinates (`EPSG:2056`); WGS 84 conversion is limited to browser
geolocation, location-search results, and GPX input or output.
Walking-time estimates apply the slope-sensitive model published by Schweizer
Wanderwege in *Wanderzeitberechnung, Version 2020.2* (8 June 2020).

Current limitations:

- dynamic swissTLM3D routing is experimental and runs entirely in the browser;
- closures and danger zones are informational and do not automatically change
  route calculation;
- imported GPX routes are read-only and replace the current editable route;
- routes are not persisted locally or remotely;
- external map, elevation, routing, and timetable services can be temporarily
  unavailable or incomplete.

Detailed provider identifiers, request strategies, filtering rules, layer
ordering, projections, caching, and routing internals are documented in the
architecture document rather than duplicated here.

## Documentation

- [Architecture](docs/ARCHITECTURE.md): current structure, file responsibilities,
  data flows, and technical choices.
- [Validation](docs/VALIDATION.md): important manual and regression checks.

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
