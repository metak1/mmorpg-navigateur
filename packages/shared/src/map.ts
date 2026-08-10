export enum TileType {
  Grass = 0,
  Path = 1,
  Water = 2,
  Wall = 3,
}

// The world is infinite and hand-authored: there is no bounded grid anymore,
// just a source that can answer "what tile is at this (col,row)" for any
// integer coordinate. Anywhere nothing was ever painted defaults to walkable
// Grass (see ChunkTileCache in chunkCache.ts, the one implementation of
// this interface) — that default, not a width/height, is what makes the
// map infinite: there's no edge to fall off of.
export interface WorldGrid {
  tileSize: number;
  tileAt(col: number, row: number): number;
  elevationAt(col: number, row: number): number;
  // True for a cell painted with the invisible "barrier" overlay (see
  // isWalkableCell) — independent of tileType/elevation, so it can be
  // layered on top of whatever's already there (e.g. Grass) to block
  // movement/projectiles/line-of-sight without changing how the cell looks.
  // The intended use is hand-authoring a hard edge to an otherwise-infinite
  // map without needing a visible wall there.
  blocksMovementAt(col: number, row: number): boolean;
}

// Movement is blocked between two tiles whose elevation differs by more
// than this many levels — a cliff you can't walk (or fall) off of, in
// either direction. See resolveMovement/isBlockedAt.
export const MAX_ELEVATION_STEP = 1;

// Tile-space chunk granularity shared by gameplay collision (server +
// client prediction), client rendering, and the ranged tile-fetch API — all
// three need to agree on the same grouping for caching/streaming to work.
export const CHUNK_SIZE = 16;

export function chunkKeyFor(col: number, row: number): string {
  return `${Math.floor(col / CHUNK_SIZE)},${Math.floor(row / CHUNK_SIZE)}`;
}

export function chunkOriginFromKey(key: string): { chunkCol: number; chunkRow: number } {
  const [chunkCol, chunkRow] = key.split(",").map(Number);
  return { chunkCol, chunkRow };
}

// Seed data for prisma/seed.ts — a small hand-painted patch (pond + path)
// near the spawn point so the world doesn't look completely blank at
// (0,0). Everywhere else, including just outside this patch, is Grass by
// default — there's no border wall, the map has no edge.
export const DEFAULT_TILE_SIZE = 32;
export const DEFAULT_SPAWN_X = DEFAULT_TILE_SIZE / 2;
export const DEFAULT_SPAWN_Y = DEFAULT_TILE_SIZE / 2;

function buildDefaultSeedTiles(): Array<{ col: number; row: number; tileType: number; elevation: number }> {
  const tiles: Array<{ col: number; row: number; tileType: number; elevation: number }> = [];

  // horizontal path through the spawn area
  for (let col = -6; col <= 6; col++) {
    tiles.push({ col, row: 0, tileType: TileType.Path, elevation: 0 });
  }

  // small pond just north of it
  for (let row = -5; row <= -3; row++) {
    for (let col = -2; col <= 2; col++) {
      tiles.push({ col, row, tileType: TileType.Water, elevation: 0 });
    }
  }

  // a couple of standalone obstacles
  tiles.push({ col: 4, row: 3, tileType: TileType.Wall, elevation: 0 });
  tiles.push({ col: 5, row: 3, tileType: TileType.Wall, elevation: 0 });
  tiles.push({ col: -7, row: 2, tileType: TileType.Wall, elevation: 0 });

  // A small elevated plateau east of spawn, reachable via a one-tile ramp
  // on its south side (two steps of exactly MAX_ELEVATION_STEP each) —
  // every other side is a sheer, unclimbable 2-level drop straight to
  // surrounding (elevation 0) grass, demonstrating both the walkable and
  // blocked cases out of the box.
  for (let row = -3; row <= -1; row++) {
    for (let col = 8; col <= 10; col++) {
      tiles.push({ col, row, tileType: TileType.Grass, elevation: 2 });
    }
  }
  tiles.push({ col: 9, row: 0, tileType: TileType.Grass, elevation: 1 });

  return tiles;
}

export const DEFAULT_SEED_TILES = buildDefaultSeedTiles();

export function isWalkable(tileType: number): boolean {
  return tileType !== TileType.Wall && tileType !== TileType.Water;
}

