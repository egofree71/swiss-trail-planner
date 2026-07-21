# Via Helvetica

Via Helvetica is an open-source, map-centered web application for
planning hiking routes in Switzerland with official swisstopo maps and geodata.
It is intentionally lightweight, frontend-only, and focused on one route at a
time. The public application is designed to remain free to use without an
account or a project-owned application server.

## Table of contents

- [Project principles](#project-principles)
- [Features](#features)
- [Quick start](#quick-start)
- [Basic usage](#basic-usage)
- [Data sources and limitations](#data-sources-and-limitations)
- [Documentation](#documentation)
- [Regression tests](#regression-tests)
- [Production build and deployment](#production-build-and-deployment)
- [Search and social metadata](#search-and-social-metadata)
- [License](#license)

## Project principles

Via Helvetica deliberately keeps route planning in the browser. Users do not
need to register, routes are not uploaded to a project-owned server, and static
hosting keeps recurring operating costs as low as possible. External official
services still receive the bounded requests required for maps and geodata.

The router is an interactive planning aid rather than an autonomous navigation
system. The official hiking portrayal remains visible on the map, and users can
add a closer waypoint whenever parallel paths or a complex junction make their
intent ambiguous.

## Features

| Area | Available functionality |
|---|---|
| Map | Full-screen OpenLayers map in native Swiss LV95 (EPSG:2056), with official swisstopo color, grey, and aerial backgrounds, hiking trails, search, geolocation, scale, and fullscreen mode |
| Route planning | Ordered waypoints that can be moved, inserted by dragging the route, or deleted individually, visible start and finish markers, sparse hollow direction arrows, optional swissTLM3D snapping in a dedicated routing worker, straight fallback segments, undo, redo, reversal, loop closure, and complete route deletion |
| Route information | Distance, ascent, descent, Swiss hiking-time estimate, and a collapsible elevation profile with altitude and distance graduations; the mobile summary condenses the four values into one row, and pointer position is mirrored in both directions between the map route and the open profile, including horizontal finger exploration on touch screens |
| Import and export | Read-only GPX loading with statistics and elevation profile, plus named GPX track export with sub-metre geometry simplification, geographic metadata bounds, and smoothed elevations when available |
| Safety | Official hiking-trail closures and detours, plus military shooting notices and danger zones with localized details |
| Public transport | Passenger-relevant stops, mode-specific symbols, next departures grouped by date, and links to the official SBB/CFF/FFS timetable |
| Interface | Compact floating controls, no permanent toolbar, French, German, Italian, and English translations, and a localized About dialog with project, support, professional profile, safety, and data-credit information |

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
http://localhost:5173/
```

## Basic usage

1. Use the **Layers** button to choose a background and enable or disable
   information overlays.
2. Activate route creation. Snapping is enabled by default and can be changed
   before placing the first waypoint. Then click or tap the map to add
   waypoints. A simple click on an existing red route section also adds the next
   waypoint
   from the current endpoint, which allows the itinerary to reuse the same path.
   Drag an existing red waypoint to move it, click it to delete it, or drag a
   red route section to insert a waypoint into that stored section. Contextual
   labels describe these actions when a mouse or hover-capable pointer is used.
   On touch-only devices, tap an existing waypoint to delete it, deliberately
   drag a waypoint to move it, or start a drag very close to a route section to
   insert a new waypoint. Finger drags that start farther from the itinerary
   remain available for map panning, and a second finger keeps pinch zoom available.
   Only the affected sections are recalculated after an edit, using the current
   snapping choice.
3. Keep snapping enabled to create or reshape sections along available
   swissTLM3D roads and paths, or disable it to create or rebuild them as
   straight lines. A section also falls back to a straight line when no
   routable path can be resolved. If several nearby paths make the selected
   route ambiguous, add a waypoint closer to the intended path.
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
   position is also mirrored in the chart. Moving over the chart, or dragging a
   finger horizontally across it, shows the matching position on the map.
   Complete embedded GPX elevations are
   reused; GeoAdmin supplies the profile only when they are unavailable.
   Starting a new route replaces the imported itinerary.
6. Outside route-creation mode, click visible closures, danger zones, or public
   transport stops to inspect their available information. Starting route
   creation, loading a GPX, opening map information, or changing the interface
   language clears the temporary location marker, search text, and result list.
7. Use the information button to open the localized About dialog. It stays in
   the lower-right corner on wide screens and joins the right-side control stack
   below the language selector when the viewport narrows. The dialog summarizes
   the project, experimental-routing limitation, creator and support contact,
   source code, license, professional profile, and official data credits.

The application requests browser geolocation only after the location button is
pressed. Deployed geolocation requires HTTPS. At narrow phone widths, the metric
scale is hidden because the bottom route summary occupies the same map area.

## Data sources and limitations

The application uses official swisstopo backgrounds and swissTLM3D geodata,
official hiking-closure and military danger-zone layers, Federal Office of
Transport stop data, GeoAdmin services, and `transport.opendata.ch` departure
data. The map, editable route, information layers, and routing graph use native
Swiss LV95 coordinates (`EPSG:2056`); WGS 84 conversion is limited to browser
geolocation, location-search results, and GPX input or output.
Walking-time estimates apply the slope-sensitive model published by Schweizer
Wanderwege in *Wanderzeitberechnung, Version 2020.2* (8 June 2020).

Browser routing does not download and preprocess the
[official national swissTLM3D packages](https://www.swisstopo.admin.ch/en/landscape-model-swisstlm3d).
It uses bounded requests to GeoAdmin's
[documented REST `MapServer/identify` endpoint](https://docs.geo.admin.ch/access-data/identify-features.html)
instead. The official
`ch.swisstopo.swisstlm3d-strassen` layer supplies the required road-and-path
graph. The official `ch.swisstopo.swisstlm3d-wanderwege` layer is requested only
as optional enrichment so matching graph edges can be preferred.

GeoAdmin's
[layer configuration](https://api3.geo.admin.ch/rest/services/api/MapServer/layersTable)
advertises feature tooltips for the road layer but not for the hiking layer.
Obtaining hiking geometries through `identify` is
therefore treated as a useful but non-guaranteed behavior: the normal request
asks for both layers to avoid doubling traffic, then retries the same tile with
roads alone if the combined layer request is rejected. That first rejection
disables further hiking-layer requests for the remaining routing Worker session,
and the interface shows one localized non-blocking notice that subsequent
calculations use only the road-and-path network. Routing remains available
without hiking enrichment, although ambiguous parallel paths may require a
closer waypoint.

Current limitations:

- dynamic swissTLM3D routing is experimental and runs entirely in the browser; network loading, graph construction, snapping, and A* run in a dedicated Web Worker, while each GeoAdmin identify attempt has a 15-second timeout and one bounded retry for transient failures;
- the identify API returns at most 200 features per request, so dense road or hiking responses are recursively subdivided; the service is used for bounded interactive routing rather than bulk data extraction;
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
  data flows, and technical choices, including the disposable OpenLayers runtime,
  focused information, map-control, editable-route, imported-GPX, and
  itinerary-metrics hooks, plus the separation between route state, route
  rendering, low-level pointer interaction, reconstruction, and
  buffered public-transport loading, normalization, and display.

## Regression tests

The focused Vitest suite protects immutable route transformations, route editing,
GPX parsing, batch projection, and export, route metrics, directional-arrow
placement, location-search caching and provider normalization, passenger-stop
filtering and buffered viewport loading, routing-grid
footprints, worker-client messaging, and the dynamic routing engine's corridor,
cache, cancellation cleanup, retry, session-wide hiking-enrichment fallback,
and straight-fallback behaviour. Run it once with:

```bash
npm test
```

To verify the roads-only fallback manually, set `useHikingEnrichment` to
`false` in `src/routing/routingConfig.ts`, restart Vite, and create a route on
`localhost`. The Worker then skips hiking geometry from its first request and
shows the same translated session notice when that first routing operation
starts. This switch
is ignored outside `localhost`, `127.0.0.1`, and the IPv6 loopback address, so a
forgotten local test value cannot change the deployed application. The rendered
hiking-trail map overlay remains independent and visible.

During development, use `npm run test:watch` to rerun affected tests after each
change. GitHub Actions runs the complete suite before building and deploying the
site.

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
**GitHub Actions** as its deployment source. The production site is served from
the custom domain root at [viahelvetica.ch](https://viahelvetica.ch/), so Vite
uses `base: '/'` for generated assets.

## Search and social metadata

`index.html` declares the canonical custom-domain URL, localized runtime title
and description support, Open Graph and social-card metadata, and
`WebApplication` structured data. `public/social-preview.png` is the 1200 × 630
sharing image. `public/robots.txt` allows crawling and points search engines to
the single-page `public/sitemap.xml`.

The placeholder author name in `index.html` and the placeholder LinkedIn URL in
`src/components/AboutDialog.tsx` must be replaced before public promotion.
Google Search Console setup and sitemap submission remain external deployment
steps rather than repository configuration.

## License

The source code is released under the MIT License.

swisstopo and other external geodata remain subject to their own usage,
licensing, and attribution terms.
