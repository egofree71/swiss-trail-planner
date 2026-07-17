/**
 * Business context: normalizes cancellation checks for the browser requests
 * coordinated by Via Helvetica. Route, information-layer, and profile workflows
 * all use AbortController, and intentional cancellation must not surface as an
 * application error when a newer map action replaces an older request.
 */

/**
 * Tests whether an abortable browser request ended through normal cancellation.
 *
 * @param error - Value rejected by the underlying fetch or async workflow.
 * @param signal - Signal that owns the request being inspected.
 * @returns `true` when the signal was aborted or the browser reported AbortError.
 */
export function isAbortedRequest(
  error: unknown,
  signal: AbortSignal,
): boolean {
  return (
    signal.aborted ||
    (error instanceof DOMException && error.name === 'AbortError')
  );
}
