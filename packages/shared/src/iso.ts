// Dimetric ("isometric") projection. A worldTile×worldTile square in raw
// simulation space becomes a diamond on screen, TILE_DIAMOND_RATIO times as
// wide as it is tall. Simulation, collision (map.ts), and networking never
// see projected coordinates — only render-time call sites in the game
// client (WorldScene) and the admin map editor do, both importing this
// module so they draw identically-shaped diamonds from one source.
//
// The ratio is NOT the idealized "exactly 2:1" a mathematically clean
// dimetric projection would use — it's measured directly from the actual
// Kenney "Isometric Blocks" cube art client/src/assets.ts renders every
// terrain tile as (TERRAIN_CUBE_SOURCE_WIDTH / TERRAIN_CUBE_SOURCE_TOP_HEIGHT
// = 111/62; duplicated here as a literal, not imported, since shared can't
// depend on the client package — keep the two in sync if that art changes).
// WorldScene renders each tile's full cube image scaled uniformly (same
// factor on both axes, preserving the art's native proportions), so the
// diamond THIS module projects a tile's corners onto must already be that
// same shape, or the rendered cube's corners drift away from the grid's
// corners tile by tile — exactly the "blocks offset from each other"
// symptom a plain 2:1 ratio produced against this specific (non-2:1) art.
//
// Derivation: projecting a tile's 4 world corners (0,0) (T,0) (T,T) (0,T)
// gives screen points (0,0) (T,T/RATIO) (0,2T/RATIO) (-T,T/RATIO) — a
// diamond spanning x∈[-T,T], y∈[0,2T/RATIO], i.e. exactly RATIO:1
// width:height (RATIO=2 reduces to the idealized case above).
export const TILE_DIAMOND_RATIO = 111 / 62;

export function isoProject(worldX: number, worldY: number): { x: number; y: number } {
  return { x: worldX - worldY, y: (worldX + worldY) / TILE_DIAMOND_RATIO };
}

// Exact inverse of isoProject — turns a point in rendered/projected space
// (e.g. a Phaser pointer's world coordinates, or a canvas click converted to
// projected space) back into raw simulation coordinates. Needed wherever a
// click has to be compared against server-side positions/ranges or sent to
// the server.
export function isoUnproject(screenX: number, screenY: number): { x: number; y: number } {
  const halfRatioY = (screenY * TILE_DIAMOND_RATIO) / 2;
  return { x: halfRatioY + screenX / 2, y: halfRatioY - screenX / 2 };
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
// ellipse of width 2R/height 2R/RATIO — that's the projected size of a raw
// world-space SQUARE of side R (which is what a tile is). A circle's image
// under isoProject's transform matrix [[1,-1],[1/RATIO,1/RATIO]] has
// semi-axes equal to that matrix's singular values (√2 and √2/RATIO), so a
// circle scales up by an extra √2 factor relative to a square of the same
// "radius": width = 2R√2, height = 2R√2/RATIO. Used for every radius-based
// world footprint drawn as a Phaser Ellipse — ground-AoE rings/bursts,
// monster attack-range indicators, etc.
export function isoCircleFootprint(radius: number): { width: number; height: number } {
  return { width: radius * 2 * Math.SQRT2, height: (radius * 2 * Math.SQRT2) / TILE_DIAMOND_RATIO };
}

// One elevation level visually rises by this fraction of a tile diamond's
// height (which is `2 * tileSize / TILE_DIAMOND_RATIO` — see isoProject's
// derivation above, not tileSize itself except in the idealized 2:1 case).
// Kept well under 1 tile so a legal, walkable 1-level step (the common
// case — anything steeper is blocked by MAX_ELEVATION_STEP) still reads as
// a step rather than a wall, given there's no wall-face geometry drawn at
// elevation edges.
export const ELEVATION_STEP_RATIO = 0.5;

export function isoElevationOffset(elevation: number, tileSize: number): number {
  return elevation * ((2 * tileSize) / TILE_DIAMOND_RATIO) * ELEVATION_STEP_RATIO;
}
