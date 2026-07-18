/**
 * Business context: centralizes routing values shared by the main-thread client,
 * the routing worker, and pure cell-selection helpers. Keeping the snapping
 * radius outside the graph implementation avoids pulling the full router into
 * the application bundle only to calculate a first-waypoint cell footprint.
 */

/**
 * Maximum user-to-network snapping distance in metres. Larger values may
 * attach a waypoint to an unrelated road.
 */
export const MAX_SNAP_DISTANCE = 260;
