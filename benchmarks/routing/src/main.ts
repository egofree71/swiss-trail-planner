/**
 * Business context: local-only browser interface for generating reproducible
 * GPX routing scenarios, measuring worker-side routing phases, and checking
 * main-thread responsiveness without adding controls to the published map.
 */
import './styles.css';
import {
  createScenarioFromGpx,
  serializeScenario,
  type RoutingBenchmarkScenario,
  type WaypointGenerationStrategy,
} from './gpxScenario';
import {
  runRoutingBenchmark,
  type GraphCacheMode,
  type RoutingBenchmarkReport,
} from './benchmarkRunner';

function requiredElement<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);

  if (!element) {
    throw new Error(`The routing benchmark is missing ${selector}.`);
  }

  return element;
}

const fileInput = requiredElement<HTMLInputElement>('#gpx-file');
const fileNameOutput = requiredElement<HTMLElement>('#gpx-file-name');
const strategySelect = requiredElement<HTMLSelectElement>('#strategy');
const spacingInput = requiredElement<HTMLInputElement>('#spacing');
const seedInput = requiredElement<HTMLInputElement>('#seed');
const cacheModeSelect = requiredElement<HTMLSelectElement>('#cache-mode');
const generateButton = requiredElement<HTMLButtonElement>('#generate');
const runButton = requiredElement<HTMLButtonElement>('#run');
const exportButton = requiredElement<HTMLButtonElement>('#export');
const exportReportButton = requiredElement<HTMLButtonElement>('#export-report');
const status = requiredElement<HTMLElement>('#status');
const scenarioOutput = requiredElement<HTMLElement>('#scenario-output');
const reportOutput = requiredElement<HTMLElement>('#report-output');
const scenarioEmpty = requiredElement<HTMLElement>('#scenario-empty');
const reportEmpty = requiredElement<HTMLElement>('#report-empty');
const scenarioTab = requiredElement<HTMLButtonElement>('#scenario-tab');
const reportTab = requiredElement<HTMLButtonElement>('#report-tab');
const scenarioPanel = requiredElement<HTMLElement>('#scenario-panel');
const reportPanel = requiredElement<HTMLElement>('#report-panel');

let currentScenario: RoutingBenchmarkScenario | null = null;
let currentReport: RoutingBenchmarkReport | null = null;
let currentAbortController: AbortController | null = null;
const defaultRunButtonText = runButton.textContent ?? '2. Run benchmark';

/** Selects one result tab while keeping keyboard and assistive state synchronized. */
function selectResultTab(tab: 'scenario' | 'report'): void {
  const showScenario = tab === 'scenario';
  scenarioTab.setAttribute('aria-selected', String(showScenario));
  reportTab.setAttribute('aria-selected', String(!showScenario));
  scenarioPanel.hidden = !showScenario;
  reportPanel.hidden = showScenario;
}

scenarioTab.addEventListener('click', () => selectResultTab('scenario'));
reportTab.addEventListener('click', () => {
  if (!reportTab.disabled) {
    selectResultTab('report');
  }
});

/** Escapes user-derived text before inserting small report fragments. */
function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

/** Formats milliseconds without hiding short but measurable work. */
function formatMilliseconds(value: number): string {
  return value < 10 ? `${value.toFixed(2)} ms` : `${value.toFixed(1)} ms`;
}

/** Formats LV95 ground distance for compact tables. */
function formatDistance(value: number): string {
  return value < 1_000 ? `${Math.round(value)} m` : `${(value / 1_000).toFixed(2)} km`;
}

/** Returns the selected deterministic sampling strategy. */
function selectedStrategy(): WaypointGenerationStrategy {
  const spacingMeters = Number(spacingInput.value);
  const seed = Number(seedInput.value);

  switch (strategySelect.value) {
    case 'regular':
      return { kind: 'regular', spacingMeters };
    case 'irregular':
      return { kind: 'irregular', averageSpacingMeters: spacingMeters, seed };
    default:
      return { kind: 'adaptive' };
  }
}

