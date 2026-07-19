/**
 * Business context: builds an in-browser walking graph from swissTLM3D road
 * geometries and the official hiking-trail overlay. The graph preserves the
 * third coordinate so bridges and tunnels are not connected to roads that only
 * cross them in plan view. It provides snapping and A* routing for route
 * creation without relying on OpenStreetMap or an external routing engine.
 */
import type { Coordinate } from 'ol/coordinate.js';
import type { Extent } from 'ol/extent.js';
import { containsCoordinate } from 'ol/extent.js';
import { MAX_SNAP_DISTANCE } from './routingConstants';
import type {
  SwissTlmLineFeature,
  SwissTlmNetworkData,
  SwissTlmRoadAttributes,
} from './swissTlmApi';

export { MAX_SNAP_DISTANCE } from './routingConstants';

/**
 * Horizontal precision in metres used to merge near-identical vertices.
 * A lower value preserves more detail but creates a larger graph.
 */
const NODE_HORIZONTAL_PRECISION = 0.5;
/**
 * Vertical precision in metres used in node keys so grade-separated crossings
 * remain disconnected.
 */
const NODE_VERTICAL_PRECISION = 2;
/**
 * Maximum distance in metres between a road segment and the hiking overlay for
 * them to be considered the same trail.
 */
const HIKING_MATCH_DISTANCE = 8;
/** Dimensionless lower bound for all routing cost factors, keeping the A* heuristic admissible. */
const MIN_COST_FACTOR = 0.45;
/**
 * Spatial-index bucket width in metres. It limits candidate scans without
 * creating too many buckets.
 */
const SPATIAL_GRID_SIZE = 250;
/** Minimum retained source-segment length in metres; shorter pieces are noise. */
const MIN_SEGMENT_LENGTH = 0.1;
/** Squared distance in square metres below which consecutive route vertices are duplicates. */
const DUPLICATE_COORDINATE_DISTANCE_SQUARED = 0.01;
/** Minimum absolute cosine similarity for two segments to count as parallel. */
const MIN_DIRECTION_COSINE = 0.7;
/** Interior fractions sampled when matching roads with the hiking overlay. */
const HIKING_SAMPLE_FRACTIONS = [0.25, 0.5, 0.75] as const;

/** swissTLM3D object-type codes that must never enter the pedestrian graph. */
const NON_WALKABLE_OBJECT_TYPES = new Set([
  0, // motorway exit
  1, // motorway entrance
  2, // motorway
  3, // motorway service area
  5, // motorway access connection
  6, // service access
  13, // car shuttle
  14, // ferry
  21, // expressway
  22, // via ferrata
]);

/** Node in the immutable routing graph. */
interface GraphNode {
  /** Stable array index used by graph edges and A*. */
  id: number;
  /** swissTLM3D coordinate in the map projection, including elevation when available. */
  coordinate: Coordinate;
  /** Outgoing traversable edges; the current pedestrian graph adds both directions. */
  edges: GraphEdge[];
}

/** Lightweight adjacency-list edge used during path search. */
interface GraphEdge {
  /** Destination node identifier. */
  to: number;
  /** Weighted traversal cost in metre-equivalent units. */
  cost: number;
}

/** Geometric road segment retained for snapping and route reconstruction. */
interface NetworkSegment {
  /** Stable segment identifier inside one RoutingNetwork instance. */
  id: number;
  /** Identifier of the segment's first graph node. */
  startNodeId: number;
  /** Identifier of the segment's second graph node. */
  endNodeId: number;
  /** First segment coordinate in map units, optionally including elevation. */
  start: Coordinate;
  /** Second segment coordinate in map units, optionally including elevation. */
  end: Coordinate;
  /** Horizontal segment length in metres. */
  distance: number;
  /** Weighted bidirectional traversal cost in metre-equivalent units. */
  cost: number;
  /** Whether the road segment matches the official hiking-trail portrayal. */
  isHikingTrail: boolean;
}