// The one place tileType-walkability and the invisible blocksMovement
// overlay are combined — every collision/LOS/projectile check below goes
// through this (or its pixel-space sibling isWalkableAt) rather than calling
// isWalkable directly, so a barrier cell is indistinguishable from a real
// Wall to gameplay code while staying invisible to rendering.
export function isWalkableCell(grid: WorldGrid, col: number, row: number): boolean {
  return isWalkable(grid.tileAt(col, row)) && !grid.blocksMovementAt(col, row);
}

export function isWalkableAt(grid: WorldGrid, xPixel: number, yPixel: number): boolean {
  const col = Math.floor(xPixel / grid.tileSize);
  const row = Math.floor(yPixel / grid.tileSize);
  return isWalkableCell(grid, col, row);
}

export function getTileAt(grid: WorldGrid, xPixel: number, yPixel: number): number {
  const col = Math.floor(xPixel / grid.tileSize);
  const row = Math.floor(yPixel / grid.tileSize);
  return grid.tileAt(col, row);
}

export function getElevationAt(grid: WorldGrid, xPixel: number, yPixel: number): number {
  const col = Math.floor(xPixel / grid.tileSize);
  const row = Math.floor(yPixel / grid.tileSize);
  return grid.elevationAt(col, row);
}

// How far "toward the camera" to look for terrain tall enough to visually
// hide something standing at a given point — purely a rendering concern
// (see WorldScene, which fades an entity's sprite when this is true), not
// gameplay-authoritative like resolveMovement/hasLineOfSight.
const OCCLUSION_CHECK_TILES = 1.5;

// The (+1,+1) world diagonal is the direction whose projection is straight
// down the screen (isoProject(1,1) = {x:0, y:1)) — i.e. "toward the viewer"
// in this 2:1 iso projection, the same convention that makes south/east the
// visible ("front") cliff-face edges elsewhere in map.ts/WorldScene. Only
// a genuine cliff (more than one elevation level higher, matching
// MAX_ELEVATION_STEP — the same threshold that makes it unwalkable) hides
// what's behind it; a merely-climbable 1-level rise doesn't.
export function isHiddenByTerrain(grid: WorldGrid, x: number, y: number): boolean {
  const ownElevation = getElevationAt(grid, x, y);
  const maxDist = grid.tileSize * OCCLUSION_CHECK_TILES;
  const step = grid.tileSize / 4;
  const steps = Math.ceil(maxDist / step);
  for (let i = 1; i <= steps; i++) {
    const d = (i / steps) * maxDist * Math.SQRT1_2;
    if (getElevationAt(grid, x + d, y + d) > ownElevation + MAX_ELEVATION_STEP) return true;
  }
  return false;
}

// Collision box half-extent, deliberately smaller than the 24px player
// sprite so movement near walls still feels fair rather than snagging early.
const PLAYER_HALF_SIZE = 10;

// fromElevation is the mover's elevation at the START of this resolveMovement
// call (see below). Walkability (Wall/Water) is still checked at all 4 AABB
// corners, same as ever — but the elevation-step check is deliberately
// center-point-only, not per-corner: a 20px-wide player standing near a
// ramp can easily have one corner of their AABB graze a much-taller tile
// diagonally adjacent to a perfectly legal 1-level step, and blocking the
// whole move because of that corner (rather than where the player's body
// is actually centered) is what caused movement to intermittently "stick"
// near plateau/ramp corners.
function isBlockedAt(grid: WorldGrid, x: number, y: number, fromElevation: number): boolean {
  const corners: Array<[number, number]> = [
    [x - PLAYER_HALF_SIZE, y - PLAYER_HALF_SIZE],
    [x + PLAYER_HALF_SIZE, y - PLAYER_HALF_SIZE],
    [x - PLAYER_HALF_SIZE, y + PLAYER_HALF_SIZE],
    [x + PLAYER_HALF_SIZE, y + PLAYER_HALF_SIZE],
  ];
  if (corners.some(([cx, cy]) => !isWalkableAt(grid, cx, cy))) return true;
  return Math.abs(getElevationAt(grid, x, y) - fromElevation) > MAX_ELEVATION_STEP;
}

