/**
 * Public facade for editable-route map primitives.
 *
 * Rendering and pointer interaction live in separate modules, while existing
 * callers keep one stable import path. New low-level code should import the
 * focused module directly when that makes the dependency clearer.
 */
export {
  createRouteDisplay,
  updateRouteDisplay,
  updateRouteInsertionDragPreview,
  updateRouteWaypointDragPreview,
  type RouteDisplay,
} from './routeDisplay';
export {
  clearRouteDragCursor,
  createRouteDragInteraction,
  getRouteSegmentHitAtPixel,
  getRouteWaypointIndexAtPixel,
  type RouteDragCallbacks,
  type RouteDragTarget,
  type RouteHoverTarget,
  type RouteSegmentHit,
} from './routePointerInteraction';