/** Clears generated results when an input changes so stale settings cannot be run. */
function invalidateScenario(): void {
  if (!currentScenario) {
    return;
  }

  currentScenario = null;
  currentReport = null;
  runButton.disabled = true;
  exportButton.disabled = true;
  exportReportButton.disabled = true;
  scenarioOutput.replaceChildren();
  reportOutput.replaceChildren();
  scenarioEmpty.hidden = false;
  reportEmpty.hidden = false;
  reportTab.disabled = true;
  selectResultTab('scenario');
  status.textContent = 'Settings changed. Generate the scenario again before running the benchmark.';
}

/** Keeps strategy-specific controls understandable without hiding their values. */
function updateStrategyControls(): void {
  const adaptive = strategySelect.value === 'adaptive';
  const irregular = strategySelect.value === 'irregular';
  spacingInput.disabled = adaptive;
  seedInput.disabled = !irregular;
}

/** Renders generated synthetic clicks before any network request is made. */
function renderScenario(scenario: RoutingBenchmarkScenario): void {
  const segmentRows = scenario.waypointDistancesMeters
    .slice(1)
    .map((distance, index) => {
      const previousDistance = scenario.waypointDistancesMeters[index];
      return `<tr><td>${index + 1}</td><td>${formatDistance(
        distance - previousDistance,
      )}</td><td>${formatDistance(distance)}</td></tr>`;
    })
    .join('');

  scenarioOutput.innerHTML = `
    <h2>Generated scenario</h2>
    <dl class="summary-grid">
      <div><dt>Name</dt><dd>${escapeHtml(scenario.name)}</dd></div>
      <div><dt>Source length</dt><dd>${formatDistance(
        scenario.sourceLengthMeters,
      )}</dd></div>
      <div><dt>Synthetic clicks</dt><dd>${scenario.waypointsLv95.length}</dd></div>
      <div><dt>Route sections</dt><dd>${scenario.waypointsLv95.length - 1}</dd></div>
      <div><dt>Source vertices</dt><dd>${scenario.sourcePointCount}</dd></div>
      <div><dt>Ignored GPX segments</dt><dd>${scenario.ignoredSegmentCount}</dd></div>
    </dl>
    <table>
      <thead><tr><th>Section</th><th>Sample interval</th><th>Cumulative</th></tr></thead>
      <tbody>${segmentRows}</tbody>
    </table>
  `;
}