/** Result of projecting a user coordinate onto the nearest network segment. */
interface SnapResult {
  /** Projected point on the segment, with interpolated elevation when available. */
  coordinate: Coordinate;
  /** Horizontal distance in metres from the original point to the projection. */
  distance: number;
  /** Network segment that receives the projected point. */
  segment: NetworkSegment;
  /** Relative position on the segment: 0 at the start and 1 at the end. */
  fraction: number;
}

/** Entry stored in the A* priority queue. */
interface QueueEntry {
  /** Graph node being considered. */
  nodeId: number;
  /** Best known cost from the snapped start to this node. */
  distance: number;
  /** A* score: known cost plus the admissible remaining-distance estimate. */
  priority: number;
}

/** Pair of coordinates representing one indexed line segment. */
type LineSegment = readonly [Coordinate, Coordinate];

/**
 * Routed geometry returned to the route editor.
 *
 * Keep this contract structured-clone-safe and independent from OpenLayers
 * classes because it crosses the dedicated Worker boundary.
 */
export interface RoutedNetworkPath {
  /** Ordered coordinates from the snapped start to the snapped destination. */
  coordinates: Coordinate[];
  /** Distance in metres between the requested start and its snapped position. */
  snapDistanceStart: number;
  /** Distance in metres between the requested end and its snapped position. */
  snapDistanceEnd: number;
}

/** Diagnostics describing the graph created from one swissTLM3D data set. */
export interface RoutingNetworkStats {
  /** Number of source road features received from GeoAdmin. */
  roadFeatures: number;
  /** Number of source hiking-overlay features received from GeoAdmin. */
  hikingFeatures: number;
  /** Number of unique 3D graph nodes. */
  nodes: number;
  /** Number of retained walkable segments. */
  segments: number;
  /** Number of retained segments classified as official hiking trails. */
  hikingSegments: number;
}

/**
 * Minimal binary min-heap used by A*.
 *
 * Queue entries are ordered by their `priority`, not by travelled distance,
 * because A* must expand the most promising node first.
 */
class MinHeap {
  private readonly entries: QueueEntry[] = [];

  get size(): number {
    return this.entries.length;
  }

  /** Inserts an A* queue entry while preserving the heap invariant. */
  push(entry: QueueEntry): void {
    let index = this.entries.length;

    // Bubble the new entry upward so the cheapest estimated route stays at the root.

    while (index > 0) {
      const parentIndex = Math.floor((index - 1) / 2);
      const parent = this.entries[parentIndex];

      if (parent.priority <= entry.priority) {
        break;
      }

      this.entries[index] = parent;
      index = parentIndex;
    }

    this.entries[index] = entry;
  }

  /** Removes the entry with the lowest A* priority. */
  pop(): QueueEntry | undefined {
    if (this.entries.length === 0) {
      return undefined;
    }

    const first = this.entries[0];
    const last = this.entries.pop();

    if (!last || this.entries.length === 0) {
      return first;
    }

    let index = 0;

    // Move the former last entry downward to restore the heap after removing the root.
    while (true) {
      const leftIndex = index * 2 + 1;

      if (leftIndex >= this.entries.length) {
        break;
      }

      const rightIndex = leftIndex + 1;
      let childIndex = leftIndex;

      if (
        rightIndex < this.entries.length &&
        this.entries[rightIndex].priority <
          this.entries[leftIndex].priority
      ) {
        childIndex = rightIndex;
      }

      if (this.entries[childIndex].priority >= last.priority) {
        break;
      }

      this.entries[index] = this.entries[childIndex];
      index = childIndex;
    }

    this.entries[index] = last;
    return first;
  }
}

/**
 * Uniform spatial index for coarse candidate filtering.
 *
 * Items may appear in several buckets when their bounding box spans cell
 * boundaries; `query()` deduplicates them before returning candidates.
 */
class SpatialGrid<T> {
  private readonly buckets = new Map<string, T[]>();

