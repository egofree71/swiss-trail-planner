# Routing performance benchmark

This local browser tool measures the CPU-side cost of Via Helvetica dynamic
routing without adding controls or assets to the published application.

A detailed GPX trace does not normally contain the sparse waypoints originally
chosen by a route-planning user. The tool therefore generates deterministic
synthetic clicks along the longest continuous GPX segment:

- **Adaptive regular** targets roughly 500-metre sections and caps the scenario
  at 24 sections.
- **Fixed regular** accepts any interval from 50 metres, so short routes and
  small sections can be tested explicitly.
- **Seeded irregular** varies section lengths between approximately 55% and
  145% of the selected average while remaining reproducible.

Run the page with:

```bash
npm run benchmark:routing
```

Use the two explicit workflow steps in the page:

1. **Generate scenario** reads the selected GPX and previews the deterministic
   synthetic clicks. It does not request routing data or measure performance.
2. **Run benchmark** performs the network warm-up and then the CPU-side measured
   pass. The page switches from the **Scenario** tab to the **Benchmark report**
   tab when this second step completes. The report separates exact graph-cache
   lookup, cached-cell access, feature merging, graph construction, start and
   destination snapping, A*, coordinate reconstruction, and residual overhead.
3. **Export benchmark JSON** saves the complete measured report, scenario, cache
   mode, browser identity, export time, logical CPU count, and reported device
   memory when the browser exposes it.

The first pass performs the real GeoAdmin loading and resolves the same sequence
of snapped endpoints as live route creation. It then clears only derived graph
instances while preserving raw cell data. The measured pass reports each
internal CPU phase, total routing elapsed time, animation-frame delay, immutable
route-step commit time, and browser long tasks when supported. The exported
benchmark format uses schema version 2 for these detailed phase fields. A
non-zero **Measured cells** value means the
CPU measurement was contaminated by an unexpected cell load and should be run
again before comparison.

Two graph-cache modes are available:

- **Normal session cache** reproduces the application's exact-corridor graph LRU.
- **Rebuild every section** clears that cache before each section to expose the
  worst-case graph-construction cost relevant to a possible Web Worker.

Use several GPX files from contrasting Swiss regions. Keep the scenario JSON when
the synthetic clicks should remain stable across versions, and keep the benchmark
JSON when comparing devices, browsers, cache modes, or engine revisions.
Performance results are diagnostic measurements, not deterministic pass/fail
tests.