/** Renders worker-side phase timings and the main-thread responsiveness guard. */
function renderReport(report: RoutingBenchmarkReport): void {
  const rows = report.segments
    .map(
      (segment) => `<tr>
        <td>${segment.segmentIndex}</td>
        <td>${formatDistance(segment.directDistanceMeters)}</td>
        <td>${formatMilliseconds(segment.graphCacheLookupDurationMs)}</td>
        <td>${formatMilliseconds(segment.rawCellAccessDurationMs)}</td>
        <td>${formatMilliseconds(segment.featureMergeDurationMs)}</td>
        <td>${formatMilliseconds(segment.graphBuildDurationMs)}</td>
        <td>${formatMilliseconds(segment.startSnapDurationMs)}</td>
        <td>${formatMilliseconds(segment.endSnapDurationMs)}</td>
        <td>${formatMilliseconds(segment.aStarDurationMs)}</td>
        <td>${formatMilliseconds(segment.routeReconstructionDurationMs)}</td>
        <td>${formatMilliseconds(segment.routingOverheadDurationMs)}</td>
        <td>${formatMilliseconds(segment.routeDurationMs)}</td>
        <td>${formatMilliseconds(segment.frameDelayMs)}</td>
        <td>${formatMilliseconds(segment.stateCommitDurationMs)}</td>
        <td>${segment.longTaskDurationMs === null ? '—' : formatMilliseconds(segment.longTaskDurationMs)}</td>
        <td>${segment.graphCacheHits}/${segment.graphCacheMisses}</td>
        <td>${segment.routeAttempts}</td>
        <td>${segment.retryUsed ? 'yes' : 'no'}</td>
        <td>${segment.warmupNewCells}</td>
        <td>${segment.unexpectedNewCells}</td>
        <td>${segment.foundPath ? 'network' : 'straight fallback'}</td>
      </tr>`,
    )
    .join('');
  const networkGuard =
    report.unexpectedNetworkCellLoads === 0
      ? '<span class="ok">No new cells were loaded during measurement.</span>'
      : `<span class="warning">${report.unexpectedNetworkCellLoads} cells were unexpectedly loaded; rerun before comparing CPU results.</span>`;
  const totalSnapDurationMs =
    report.phaseTotals.startSnapDurationMs +
    report.phaseTotals.endSnapDurationMs;

  reportOutput.innerHTML = `
    <h2>Benchmark report</h2>
    <p>${networkGuard}</p>
    <dl class="summary-grid">
      <div><dt>Execution</dt><dd>${escapeHtml(report.executionMode)}</dd></div>
      <div><dt>Graph cache mode</dt><dd>${escapeHtml(report.graphCacheMode)}</dd></div>
      <div><dt>Warm-up</dt><dd>${formatMilliseconds(report.warmupDurationMs)}</dd></div>
      <div><dt>Raw cells cached</dt><dd>${report.warmupLoadedCells}</dd></div>
      <div><dt>Total measured routing</dt><dd>${formatMilliseconds(report.totalRouteDurationMs)}</dd></div>
      <div><dt>Total graph build</dt><dd>${formatMilliseconds(report.phaseTotals.graphBuildDurationMs)}</dd></div>
      <div><dt>Total endpoint snapping</dt><dd>${formatMilliseconds(totalSnapDurationMs)}</dd></div>
      <div><dt>Total A*</dt><dd>${formatMilliseconds(report.phaseTotals.aStarDurationMs)}</dd></div>
      <div><dt>Total reconstruction</dt><dd>${formatMilliseconds(report.phaseTotals.routeReconstructionDurationMs)}</dd></div>
      <div><dt>Cache hits / misses</dt><dd>${report.phaseTotals.graphCacheHits} / ${report.phaseTotals.graphCacheMisses}</dd></div>
      <div><dt>Wider retries</dt><dd>${report.phaseTotals.retryCount}</dd></div>
      <div><dt>Slowest section</dt><dd>${formatMilliseconds(report.maximumRouteDurationMs)}</dd></div>
      <div><dt>Largest frame delay</dt><dd>${formatMilliseconds(report.maximumFrameDelayMs)}</dd></div>
      <div><dt>Largest long task</dt><dd>${
        !report.longTaskApiSupported
          ? 'not exposed by this browser'
          : report.maximumLongTaskDurationMs === null
            ? 'none observed'
            : formatMilliseconds(report.maximumLongTaskDurationMs)
      }</dd></div>
      <div><dt>First click snapped</dt><dd>${report.firstWaypointSnapped ? 'yes' : 'no'}</dd></div>
    </dl>
    <p class="table-hint">Phase columns are measured inside the routing worker. “Other” includes worker scheduling, structured-clone transfer, and remaining control-flow overhead needed to reconcile them with end-to-end routing duration. Frame delay and long tasks are measured on the map/UI thread.</p>
    <table class="benchmark-table">
      <thead><tr>
        <th>Section</th><th>Distance</th><th>Cache lookup</th><th>Cell access</th>
        <th>Feature merge</th><th>Graph build</th><th>Start snap</th><th>End snap</th>
        <th>A*</th><th>Reconstruct</th><th>Other</th><th>Total routing</th>
        <th>Frame delay</th><th>State commit</th><th>Long task</th><th>Cache H/M</th>
        <th>Attempts</th><th>Retry</th><th>Warm-up cells</th><th>Measured cells</th><th>Result</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>
  `;
}

fileInput.addEventListener('change', () => {
  const fileName = fileInput.files?.[0]?.name ?? 'No file selected';
  fileNameOutput.textContent = fileName;
  fileNameOutput.title = fileName;
  invalidateScenario();
});