  /** Adds an item to every grid bucket touched by its bounding box. */
  insert(
    item: T,
    minX: number,
    minY: number,
    maxX: number,
    maxY: number,
  ): void {
    const minColumn = Math.floor(minX / SPATIAL_GRID_SIZE);
    const maxColumn = Math.floor(maxX / SPATIAL_GRID_SIZE);
    const minRow = Math.floor(minY / SPATIAL_GRID_SIZE);
    const maxRow = Math.floor(maxY / SPATIAL_GRID_SIZE);

    for (let column = minColumn; column <= maxColumn; column += 1) {
      for (let row = minRow; row <= maxRow; row += 1) {
        const key = `${column}:${row}`;
        const bucket = this.buckets.get(key);

        if (bucket) {
          bucket.push(item);
        } else {
          this.buckets.set(key, [item]);
        }
      }
    }
  }

  /** Returns unique items whose buckets intersect the requested extent. */
  query(
    minX: number,
    minY: number,
    maxX: number,
    maxY: number,
  ): Set<T> {
    const items = new Set<T>();
    const minColumn = Math.floor(minX / SPATIAL_GRID_SIZE);
    const maxColumn = Math.floor(maxX / SPATIAL_GRID_SIZE);
    const minRow = Math.floor(minY / SPATIAL_GRID_SIZE);
    const maxRow = Math.floor(maxY / SPATIAL_GRID_SIZE);

    for (let column = minColumn; column <= maxColumn; column += 1) {
      for (let row = minRow; row <= maxRow; row += 1) {
        for (const item of this.buckets.get(`${column}:${row}`) ?? []) {
          items.add(item);
        }
      }
    }

    return items;
  }
}

function coordinateDistanceSquared(
  first: Coordinate,
  second: Coordinate,
): number {
  const deltaX = first[0] - second[0];
  const deltaY = first[1] - second[1];
  return deltaX * deltaX + deltaY * deltaY;
}

function coordinateDistance(
  first: Coordinate,
  second: Coordinate,
): number {
  return Math.sqrt(coordinateDistanceSquared(first, second));
}

/**
 * Creates a quantized 3D key for merging swissTLM3D vertices into graph nodes.
 * @param coordinate - Coordinate in EPSG:2056 with optional elevation in metres.
 * @returns A stable key at the configured horizontal and vertical precision.
 */
function nodeKey(coordinate: Coordinate): string {
  const horizontalKey = `${Math.round(
    coordinate[0] / NODE_HORIZONTAL_PRECISION,
  )}:${Math.round(coordinate[1] / NODE_HORIZONTAL_PRECISION)}`;
  const elevation = coordinate[2];

  /*
   * swissTLM3D is three-dimensional. Keeping an elevation component in the
   * node key avoids joining a bridge to a road that merely crosses below it.
   */
  return Number.isFinite(elevation)
    ? `${horizontalKey}:${Math.round(elevation / NODE_VERTICAL_PRECISION)}`
    : `${horizontalKey}:2d`;
}

function segmentKey(startNodeId: number, endNodeId: number): string {
  return startNodeId < endNodeId
    ? `${startNodeId}:${endNodeId}`
    : `${endNodeId}:${startNodeId}`;
}

/**
 * Projects a point onto a finite segment in the horizontal plane and
 * interpolates elevation when both endpoints provide it.
 * @param coordinate - Point to project, in map coordinates.
 * @param start - First segment coordinate.
 * @param end - Second segment coordinate.
 * @returns The projected coordinate, its 0..1 segment fraction, and squared
 * horizontal distance in square metres.
 */
function projectOnSegment(
  coordinate: Coordinate,
  start: Coordinate,
  end: Coordinate,
): { coordinate: Coordinate; fraction: number; distanceSquared: number } {
  const deltaX = end[0] - start[0];
  const deltaY = end[1] - start[1];
  const lengthSquared = deltaX * deltaX + deltaY * deltaY;

  if (lengthSquared === 0) {
    return {
      coordinate: [...start],
      fraction: 0,
      distanceSquared: coordinateDistanceSquared(coordinate, start),
    };
  }

  const fraction = Math.max(
    0,
    Math.min(
      1,
      ((coordinate[0] - start[0]) * deltaX +
        (coordinate[1] - start[1]) * deltaY) /
        lengthSquared,
    ),
  );
  const projectedCoordinate: Coordinate = [
    start[0] + fraction * deltaX,
    start[1] + fraction * deltaY,
  ];

  if (Number.isFinite(start[2]) && Number.isFinite(end[2])) {
    projectedCoordinate.push(start[2] + fraction * (end[2] - start[2]));
  }

  return {
    coordinate: projectedCoordinate,
    fraction,
    distanceSquared: coordinateDistanceSquared(
      coordinate,
      projectedCoordinate,
    ),
  };
}