// Same AABB-corner shape as isBlockedAt, but answers a narrower question:
// would a mover's hitbox AT this (uncommitted, pre-collision) candidate
// position touch a barrier cell specifically? Used to give the player
// explicit feedback on an otherwise-invisible block (see WorldRoom) —
// checking the candidate's raw center point wouldn't work here, since the
// PLAYER_HALF_SIZE margin that actually stops movement is bigger than a
// single simulation tick's step, so a center-only lookahead never actually
// reaches the blocking cell once the mover is pinned at the boundary.
export function isBlockedByBarrier(grid: WorldGrid, x: number, y: number): boolean {
  const corners: Array<[number, number]> = [
    [x - PLAYER_HALF_SIZE, y - PLAYER_HALF_SIZE],
    [x + PLAYER_HALF_SIZE, y - PLAYER_HALF_SIZE],
    [x - PLAYER_HALF_SIZE, y + PLAYER_HALF_SIZE],
    [x + PLAYER_HALF_SIZE, y + PLAYER_HALF_SIZE],
  ];
  return corners.some(([cx, cy]) => grid.blocksMovementAt(Math.floor(cx / grid.tileSize), Math.floor(cy / grid.tileSize)));
}

// Samples points along the segment at a quarter-tile step (fine enough to
// never skip over a grid-aligned wall cell) and checks each is walkable AND
// not overtopped by terrain. Used to require line-of-sight before a
// targeted spell is allowed to land — a wall between caster and target
// blocks it, the same as it blocks a projectile physically flying into one
// (see WorldRoom.updateProjectiles); so does a hill/plateau taller than the
// straight sightline connecting the two, hiding whatever's behind it.
export function hasLineOfSight(grid: WorldGrid, x1: number, y1: number, x2: number, y2: number): boolean {
  const dist = Math.hypot(x2 - x1, y2 - y1);
  if (dist === 0) return true;

  // The sightline's "ceiling" is whichever end stands higher up, not a
  // straight interpolation between the two — someone on high ground can see
  // over anything no taller than their own vantage point anywhere along the
  // path, the same way standing atop a cliff and looking down at the base
  // isn't blocked by the cliff itself (a linear interpolation would treat
  // the caster's own tile, near the very start of the path, as "terrain
  // overtopping the sightline" purely because the line has already started
  // dipping toward the lower end). Only terrain taller than BOTH ends — a
  // genuine cliff/wall towering over the higher of the two — actually
  // blocks, by more than MAX_ELEVATION_STEP (the same threshold that makes
  // a rise unwalkable, matching isHiddenByTerrain); a merely climbable
  // 1-level bump must not hide either one.
  const sightlineElevation = Math.max(getElevationAt(grid, x1, y1), getElevationAt(grid, x2, y2));

  const step = grid.tileSize / 4;
  const steps = Math.ceil(dist / step);
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const x = x1 + (x2 - x1) * t;
    const y = y1 + (y2 - y1) * t;
    if (!isWalkableAt(grid, x, y)) return false;
    if (getElevationAt(grid, x, y) > sightlineElevation + MAX_ELEVATION_STEP) return false;
  }
  return true;
}

// Per-axis collision resolution: try the X move, then the Y move against the
// (possibly already-corrected) X position, so players slide along walls
// instead of freezing whenever diagonal input touches an obstacle. Used
// identically by the server (authoritative) and the client (local
// prediction) so the two can never disagree about where walls are.
//
// The mover's elevation is read once, from their position at the START of
// this call, and used for both sub-checks — a per-tick move only ever
// covers a few pixels (well under one tile), so this can't be "snuck"
// around by re-deriving elevation mid-move; using the fixed start value is
// simply the stricter (never more permissive) of the two options.
export function resolveMovement(
  grid: WorldGrid,
  x: number,
  y: number,
  dx: number,
  dy: number,
): { x: number; y: number } {
  let nx = x;
  let ny = y;
  const fromElevation = getElevationAt(grid, x, y);

  if (dx !== 0) {
    const candidate = x + dx;
    if (!isBlockedAt(grid, candidate, y, fromElevation)) nx = candidate;
  }
  if (dy !== 0) {
    const candidate = y + dy;
    if (!isBlockedAt(grid, nx, candidate, fromElevation)) ny = candidate;
  }

  return { x: nx, y: ny };
}
