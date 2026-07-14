# Swiss Trail Planner Validation

This document contains the practical checks used to validate the application
before an important release. It replaces the former roadmap now that the main
product scope is implemented.

The checklist should evolve when a regression is found, a provider changes, or
a new behavior becomes important. It is not a promise to implement every
possible future feature.

## 1. Validation workflow

Before recording a result:

```bash
npm ci
npm run build
npm run dev
```

For each validation session, record the commit, browser, screen size, tested
region, result, and any issue discovered. Prefer a small set of repeatable routes
and locations over broad but unstructured exploration.

## 2. Release smoke checks

### Application and map

- [ ] The production build succeeds without TypeScript errors.
- [ ] The application starts with no blocking console error.
- [ ] Color, grey, and aerial backgrounds load and can be switched without
      changing the current view.
- [ ] Hiking trails appear only at the intended detailed zoom levels.
- [ ] Search, geolocation, zoom controls, scale, and fullscreen mode work.
- [ ] French, German, Italian, and English can be selected without recreating
      the map or losing the current route.

### Route creation

- [ ] A first waypoint can be added with snapping enabled and disabled.
- [ ] A routed section follows plausible roads or paths and does not create an
      obvious false connection.
- [ ] A missing or disconnected network section falls back to a straight segment
      without disabling snapping for the next click.
- [ ] The first, an intermediate, and the final waypoint can be dragged without
      panning the map or adding an accidental new point.
- [ ] Dragging shows an immediate straight preview and recalculates only the one
      or two adjacent sections after release.
- [ ] Dragging the route line away from existing points inserts one new waypoint,
      replaces only the selected section, and does not pan the map.
- [ ] Pressing the route line without a genuine drag restores the original route
      and does not append a new endpoint.
- [ ] An inserted point splits a straight section into two straight sections;
      a routed section recalculates both halves and falls back independently.
- [ ] Straight adjacent sections remain straight; routed sections are recalculated
      and fall back independently when no network path is available.
- [ ] Undo and redo restore complete route states, including waypoint moves and
      insertions, without another routing request.
- [ ] Reversal preserves the complete geometry in the opposite direction and can
      be undone as one edit.
- [ ] Deletion clears the editable route and its statistics.
- [ ] Distance, ascent, descent, duration, and the elevation profile refresh
      after route changes.

### GPX

- [ ] A named GPX export opens in at least one independent hiking application.
- [ ] Exported geometry preserves routed bends and waypoint order.
- [ ] Elevation values are present when the profile request succeeded.
- [ ] A valid GPX track or route loads as a separate purple read-only reference.
- [ ] Invalid, empty, and oversized GPX files leave the existing routes unchanged.

### Information layers

- [ ] Hiking closures are visible, selectable, localized, and do not alter route
      calculation.
- [ ] Shooting danger zones are semi-transparent, remain above closures and
      transport symbols, and visibly highlight the selected polygon.
- [ ] Public-transport stops display only recognized passenger modes.
- [ ] Distinct nearby official stops remain separate and can both be selected.
- [ ] Departure dates appear when results extend beyond the current service day.
- [ ] Closing a popup or disabling its layer clears the associated selection and
      aborts obsolete requests.

## 3. Routing validation scenarios

Use these scenarios to cover different topology and loading risks. Add the exact
start, destination, and intermediate waypoints to the validation log so a result
can be reproduced.

| Region or scenario | Main risk to inspect | Expected behavior |
|---|---|---|
| Vandoeuvres / Geneva | Original prototype baseline and dense local roads | Stable snapping and plausible route choice |
| Dense urban center such as Lausanne, Bern, or Zurich | Close intersections, stairs, bridges, and many graph candidates | No impossible shortcut or false crossing |
| Mountain area such as Moléson / Plan-Francey | Sparse paths, steep terrain, and elevation sampling | Continuous route on mapped walkable paths with credible profile |
| Jura or Alpine rural route | Long sections and incomplete local connectivity | Bounded loading, acceptable latency, and clear straight fallback when needed |
| Swiss border section | swissTLM3D coverage ending outside Switzerland | Only the unsupported section becomes straight; later Swiss clicks can snap again |
| Bridge, tunnel, or grade-separated crossing | Vertically separated geometry | No connection based only on an XY crossing |

For every routed section, compare the displayed geometry with the official map.
Record request failures, unusually slow calculations, missing connections,
implausible detours, and false intersections.

## 4. Information-layer regression locations

These locations cover bugs or ambiguous cases encountered during development.
They should remain part of routine regression testing.

| Location | Check |
|---|---|
| Colondalles | The unsupported or missing transport mode does not create a visible stop |
| Lausanne-Triage B | The operating-only point is not displayed as a passenger stop |
| Plan-Francey / Moléson | Nearby funicular and cable-car stops remain distinct and both icons are accessible |
| Biel/Bienne Magglingenbahn | Bus and funicular remain separate; one popup never borrows the other stop's departures |
| Petit Hongrin / Col des Mosses | Adjacent danger zones are visible above other overlays and the selected polygon is unambiguous |
| A rural stop with few departures | Results spanning more than one day are grouped under explicit localized dates |

Provider data changes over time. If a named case disappears or changes meaning,
replace it with another location that exercises the same behavior.

## 5. Browser and layout coverage

Recommended minimum manual coverage:

| Environment | Checks |
|---|---|
| Current Chromium desktop browser | Complete smoke checklist and developer-console review |
| Current Firefox desktop browser | Map interaction, fullscreen, file import, and popups |
| Narrow mobile-sized viewport | Control spacing, popup fit, route actions, and elevation profile |
| Touch-capable device or emulator | Map taps, waypoint and route-line dragging, enlarged waypoint hit area, route creation, menus, and popup closing |

Also verify keyboard interaction for location search, Layers menu closing with
Escape, export-dialog confirmation and cancellation, and browser fullscreen
exit.

## 6. Network and service resilience

Use browser throttling or temporary request blocking to confirm that:

- an unavailable optional overlay does not block the base map;
- a failed timetable request keeps the stop name and official timetable links;
- a failed elevation request keeps distance visible and route editing usable;
- superseded search, routing, stop, and popup requests do not update stale UI;
- repeated map movement does not create an uncontrolled request burst;
- reopening recently inspected stops respects the short stationboard cache.

## 7. Candidates for automated regression tests

Manual map validation remains essential, but the following pure or mostly pure
logic would benefit most from focused automated tests:

- transport-stop filtering, mode classification, and feature deduplication;
- stationboard validation, prediction-time sorting, date grouping, and caching;
- GPX import validation and export serialization;
- route-state undo/redo, waypoint move and insertion rebuilding, reversal, and geometry flattening;
- route distance, ascent, descent, and duration calculations;
- selected routing cost and topology helpers where representative fixtures can
  be kept small.

A small suite of high-value tests is preferable to broad UI test infrastructure
that is expensive to maintain.

## 8. Validation log

Copy one row per session or focused regression check.

| Date | Commit | Browser / device | Region or feature | Result | Notes or issue |
|---|---|---|---|---|---|
| YYYY-MM-DD | short SHA | environment | scenario | Pass / Fail | observations |