function pointToSegmentDistanceSquared(
  coordinate: Coordinate,
  start: Coordinate,
  end: Coordinate,
): number {
  return projectOnSegment(coordinate, start, end).distanceSquared;
}

/**
 * Converts swissTLM3D road attributes into a pedestrian routing preference.
 * Lower factors are preferred by A*, while major roads receive penalties.
 * @param attributes - Normalized road type, access, surface, and importance codes.
 * @param isHikingTrail - Whether the segment matches an official hiking trail.
 * @returns A factor greater than zero, or `Infinity` when pedestrians must not use the segment.
 */
function roadCostFactor(
  attributes: SwissTlmRoadAttributes,
  isHikingTrail: boolean,
): number {
  const objectType = attributes.objectType;
  const restriction = attributes.restriction;
  const importance = attributes.importance;

  // Hard exclusions take precedence over every preference so A* never trades
  // safety or legal access for a shorter route.
  if (
    (objectType !== undefined &&
      NON_WALKABLE_OBJECT_TYPES.has(objectType)) ||
    restriction === 2_000 ||
    importance === 100
  ) {
    return Number.POSITIVE_INFINITY;
  }

  // Unknown ordinary roads remain usable with a slight penalty instead of
  // fragmenting the graph when an optional attribute is absent.
  let factor = 1.25;

  switch (objectType) {
    case 16: // 1 m path
    case 17: // isolated 1 m path fragment
    case 19: // marked trace
      factor = 0.9;
      break;
    case 15: // 2 m path
    case 18: // isolated 2 m path fragment
      factor = 0.96;
      break;
    case 11: // 3 m road
      factor = 1.05;
      break;
    case 10: // 4 m road
      factor = 1.18;
      break;
    case 12: // traffic area axis
      factor = 1.15;
      break;
    case 9: // 6 m road
      factor = 1.65;
      break;
    case 8: // 10 m road
    case 20: // 8 m road
      factor = 2.5;
      break;
    case 4: // virtual network connection
      factor = 1.4;
      break;
    case 23: // provisional slow-traffic axis
      factor = 1;
      break;
  }

  // Pedestrian-oriented restrictions usually identify quieter, more suitable
  // links, so they receive a moderate preference.
  if ([300, 400, 1_000, 1_200].includes(restriction ?? -1)) {
    factor *= 0.82;
  }

  // Network importance penalizes major roads without disconnecting places that
  // can only be reached through them.
  if (importance === 200) {
    factor *= 1.7;
  } else if (importance === 300) {
    factor *= 1.25;
  }

  // Surface is only a small tie-breaker; it must not outweigh access, road type,
  // or official hiking status.
  if (attributes.surface === 200) {
    factor *= 0.94;
  } else if (attributes.surface === 100) {
    factor *= 1.04;
  }

  // Official hiking trails are strongly preferred, but never resurrect a hard-
  // excluded segment because exclusions returned above.
  if (isHikingTrail) {
    factor *= 0.72;
  }

  return factor;
}

/**
 * Builds a spatial index of the rendered hiking-trail geometries used to enrich
 * road segments that do not carry the same attributes directly.
 * @param features - Official hiking-trail line features.
 * @returns An index of individual hiking line segments.
 */
