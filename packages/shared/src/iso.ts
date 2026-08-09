// 2:1 dimetric ("isometric") projection. A worldTile×worldTile square in
// raw simulation space becomes a diamond twice as wide as it is tall on
// screen. Simulation, collision (map.ts), and networking never see
// projected coordinates — only render-time call sites in the game client
// (WorldScene) and the admin map editor do, both importing this module so
// they draw identically-shaped diamonds from one source.
//
// Derivation: projecting a tile's 4 world corners (0,0) (T,0) (T,T) (0,T)
// gives screen points (0,0) (T,T/2) (0,T) (-T,T/2) — a diamond spanning
// x∈[-T,T], y∈[0,T], i.e. exactly 2:1 width:height.
export function isoProject(worldX: number, worldY: number): { x: number; y: number } {
  return { x: worldX - worldY, y: (worldX + worldY) / 2 };
}

// Exact inverse of isoProject — turns a point in rendered/projected space
// (e.g. a Phaser pointer's world coordinates, or a canvas click converted to
// projected space) back into raw simulation coordinates. Needed wherever a
// click has to be compared against server-side positions/ranges or sent to
// the server.
export function isoUnproject(screenX: number, screenY: number): { x: number; y: number } {
  return { x: screenY + screenX / 2, y: screenY - screenX / 2 };
}

// Depth has three tiers (see WorldScene for how each is used):
//  - TERRAIN_DEPTH: chunk tile graphics, always below everything.
//  - world tier (not a constant — isoProject(x,y).y, recomputed per entity
//    per position update): entities, HP bars, world-anchored VFX, so
//    painter's-algorithm draw order falls out of projected Y automatically.
//  - UI_DEPTH: screen-fixed HUD/panels/aiming aids, always above everything
//    a world-tier value could ever reach. Deliberately a large *finite*
//    sentinel, not Infinity — Hud.ts adds small offsets to stack its own
//    layers (UI_DEPTH + 1, + 2, ...), and `Infinity + N === Infinity` in
//    JS, which would silently collapse all of those back to one value and
//    lose the relative ordering. 1e15 is still unreachable by a world-tier
//    depth in any realistic play session (that's ~3e13 tiles from spawn).
export const TERRAIN_DEPTH = -1e15;
export const UI_DEPTH = 1e15;

// Remaps a screen-space cardinal direction (what the player intends
// visually, e.g. "Up" = (0,-1)) to the raw-world-space unit direction that
// actually projects to it — without this, WASD would feel diagonal once
// rendering is isometric. isoUnproject is linear but doesn't preserve
// vector length (screen-up/down and screen-left/right unproject to
// different magnitudes), so the result is renormalized to unit length.
export function isoUnprojectDirection(screenDx: number, screenDy: number): { x: number; y: number } {
  if (screenDx === 0 && screenDy === 0) return { x: 0, y: 0 };
  const raw = isoUnproject(screenDx, screenDy);
  const len = Math.hypot(raw.x, raw.y);
  return { x: raw.x / len, y: raw.y / len };
}

// A world-space CIRCLE of radius R does not project to a screen-space
// ellipse of width 2R/height R — that's the projected size of a raw
// world-space SQUARE of side R (which is what a tile is). A circle's image
// under isoProject's transform matrix [[1,-1],[0.5,0.5]] has semi-axes
// equal to that matrix's singular values (√2 and 1/√2), so a circle scales
// up by an extra √2 factor relative to a square of the same "radius":
// width = 2R√2, height = R√2 (still exactly 2:1, just bigger). Used for
// every radius-based world footprint drawn as a Phaser Ellipse — ground-AoE
// rings/bursts, monster attack-range indicators, etc.
export function isoCircleFootprint(radius: number): { width: number; height: number } {
  return { width: radius * 2 * Math.SQRT2, height: radius * Math.SQRT2 };
}

// One elevation level visually rises by this fraction of a tile diamond's
// height (which is exactly `tileSize` — see isoProject's derivation above).
// Kept well under 1 tile so a legal, walkable 1-level step (the common
// case — anything steeper is blocked by MAX_ELEVATION_STEP) still reads as
// a step rather than a wall, given there's no wall-face geometry drawn at
// elevation edges.
export const ELEVATION_STEP_RATIO = 0.5;

export function isoElevationOffset(elevation: number, tileSize: number): number {
  return elevation * tileSize * ELEVATION_STEP_RATIO;
}
