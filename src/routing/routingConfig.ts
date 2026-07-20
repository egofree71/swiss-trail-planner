/**
 * Business context: exposes the one local-development switch needed to verify
 * roads-only routing without waiting for GeoAdmin's optional hiking-layer
 * identify behavior to fail naturally. Deployed builds always request hiking
 * enrichment regardless of this local test value.
 */

/** Local-only routing choices used while the application runs on this machine. */
export interface LocalRoutingDevelopmentConfig {
  /**
   * Whether local routing requests include optional hiking geometry.
   * Set to `false` to exercise the session notice and roads-only fallback while
   * keeping the rendered hiking-trail map overlay unchanged.
   */
  useHikingEnrichment: boolean;
}

/**
 * Manually editable development configuration.
 * Restart the Vite development server after changing this value.
 */
export const LOCAL_ROUTING_DEVELOPMENT_CONFIG: LocalRoutingDevelopmentConfig = {
  useHikingEnrichment: true,
};

/** Hostnames treated as the developer's local machine. */
const LOCAL_DEVELOPMENT_HOSTNAMES = new Set([
  'localhost',
  '127.0.0.1',
  '::1',
  '[::1]',
]);

/**
 * Resolves whether optional hiking geometry should be requested.
 *
 * @param hostname - Current page or Worker hostname.
 * @param localConfig - Local setting, injectable so the safety rule is testable.
 * @returns The local setting on localhost; always `true` on deployed hosts.
 */
export function shouldUseHikingEnrichment(
  hostname: string,
  localConfig: LocalRoutingDevelopmentConfig =
    LOCAL_ROUTING_DEVELOPMENT_CONFIG,
): boolean {
  if (!LOCAL_DEVELOPMENT_HOSTNAMES.has(hostname.toLowerCase())) {
    // A forgotten local test value must never disable hiking enrichment in the
    // deployed GitHub Pages application.
    return true;
  }

  return localConfig.useHikingEnrichment;
}