function createHikingSegmentIndex(
  features: SwissTlmLineFeature[],
): SpatialGrid<LineSegment> {
  const index = new SpatialGrid<LineSegment>();

  for (const feature of features) {
    for (const line of feature.lines) {
      for (let vertexIndex = 1; vertexIndex < line.length; vertexIndex += 1) {
        const segment: LineSegment = [
          line[vertexIndex - 1],
          line[vertexIndex],
        ];
        const [start, end] = segment;

        index.insert(
          segment,
          Math.min(start[0], end[0]) - HIKING_MATCH_DISTANCE,
          Math.min(start[1], end[1]) - HIKING_MATCH_DISTANCE,
          Math.max(start[0], end[0]) + HIKING_MATCH_DISTANCE,
          Math.max(start[1], end[1]) + HIKING_MATCH_DISTANCE,
        );
      }
    }
  }

  return index;
}

/**
 * Tests whether two segments are roughly parallel, independent of direction.
 * @returns `true` when the absolute cosine similarity is at least 0.7.
 */
function segmentsHaveSimilarDirection(
  firstStart: Coordinate,
  firstEnd: Coordinate,
  secondStart: Coordinate,
  secondEnd: Coordinate,
): boolean {
  const firstX = firstEnd[0] - firstStart[0];
  const firstY = firstEnd[1] - firstStart[1];
  const secondX = secondEnd[0] - secondStart[0];
  const secondY = secondEnd[1] - secondStart[1];
  const denominator =
    Math.hypot(firstX, firstY) * Math.hypot(secondX, secondY);

  if (denominator === 0) {
    return false;
  }

  return (
    Math.abs(firstX * secondX + firstY * secondY) / denominator >=
    MIN_DIRECTION_COSINE
  );
}

/**
 * Classifies a road segment by comparing several interior samples with nearby
 * hiking-overlay segments. Requiring multiple aligned samples avoids marking a
 * road as a hiking trail merely because the two layers cross once.
 * @param start - First road-segment coordinate.
 * @param end - Second road-segment coordinate.
 * @param hikingSegmentIndex - Spatial index of official hiking geometries.
 * @returns `true` when at least two of three samples match in distance and direction.
 */
function isHikingSegment(
  start: Coordinate,
  end: Coordinate,
  hikingSegmentIndex: SpatialGrid<LineSegment>,
): boolean {
  const thresholdSquared = HIKING_MATCH_DISTANCE * HIKING_MATCH_DISTANCE;

  // Interior samples are more reliable than endpoints, which often meet several unrelated ways.
  const samples = HIKING_SAMPLE_FRACTIONS.map(
    (fraction): Coordinate => [
      start[0] + (end[0] - start[0]) * fraction,
      start[1] + (end[1] - start[1]) * fraction,
    ],
  );
  let matchingSamples = 0;

  for (const sample of samples) {
    const candidates = hikingSegmentIndex.query(
      sample[0] - HIKING_MATCH_DISTANCE,
      sample[1] - HIKING_MATCH_DISTANCE,
      sample[0] + HIKING_MATCH_DISTANCE,
      sample[1] + HIKING_MATCH_DISTANCE,
    );

    for (const [hikingStart, hikingEnd] of candidates) {
      if (
        segmentsHaveSimilarDirection(start, end, hikingStart, hikingEnd) &&
        pointToSegmentDistanceSquared(sample, hikingStart, hikingEnd) <=
          thresholdSquared
      ) {
        matchingSamples += 1;
        break;
      }
    }
  }

  return matchingSamples >= 2;
}

/** Appends a coordinate unless it would create a sub-decimetre duplicate vertex. */
function appendCoordinate(
  coordinates: Coordinate[],
  coordinate: Coordinate,
): void {
  const previousCoordinate = coordinates[coordinates.length - 1];

  if (
    !previousCoordinate ||
    coordinateDistanceSquared(previousCoordinate, coordinate) >
      DUPLICATE_COORDINATE_DISTANCE_SQUARED
  ) {
    coordinates.push([...coordinate]);
  }
}

/**
 * Signals that the loaded cells contain no swissTLM3D segment usable by the
 * pedestrian graph. Callers may treat this as missing coverage rather than a
 * transport or parsing failure.
 */
export class NoWalkableNetworkError extends Error {
  constructor() {
    super('No walkable swissTLM3D segments could be built.');
    this.name = 'NoWalkableNetworkError';
  }
}

