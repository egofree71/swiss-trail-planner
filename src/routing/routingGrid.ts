/**
 * Business context: converts LV95 coordinates into bounded swissTLM3D routing
 * cells. These pure helpers define the exact first-waypoint footprint and the
 * narrow or widened corridors used by the routing worker.
 */
import type { Coordinate } from 'ol/coordinate.js';
import type { Extent } from 'ol/extent.js';
import { MAX_SNAP_DISTANCE } from './routingConstants';

/** Grid-cell width and height in LV95 metres. */
const CELL_SIZE = 2_400;

/** Stable string key for one EPSG:2056 routing grid cell. */
export type CellKey = `${number}:${number}`;

/** Integer address of a routing grid cell. */
interface CellIndex {
  /** East-west grid column. */
  column: number;
  /** North-south grid row. */
  row: number;
}

/** Serializes a grid address for map and cache keys. */
function cellKey({ column, row }: CellIndex): CellKey {
  return `${column}:${row}`;
}

/** Restores a numeric grid address from its stable cache key. */
function parseCellKey(key: CellKey): CellIndex {
  const [column, row] = key.split(':').map(Number);
  return { column, row };
}

/** Maps an EPSG:2056 coordinate to its containing routing cell. */
function cellForCoordinate(coordinate: Coordinate): CellIndex {
  return {
    column: Math.floor(coordinate[0] / CELL_SIZE),
    row: Math.floor(coordinate[1] / CELL_SIZE),
  };
}

/** Returns the exact EPSG:2056 extent covered by one routing cell. */
function extentForCell(cell: CellIndex): Extent {
  const minX = cell.column * CELL_SIZE;
  const minY = cell.row * CELL_SIZE;
  return [minX, minY, minX + CELL_SIZE, minY + CELL_SIZE];
}

/** Returns the exact LV95 extent represented by a serialized cell key. */
export function extentForCellKey(key: CellKey): Extent {
  return extentForCell(parseCellKey(key));
}

/** Adds a square neighbourhood around one cell to a set of required cells. */
function addExpandedCell(
  cells: Set<CellKey>,
  cell: CellIndex,
  radius: number,
): void {
  for (let columnOffset = -radius; columnOffset <= radius; columnOffset += 1) {
    for (let rowOffset = -radius; rowOffset <= radius; rowOffset += 1) {
      cells.add(
        cellKey({
          column: cell.column + columnOffset,
          row: cell.row + rowOffset,
        }),
      );
    }
  }
}

/**
 * Returns each grid cell crossed by a segment using an integer line walk.
 * Expanding those cells creates a corridor without downloading the complete
 * bounding rectangle between distant waypoints.
 * @param startCoordinate - Segment start in EPSG:2056.
 * @param endCoordinate - Segment end in EPSG:2056.
 * @returns Ordered grid cells crossed from start to end, both included.
 */
function cellsAlongSegment(
  startCoordinate: Coordinate,
  endCoordinate: Coordinate,
): CellIndex[] {
  const start = cellForCoordinate(startCoordinate);
  const end = cellForCoordinate(endCoordinate);
  const cells: CellIndex[] = [];
  let column = start.column;
  let row = start.row;
  const deltaColumn = Math.abs(end.column - start.column);
  const deltaRow = Math.abs(end.row - start.row);
  const stepColumn = start.column < end.column ? 1 : -1;
  const stepRow = start.row < end.row ? 1 : -1;
  let error = deltaColumn - deltaRow;

  while (true) {
    cells.push({ column, row });

    if (column === end.column && row === end.row) {
      break;
    }

    const doubledError = error * 2;

    if (doubledError > -deltaRow) {
      error -= deltaRow;
      column += stepColumn;
    }

    if (doubledError < deltaColumn) {
      error += deltaColumn;
      row += stepRow;
    }
  }

  return cells;
}

/**
 * Returns only cells whose closed extent intersects the maximum snapping box
 * around a first waypoint. This normally yields one cell, two near an edge, or
 * four near a corner.
 * @param coordinate - First route click in EPSG:2056.
 * @returns Cells intersecting the complete closed snapping box.
 */
export function createLocalCellKeys(coordinate: Coordinate): Set<CellKey> {
  const minX = coordinate[0] - MAX_SNAP_DISTANCE;
  const minY = coordinate[1] - MAX_SNAP_DISTANCE;
  const maxX = coordinate[0] + MAX_SNAP_DISTANCE;
  const maxY = coordinate[1] + MAX_SNAP_DISTANCE;

  // The closed box must include both cells when one edge lands exactly on a
  // shared boundary.
  const minColumn = Math.ceil(minX / CELL_SIZE) - 1;
  const minRow = Math.ceil(minY / CELL_SIZE) - 1;
  const maxColumn = Math.floor(maxX / CELL_SIZE);
  const maxRow = Math.floor(maxY / CELL_SIZE);
  const cells = new Set<CellKey>();

  for (let column = minColumn; column <= maxColumn; column += 1) {
    for (let row = minRow; row <= maxRow; row += 1) {
      cells.add(cellKey({ column, row }));
    }
  }

  return cells;
}

/**
 * Creates an expanded routing corridor around cells crossed by a segment.
 * @param startCoordinate - Corridor start in EPSG:2056.
 * @param endCoordinate - Corridor end in EPSG:2056.
 * @param radius - Number of neighbouring cells added on every side.
 * @returns Stable set of required routing-cell keys.
 */
export function createCorridorCellKeys(
  startCoordinate: Coordinate,
  endCoordinate: Coordinate,
  radius: number,
): Set<CellKey> {
  const cells = new Set<CellKey>();

  for (const cell of cellsAlongSegment(startCoordinate, endCoordinate)) {
    addExpandedCell(cells, cell, radius);
  }

  return cells;
}

/**
 * Calculates the outer extent of a non-empty cell set.
 * @param cellKeys - Routing cells whose full bounds must be covered.
 * @returns Combined EPSG:2056 extent.
 */
export function combinedExtent(cellKeys: Set<CellKey>): Extent {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;

  for (const key of cellKeys) {
    const [cellMinX, cellMinY, cellMaxX, cellMaxY] = extentForCell(
      parseCellKey(key),
    );
    minX = Math.min(minX, cellMinX);
    minY = Math.min(minY, cellMinY);
    maxX = Math.max(maxX, cellMaxX);
    maxY = Math.max(maxY, cellMaxY);
  }

  return [minX, minY, maxX, maxY];
}
