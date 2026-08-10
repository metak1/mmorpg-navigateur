import type Phaser from "phaser";
import { TileType, type SpellKind, type PropType } from "shared";

// Every sprite this game loads, in one place, so preload() and every render
// call site agree on the same texture keys — see public/assets/ for the
// actual files (Kenney's CC0 "Isometric Blocks" and "Tiny Dungeon" packs).

// Each tile renders as the complete voxel cube (top face + its two baked-in
// south/east side faces) — for cliffs taller than one cube, extra full
// cubes stack underneath rather than a dedicated side-only crop (tried
// first; it had its own baked directional shading that repeating down a
// tall cliff turned into an ugly banded gradient — see
// WorldScene.createChunkLayer for the stacking math). An even earlier
// attempt used only a flat top-face crop tiled edge-to-edge, which looked
// wrong for a different reason: that crop's baked-in corner shading (meant
// for a single standalone cube icon) turned into an obvious repeating
// triangle pattern across open ground. Rendering the real 3D block is what
// actually fixes both.
export const TERRAIN_FULL_TEXTURE_KEYS: Record<number, string> = {
  [TileType.Grass]: "tile-grass-full",
  [TileType.Path]: "tile-path-full",
  [TileType.Water]: "tile-water-full",
  [TileType.Wall]: "tile-wall-full",
};

// Pixel dimensions baked into every -full terrain PNG (see
// public/assets/tiles/) — all four cropped from the same Kenney "Isometric
// Blocks" voxel cube layout, so one set of measurements covers all of them.
// The cube image is the top diamond plus its two baked-in side faces
// stacked below it. TOP_HEIGHT isn't the idealized "exactly half of WIDTH"
// a mathematically perfect 2:1 diamond would have (111/2 = 55.5) — measured
// directly from the actual artwork's alpha channel (every one of these four
// PNGs' top face is fully opaque edge-to-edge, x=0..110, at row 31, i.e.
// TOP_HEIGHT/2), the art's top face reads as visually taller than that.
// Using the idealized value here throws off WorldScene.createChunkLayer's
// topOriginYFraction (which positions every cube off this) by a few
// pixels, consistently, on every single tile — the measured value is what
// actually lines a cube's top-face center up with its tile's true grid
// center.
export const TERRAIN_CUBE_SOURCE_WIDTH = 111;
export const TERRAIN_CUBE_SOURCE_HEIGHT = 128;
export const TERRAIN_CUBE_SOURCE_TOP_HEIGHT = 62;

const TERRAIN_ASSET_PATHS: Record<string, string> = {
  "tile-grass-full": "/assets/tiles/grass-full.png",
  "tile-path-full": "/assets/tiles/path-full.png",
  "tile-water-full": "/assets/tiles/water-full.png",
  "tile-wall-full": "/assets/tiles/wall-full.png",
};

// Decorative furniture/dungeon-dressing props an admin can paint onto a tile
// (see shared/src/api-types.ts's PropType and MapTile.propType) — purely
// visual, drawn on top of the tile it's painted on with no gameplay effect
// of its own (an admin who also wants it to block movement pairs it with
// the existing Barrier tool on the same cell).
export const PROP_TEXTURE_KEYS: Record<PropType, string> = {
  table: "prop-table",
  chest: "prop-chest",
  dresser: "prop-dresser",
  barrel: "prop-barrel",
  torch: "prop-torch",
  door: "prop-door",
  fence: "prop-fence",
  gravestone: "prop-gravestone",
};

const PROP_ASSET_PATHS: Record<string, string> = {
  "prop-table": "/assets/props/table.png",
  "prop-chest": "/assets/props/chest.png",
  "prop-dresser": "/assets/props/dresser.png",
  "prop-barrel": "/assets/props/barrel.png",
  "prop-torch": "/assets/props/torch.png",
  "prop-door": "/assets/props/door.png",
  "prop-fence": "/assets/props/fence.png",
  "prop-gravestone": "/assets/props/gravestone.png",
};

// Keyed by ClassTemplate/MonsterTemplate/NpcTemplate *name* (not id) — those
// names are admin-authored content, not a fixed enum, so an unmapped name
// (a class/monster/NPC created after this list was written) falls back to
// a same-category default below rather than throwing.
export const CLASS_TEXTURE_KEYS: Record<string, string> = {
  Warrior: "char-warrior",
  Rogue: "char-rogue",
  Mage: "char-mage",
  Priest: "char-priest",
};

export const MONSTER_TEXTURE_KEYS: Record<string, string> = {
  Slime: "char-slime",
};

export const NPC_TEXTURE_KEYS: Record<string, string> = {
  Guide: "char-guide",
  Sage: "char-sage",
};

// One fallback per category (rather than one shared default) so an
// admin-added monster/NPC that isn't in the maps above still reads as
// "a monster" / "an NPC" instead of literally rendering as a Warrior.
export const DEFAULT_CLASS_TEXTURE_KEY = "char-warrior";
export const DEFAULT_MONSTER_TEXTURE_KEY = "char-slime";
export const DEFAULT_NPC_TEXTURE_KEY = "char-guide";

const CHARACTER_ASSET_PATHS: Record<string, string> = {
  "char-warrior": "/assets/characters/warrior.png",
  "char-rogue": "/assets/characters/rogue.png",
  "char-mage": "/assets/characters/mage.png",
  "char-priest": "/assets/characters/priest.png",
  "char-slime": "/assets/characters/slime.png",
  "char-guide": "/assets/characters/guide.png",
  "char-sage": "/assets/characters/sage.png",
};

// One icon per spell *kind* (not per spell) — a class's individual spells
// are admin-authored (name/color/etc.), but they're built from this fixed
// set of kinds (see shared/src/spells.ts), so an icon per kind covers every
// spell any class can ever have without needing per-spell icon authoring.
export const SPELL_KIND_ICON_KEYS: Record<SpellKind, string> = {
  single: "icon-single",
  aoe: "icon-aoe",
  groundAoe: "icon-groundAoe",
  slow: "icon-slow",
  heal: "icon-heal",
  interrupt: "icon-interrupt",
};

const ICON_ASSET_PATHS: Record<string, string> = {
  "icon-single": "/assets/icons/icon-single.png",
  "icon-aoe": "/assets/icons/icon-aoe.png",
  "icon-groundAoe": "/assets/icons/icon-groundAoe.png",
  "icon-slow": "/assets/icons/icon-slow.png",
  "icon-heal": "/assets/icons/icon-heal.png",
  "icon-interrupt": "/assets/icons/icon-interrupt.png",
};

export function preloadGameAssets(scene: Phaser.Scene) {
  for (const [key, path] of Object.entries(TERRAIN_ASSET_PATHS)) scene.load.image(key, path);
  for (const [key, path] of Object.entries(PROP_ASSET_PATHS)) scene.load.image(key, path);
  for (const [key, path] of Object.entries(CHARACTER_ASSET_PATHS)) scene.load.image(key, path);
  for (const [key, path] of Object.entries(ICON_ASSET_PATHS)) scene.load.image(key, path);
}