/**
 * Immutable pedestrian routing graph built from swissTLM3D data.
 *
 * Instances must be created with `RoutingNetwork.fromSwissTlm()` so node
 * quantization, walkability filtering, segment indexing, and adjacency lists
 * are completed consistently before `snap()` or `route()` can be called.
 */
export class RoutingNetwork {
  readonly stats: RoutingNetworkStats;
  private readonly segmentIndex = new SpatialGrid<NetworkSegment>();

  private constructor(
    private readonly extent: Extent,
    private readonly nodes: GraphNode[],
    private readonly segments: NetworkSegment[],
    stats: RoutingNetworkStats,
  ) {
    this.stats = stats;

    for (const segment of segments) {
      this.segmentIndex.insert(
        segment,
        Math.min(segment.start[0], segment.end[0]),
        Math.min(segment.start[1], segment.end[1]),
        Math.max(segment.start[0], segment.end[0]),
        Math.max(segment.start[1], segment.end[1]),
      );
    }
  }

  /**
   * Builds a routable graph from road geometries and the hiking overlay.
   * @param extent - Loaded network extent in EPSG:2056 map coordinates.
   * @param data - Normalized swissTLM3D road and hiking features.
   * @returns A fully indexed immutable routing network.
   * @throws {NoWalkableNetworkError} When no walkable segment can be produced from the supplied data.
   */
  static fromSwissTlm(
    extent: Extent,
    data: SwissTlmNetworkData,
  ): RoutingNetwork {
    const nodeIds = new Map<string, number>();
    const nodes: GraphNode[] = [];
    const segmentCandidates = new Map<string, NetworkSegment>();
    const hikingSegmentIndex = createHikingSegmentIndex(data.hikingTrails);

    // Centralizing node creation guarantees that every quantized 3D key maps to one graph node.
    const getNodeId = (coordinate: Coordinate): number => {
      const key = nodeKey(coordinate);
      const existingNodeId = nodeIds.get(key);

      if (existingNodeId !== undefined) {
        return existingNodeId;
      }

      const nodeId = nodes.length;
      nodeIds.set(key, nodeId);
      nodes.push({
        id: nodeId,
        coordinate: [...coordinate],
        edges: [],
      });
      return nodeId;
    };

    // Consecutive source vertices become graph edges. Arbitrary 2D crossings
    // are deliberately not split, preserving swissTLM3D bridge/tunnel topology.
    for (const feature of data.roads) {
      for (const line of feature.lines) {
        for (let vertexIndex = 1; vertexIndex < line.length; vertexIndex += 1) {
          const start = line[vertexIndex - 1];
          const end = line[vertexIndex];
          const distance = coordinateDistance(start, end);

          if (distance < MIN_SEGMENT_LENGTH) {
            continue;
          }

          const startNodeId = getNodeId(start);
          const endNodeId = getNodeId(end);

          if (startNodeId === endNodeId) {
            continue;
          }

          const hikingTrail = isHikingSegment(
            start,
            end,
            hikingSegmentIndex,
          );
          const factor = roadCostFactor(feature.attributes, hikingTrail);

          if (!Number.isFinite(factor)) {
            continue;
          }

          const candidate: NetworkSegment = {
            id: -1,
            startNodeId,
            endNodeId,
            start: nodes[startNodeId].coordinate,
            end: nodes[endNodeId].coordinate,
            distance,
            cost: distance * factor,
            isHikingTrail: hikingTrail,
          };
          const key = segmentKey(startNodeId, endNodeId);
          const existingCandidate = segmentCandidates.get(key);

          // Overlapping source features can describe the same endpoints.
          // Retain the most walkable interpretation.
          if (!existingCandidate || candidate.cost < existingCandidate.cost) {
            segmentCandidates.set(key, candidate);
          }
        }
      }
    }

    const segments = [...segmentCandidates.values()].map(
      (segment, index): NetworkSegment => ({ ...segment, id: index }),
    );

    // Walking is currently allowed in both directions because no one-way
    // pedestrian restriction is modelled yet.
    for (const segment of segments) {
      nodes[segment.startNodeId].edges.push({
        to: segment.endNodeId,
        cost: segment.cost,
      });
      nodes[segment.endNodeId].edges.push({
        to: segment.startNodeId,
        cost: segment.cost,
      });
    }

    if (segments.length === 0) {
      throw new NoWalkableNetworkError();
    }

    return new RoutingNetwork(extent, nodes, segments, {
      roadFeatures: data.roads.length,
      hikingFeatures: data.hikingTrails.length,
      nodes: nodes.length,
      segments: segments.length,
      hikingSegments: segments.filter((segment) => segment.isHikingTrail)
        .length,
    });
  }

