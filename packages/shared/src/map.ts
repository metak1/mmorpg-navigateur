export enum TileType {
  Grass = 0,
  Path = 1,
  Water = 2,
  Wall = 3,
}

export interface TileGrid {
  tileData: number[][];
  tileSize: number;
  cols: number;
  rows: number;
}

function buildDefaultMapData(cols: number, rows: number): number[][] {
  const grid: number[][] = [];

  for (let row = 0; row < rows; row++) {
    const line: number[] = [];
    for (let col = 0; col < cols; col++) {
      const isBorder = row === 0 || row === rows - 1 || col === 0 || col === cols - 1;
      line.push(isBorder ? TileType.Wall : TileType.Grass);
    }
    grid.push(line);
  }

  // horizontal path through the middle
  for (let col = 1; col < cols - 1; col++) {
    grid[9][col] = TileType.Path;
  }

  // small pond
  for (let row = 3; row <= 5; row++) {
    for (let col = 5; col <= 8; col++) {
      grid[row][col] = TileType.Water;
    }
  }

  // standalone obstacles
  grid[12][15] = TileType.Wall;
  grid[12][16] = TileType.Wall;
  grid[13][15] = TileType.Wall;
  grid[5][18] = TileType.Wall;

  return grid;
}

// These DEFAULT_* values are seed data for prisma/seed.ts (the initial map
// content) — the running game always loads its map from the database via
// the content backend, never from these constants directly.
export const DEFAULT_TILE_SIZE = 32;
export const DEFAULT_MAP_COLS = 25;
export const DEFAULT_MAP_ROWS = 18;
export const DEFAULT_MAP_DATA: number[][] = buildDefaultMapData(DEFAULT_MAP_COLS, DEFAULT_MAP_ROWS);
export const DEFAULT_SPAWN_X = 12 * DEFAULT_TILE_SIZE + DEFAULT_TILE_SIZE / 2;
export const DEFAULT_SPAWN_Y = 9 * DEFAULT_TILE_SIZE + DEFAULT_TILE_SIZE / 2;

export function isWalkable(tileType: number): boolean {
  return tileType !== TileType.Wall && tileType !== TileType.Water;
}

export function getTileAt(grid: TileGrid, xPixel: number, yPixel: number): number {
  const col = Math.floor(xPixel / grid.tileSize);
  const row = Math.floor(yPixel / grid.tileSize);
  if (row < 0 || row >= grid.rows || col < 0 || col >= grid.cols) return TileType.Wall;
  return grid.tileData[row][col];
}

// Collision box half-extent, deliberately smaller than the 24px player
// sprite so movement near walls still feels fair rather than snagging early.
const PLAYER_HALF_SIZE = 10;

function isBlockedAt(grid: TileGrid, x: number, y: number): boolean {
  const corners: Array<[number, number]> = [
    [x - PLAYER_HALF_SIZE, y - PLAYER_HALF_SIZE],
    [x + PLAYER_HALF_SIZE, y - PLAYER_HALF_SIZE],
    [x - PLAYER_HALF_SIZE, y + PLAYER_HALF_SIZE],
    [x + PLAYER_HALF_SIZE, y + PLAYER_HALF_SIZE],
  ];
  return corners.some(([cx, cy]) => !isWalkable(getTileAt(grid, cx, cy)));
}

// Samples points along the segment at a quarter-tile step (fine enough to
// never skip over a grid-aligned wall cell) and checks each is walkable.
// Used to require line-of-sight before a targeted spell is allowed to land —
// a wall between caster and target blocks it, the same as it blocks a
// projectile physically flying into one (see WorldRoom.updateProjectiles).
export function hasLineOfSight(grid: TileGrid, x1: number, y1: number, x2: number, y2: number): boolean {
  const dist = Math.hypot(x2 - x1, y2 - y1);
  if (dist === 0) return true;

  const step = grid.tileSize / 4;
  const steps = Math.ceil(dist / step);
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const x = x1 + (x2 - x1) * t;
    const y = y1 + (y2 - y1) * t;
    if (!isWalkable(getTileAt(grid, x, y))) return false;
  }
  return true;
}

// Per-axis collision resolution: try the X move, then the Y move against the
// (possibly already-corrected) X position, so players slide along walls
// instead of freezing whenever diagonal input touches an obstacle. Used
// identically by the server (authoritative) and the client (local
// prediction) so the two can never disagree about where walls are.
export function resolveMovement(
  grid: TileGrid,
  x: number,
  y: number,
  dx: number,
  dy: number,
): { x: number; y: number } {
  let nx = x;
  let ny = y;

  if (dx !== 0) {
    const candidate = x + dx;
    if (!isBlockedAt(grid, candidate, y)) nx = candidate;
  }
  if (dy !== 0) {
    const candidate = y + dy;
    if (!isBlockedAt(grid, nx, candidate)) ny = candidate;
  }

  return { x: nx, y: ny };
}