strategySelect.addEventListener('change', () => {
  updateStrategyControls();
  invalidateScenario();
});
spacingInput.addEventListener('input', invalidateScenario);
seedInput.addEventListener('input', invalidateScenario);
cacheModeSelect.addEventListener('change', () => {
  currentReport = null;
  exportReportButton.disabled = true;
  reportTab.disabled = true;
  reportOutput.replaceChildren();
  reportEmpty.hidden = false;
  reportEmpty.hidden = false;
  reportTab.disabled = true;
  selectResultTab('scenario');
  if (currentScenario) {
    status.textContent = 'Graph cache mode changed. Run the benchmark again.';
  }
});
updateStrategyControls();

generateButton.addEventListener('click', async () => {
  const file = fileInput.files?.[0];

  if (!file) {
    status.textContent = 'Select a GPX file first.';
    return;
  }

  try {
    status.textContent = 'Reading GPX and generating synthetic clicks…';
    const xml = await file.text();
    currentScenario = createScenarioFromGpx(
      xml,
      file.name,
      selectedStrategy(),
    );
    renderScenario(currentScenario);
    scenarioEmpty.hidden = true;
    selectResultTab('scenario');
    currentReport = null;
    reportOutput.replaceChildren();
    reportEmpty.hidden = false;
    reportTab.disabled = true;
    exportReportButton.disabled = true;
    runButton.disabled = false;
    exportButton.disabled = false;
    status.textContent =
      'Scenario ready. Click “2. Run benchmark” to load routing data and start the measurement.';
  } catch (error) {
    currentScenario = null;
    currentReport = null;
    runButton.disabled = true;
    exportButton.disabled = true;
    exportReportButton.disabled = true;
    reportTab.disabled = true;
    status.textContent = error instanceof Error ? error.message : String(error);
  }
});

runButton.addEventListener('click', async () => {
  if (!currentScenario) {
    return;
  }

  currentAbortController?.abort();
  currentAbortController = new AbortController();
  runButton.disabled = true;
  runButton.textContent = 'Benchmark running…';
  currentReport = null;
  exportReportButton.disabled = true;
  reportTab.disabled = true;
  reportOutput.replaceChildren();
  reportEmpty.hidden = false;
  document.querySelector('.panel')?.setAttribute('aria-busy', 'true');

  try {
    const report = await runRoutingBenchmark(
      currentScenario,
      cacheModeSelect.value as GraphCacheMode,
      currentAbortController.signal,
      (progress) => {
        status.textContent = `${
          progress.phase === 'warmup' ? 'Loading/warming' : 'Measuring'
        } section ${progress.current} of ${progress.total}…`;
      },
    );
    currentReport = report;
    renderReport(report);
    reportEmpty.hidden = true;
    reportTab.disabled = false;
    selectResultTab('report');
    exportReportButton.disabled = false;
    status.textContent = 'Benchmark complete. The report can now be exported as JSON.';
  } catch (error) {
    status.textContent = error instanceof Error ? error.message : String(error);
  } finally {
    runButton.disabled = false;
    runButton.textContent = defaultRunButtonText;
    document.querySelector('.panel')?.removeAttribute('aria-busy');
    currentAbortController = null;
  }
});

/** Downloads a JSON value with a stable scenario-derived filename. */
function downloadJson(data: unknown, filename: string): void {
  const blob = new Blob([JSON.stringify(data, null, 2)], {
    type: 'application/json',
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

/** Produces a filesystem-safe base name without changing the scenario itself. */
function scenarioFileBase(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '') || 'routing-scenario'
  );
}

exportButton.addEventListener('click', () => {
  if (!currentScenario) {
    return;
  }

  downloadJson(
    serializeScenario(currentScenario),
    `${scenarioFileBase(currentScenario.name)}.json`,
  );
});

exportReportButton.addEventListener('click', () => {
  if (!currentReport) {
    return;
  }

  downloadJson(
    {
      schemaVersion: 3,
      exportedAt: new Date().toISOString(),
      environment: {
        userAgent: navigator.userAgent,
        hardwareConcurrency: navigator.hardwareConcurrency ?? null,
        deviceMemoryGb:
          'deviceMemory' in navigator
            ? (navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? null
            : null,
      },
      benchmark: currentReport,
    },
    `${scenarioFileBase(currentReport.scenario.name)}-benchmark.json`,
  );
});