  /** Returns whether a coordinate lies inside the data extent used to build this graph. */
  contains(coordinate: Coordinate): boolean {
    return containsCoordinate(this.extent, coordinate);
  }

  /**
   * Snaps a coordinate to the closest walkable segment.
   * @param coordinate - User-selected point in EPSG:2056.
   * @returns The projected network coordinate, or `null` outside the extent or snap tolerance.
   */
  snap(coordinate: Coordinate): Coordinate | null {
    return this.findSnap(coordinate)?.coordinate ?? null;
  }

  /**
   * Calculates the least-cost route between two coordinates with A*.
   * Both endpoints are first snapped to nearby segments, and partial-segment
   * costs are included so the search remains accurate between graph nodes.
   * @param startCoordinate - Requested route start in EPSG:2056.
   * @param endCoordinate - Requested route destination in EPSG:2056.
   * @returns Routed geometry and snap distances, or `null` when snapping or connectivity fails.
   */
  route(
    startCoordinate: Coordinate,
    endCoordinate: Coordinate,
  ): RoutedNetworkPath | null {
    const startSnap = this.findSnap(startCoordinate);

    const endSnap = this.findSnap(endCoordinate);

    if (!startSnap || !endSnap) {
      return null;
    }

    // A same-segment route is both a valid result and an upper bound for pruning A*.
    const directPath = this.routeOnSameSegment(startSnap, endSnap);

    // A snapped point can reach either endpoint of its host segment at a proportional partial cost.
    const startCandidates = new Map<number, number>([
      [
        startSnap.segment.startNodeId,
        startSnap.segment.cost * startSnap.fraction,
      ],
      [
        startSnap.segment.endNodeId,
        startSnap.segment.cost * (1 - startSnap.fraction),
      ],
    ]);
    // Destination endpoint costs are evaluated when A* reaches either end of the target segment.
    const endCandidates = new Map<number, number>([
      [
        endSnap.segment.startNodeId,
        endSnap.segment.cost * endSnap.fraction,
      ],
      [
        endSnap.segment.endNodeId,
        endSnap.segment.cost * (1 - endSnap.fraction),
      ],
    ]);
    const queue = new MinHeap();
    const distances = new Map<number, number>();
    const previousNodes = new Map<number, number>();

    // Seed both exits from the start segment. The heuristic is straight-line
    // distance multiplied by a proven lower bound for all routing costs.
    for (const [nodeId, distance] of startCandidates) {
      const existingDistance = distances.get(nodeId);

      if (existingDistance === undefined || distance < existingDistance) {
        distances.set(nodeId, distance);
        queue.push({
          nodeId,
          distance,
          priority:
            distance +
            coordinateDistance(
              this.nodes[nodeId].coordinate,
              endSnap.coordinate,
            ) *
              MIN_COST_FACTOR,
        });
      }
    }

    // bestCost lets the search stop once every queued estimate is no better
    // than a complete route already found.
    let bestCost = directPath?.cost ?? Number.POSITIVE_INFINITY;
    let bestGoalNodeId: number | null = null;

    while (queue.size > 0) {
      const current = queue.pop();

      if (!current) {
        break;
      }

      // Multiple heap entries can exist for one node; ignore entries superseded by a cheaper route.
      if (current.distance !== distances.get(current.nodeId)) {
        continue;
      }

      // The heap is ordered by admissible priority, so no later entry can
      // improve the best complete route.
      if (current.priority >= bestCost) {
        break;
      }

      // Reaching a destination-segment endpoint completes the route after
      // paying its remaining partial cost.
      const endCost = endCandidates.get(current.nodeId);

      if (endCost !== undefined && current.distance + endCost < bestCost) {
        bestCost = current.distance + endCost;
        bestGoalNodeId = current.nodeId;
      }

      for (const edge of this.nodes[current.nodeId].edges) {
        const distance = current.distance + edge.cost;

        if (distance >= (distances.get(edge.to) ?? Number.POSITIVE_INFINITY)) {
          continue;
        }

        distances.set(edge.to, distance);
        previousNodes.set(edge.to, current.nodeId);
        // Priority combines known cost with the optimistic remaining cost used by A*.
        queue.push({
          nodeId: edge.to,
          distance,
          priority:
            distance +
            coordinateDistance(
              this.nodes[edge.to].coordinate,
              endSnap.coordinate,
            ) *
              MIN_COST_FACTOR,
        });
      }
    }

    if (directPath && bestGoalNodeId === null) {
      const result = {
        coordinates: directPath.coordinates,
        snapDistanceStart: startSnap.distance,
        snapDistanceEnd: endSnap.distance,
      };

      return result;
    }

    if (bestGoalNodeId === null) {
      return null;
    }

    // Reconstruct the graph-node sequence backwards from the best destination endpoint.
    const nodePath: number[] = [];
    let nodeId: number | undefined = bestGoalNodeId;

    while (nodeId !== undefined) {
      nodePath.push(nodeId);
      nodeId = previousNodes.get(nodeId);
    }

    nodePath.reverse();

    const coordinates: Coordinate[] = [];
    appendCoordinate(coordinates, startSnap.coordinate);

    for (const pathNodeId of nodePath) {
      appendCoordinate(coordinates, this.nodes[pathNodeId].coordinate);
    }

    appendCoordinate(coordinates, endSnap.coordinate);

    const result = {
      coordinates,
      snapDistanceStart: startSnap.distance,
      snapDistanceEnd: endSnap.distance,
    };

    return result;
  }

  /**
   * Finds the closest segment projection using the spatial grid before exact distance tests.
   * @returns Detailed snap metadata, or `null` when no segment is close enough.
   */
  private findSnap(coordinate: Coordinate): SnapResult | null {
    if (!this.contains(coordinate)) {
      return null;
    }

    const candidates = this.segmentIndex.query(
      coordinate[0] - MAX_SNAP_DISTANCE,
      coordinate[1] - MAX_SNAP_DISTANCE,
      coordinate[0] + MAX_SNAP_DISTANCE,
      coordinate[1] + MAX_SNAP_DISTANCE,
    );
    let closest:
      | {
          segment: NetworkSegment;
          coordinate: Coordinate;
          fraction: number;
          distanceSquared: number;
        }
      | undefined;

    for (const segment of candidates) {
      const projection = projectOnSegment(
        coordinate,
        segment.start,
        segment.end,
      );

      if (!closest || projection.distanceSquared < closest.distanceSquared) {
        closest = {
          segment,
          coordinate: projection.coordinate,
          fraction: projection.fraction,
          distanceSquared: projection.distanceSquared,
        };
      }
    }

    if (
      !closest ||
      closest.distanceSquared > MAX_SNAP_DISTANCE * MAX_SNAP_DISTANCE
    ) {
      return null;
    }

    return {
      coordinate: closest.coordinate,
      distance: Math.sqrt(closest.distanceSquared),
      segment: closest.segment,
      fraction: closest.fraction,
    };
  }

  /** Returns the direct partial-segment route when both snapped points share one segment. */
  private routeOnSameSegment(
    start: SnapResult,
    end: SnapResult,
  ): { coordinates: Coordinate[]; cost: number } | null {
    if (start.segment.id !== end.segment.id) {
      return null;
    }

    return {
      coordinates: [start.coordinate, end.coordinate],
      cost: Math.abs(start.fraction - end.fraction) * start.segment.cost,
    };
  }
}
