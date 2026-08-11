import { TileType, PROP_TYPES, isoProject, isoUnproject, isoElevationOffset, TILE_COLORS as TILE_COLORS_HEX } from "shared";
import type { GameMapDTO, GameMapInput, MapTileDTO, MonsterTemplateDTO, NpcTemplateDTO, DungeonObjectiveKind, PropType } from "shared";

// Fixed viewport size in pixels — the world itself has no size limit, this
// is just how much of it the editor shows at once. `zoom` (canvas pixels
// per projected unit) controls how many tiles that maps to.
const CANVAS_WIDTH = 960;
const CANVAS_HEIGHT = 720;
const DEFAULT_ZOOM = 0.75;
const MIN_ZOOM = 0.25;
const MAX_ZOOM = 2;
const ZOOM_STEP_FACTOR = 1.2;
const PAN_STEP_TILES = 10;
const AMBIENT_SLOT_COUNT = 4;
const OBJECTIVE_SLOT_COUNT = 6;
// 125*125=15,625 cells — under the server's 128*128=16,384 range cap
// (packages/server/src/api/maps.ts) with margin, computed to actually
// cover the naive bounding box at MIN_ZOOM (which reaches ~150x150).
const MAX_VISIBLE_TILES_PER_AXIS = 125;
// Nudges each tile's fill corners outward by a hair so adjacent diamonds
// overlap slightly instead of leaving sub-pixel seams — same technique the
// game client uses (WorldScene.createChunkLayer).
const SEAM_PAD = 1;

// ctx.fillStyle wants "#rrggbb"; the shared palette is Phaser-style numeric
// 0xrrggbb (packages/shared/src/tileColors.ts) — same source either way.
// Flat colors here vs. the actual game's real voxel-block sprites (see
// client/src/scenes/WorldScene.ts's createChunkLayer) is a deliberate
// simplification, not a bug — this editor is a fast, schematic top-down
// view for laying out a map, not a pixel-accurate preview of it.
const TILE_COLORS: Record<number, string> = Object.fromEntries(
  Object.entries(TILE_COLORS_HEX).map(([key, hex]) => [key, `#${hex.toString(16).padStart(6, "0")}`]),
);

// Thumbnail source for each terrain block's palette button — the actual
// Kenney cube art (same PNGs the game client renders), not the flat
// TILE_COLORS swatch, so an admin can tell blocks apart at a glance instead
// of guessing from a label + a single average color.
const TILE_ICON_PATHS: Record<number, string> = {
  [TileType.Grass]: "/assets/tiles/grass-full.png",
  [TileType.Path]: "/assets/tiles/path-full.png",
  [TileType.Water]: "/assets/tiles/water-full.png",
  [TileType.Wall]: "/assets/tiles/wall-full.png",
  [TileType.Sand]: "/assets/tiles/sand-full.png",
  [TileType.Snow]: "/assets/tiles/snow-full.png",
  [TileType.GreenBlock]: "/assets/tiles/green-block-full.png",
  [TileType.OrangeTerracottaSolid]: "/assets/tiles/orange-terracotta-solid-full.png",
  [TileType.Hedge]: "/assets/tiles/hedge-full.png",
  [TileType.Ice]: "/assets/tiles/ice-full.png",
  [TileType.CrackedIce]: "/assets/tiles/cracked-ice-full.png",
  [TileType.MoltenRock]: "/assets/tiles/molten-rock-full.png",
  [TileType.Stone]: "/assets/tiles/stone-full.png",
  [TileType.GrassStoneSides]: "/assets/tiles/grass-stone-sides-full.png",
  [TileType.DirtStoneSides]: "/assets/tiles/dirt-stone-sides-full.png",
  [TileType.SandStoneSides]: "/assets/tiles/sand-stone-sides-full.png",
  [TileType.SnowStoneSides]: "/assets/tiles/snow-stone-sides-full.png",
  [TileType.WoodLog]: "/assets/tiles/wood-log-full.png",
  [TileType.Marble]: "/assets/tiles/marble-full.png",
  [TileType.JadeBlock]: "/assets/tiles/jade-block-full.png",
  [TileType.RedBrick]: "/assets/tiles/red-brick-full.png",
  [TileType.Sandstone]: "/assets/tiles/sandstone-full.png",
  [TileType.WhiteMarbleSolid]: "/assets/tiles/white-marble-solid-full.png",
  [TileType.TerracottaSmooth]: "/assets/tiles/terracotta-smooth-full.png",
  [TileType.GreenWool]: "/assets/tiles/green-wool-full.png",
  [TileType.BlueWool]: "/assets/tiles/blue-wool-full.png",
  [TileType.CreamWool]: "/assets/tiles/cream-wool-full.png",
  [TileType.WoodPlanks]: "/assets/tiles/wood-planks-full.png",
  [TileType.BrickCoursed]: "/assets/tiles/brick-coursed-full.png",
  [TileType.RockyDirt]: "/assets/tiles/rocky-dirt-full.png",
  [TileType.SpeckledStone]: "/assets/tiles/speckled-stone-full.png",
  [TileType.DarkStoneBrick]: "/assets/tiles/dark-stone-brick-full.png",
  [TileType.CoalOre]: "/assets/tiles/coal-ore-full.png",
  [TileType.EmeraldOre]: "/assets/tiles/emerald-ore-full.png",
  [TileType.CopperOre]: "/assets/tiles/copper-ore-full.png",
  [TileType.IronOre]: "/assets/tiles/iron-ore-full.png",
  [TileType.GoldOre]: "/assets/tiles/gold-ore-full.png",
  [TileType.DiamondOre]: "/assets/tiles/diamond-ore-full.png",
  [TileType.RedClay]: "/assets/tiles/red-clay-full.png",
  [TileType.RedClayMottled]: "/assets/tiles/red-clay-mottled-full.png",
  [TileType.RedClayRough]: "/assets/tiles/red-clay-rough-full.png",
  [TileType.RedClayEmerald]: "/assets/tiles/red-clay-emerald-full.png",
  [TileType.RedClayEmeraldRich]: "/assets/tiles/red-clay-emerald-rich-full.png",
  [TileType.BasaltCoal]: "/assets/tiles/basalt-coal-full.png",
  [TileType.StoneEmeraldAlt]: "/assets/tiles/stone-emerald-alt-full.png",
  [TileType.StoneCopperAlt]: "/assets/tiles/stone-copper-alt-full.png",
  [TileType.StoneIronAlt]: "/assets/tiles/stone-iron-alt-full.png",
  [TileType.StoneGoldRich]: "/assets/tiles/stone-gold-rich-full.png",
  [TileType.StoneDiamondAlt]: "/assets/tiles/stone-diamond-alt-full.png",
  [TileType.LightGrayStone]: "/assets/tiles/light-gray-stone-full.png",
  [TileType.PaleStone]: "/assets/tiles/pale-stone-full.png",
  [TileType.SlateStone]: "/assets/tiles/slate-stone-full.png",
  [TileType.SlateRuby]: "/assets/tiles/slate-ruby-full.png",
  [TileType.SlateRubyRich]: "/assets/tiles/slate-ruby-rich-full.png",
  [TileType.DirtSolid]: "/assets/tiles/dirt-solid-full.png",
  [TileType.GrassSolidBright]: "/assets/tiles/grass-solid-bright-full.png",
  [TileType.GrassClassic]: "/assets/tiles/grass-classic-full.png",
};

// Prop icons are loaded once, up front — draw() is called on every
// pan/zoom/paint, so it can't afford to construct a new Image (and wait on
// its onload) per call. A prop painted before its icon has finished loading
// just draws nothing until something repaints the canvas — with well over a
// hundred icons now requested at once (see PROP_ICON_PATHS below) that can
// take a moment, so each image's onload explicitly triggers a redraw (see
// requestPropIconRedraw/PROP_ICONS) rather than relying on the user
// happening to pan/zoom/paint again soon after.
let requestPropIconRedraw: (() => void) | null = null;

const PROP_ICON_PATHS: Record<PropType, string> = {
  table: "/assets/props/table.png",
  chest: "/assets/props/chest.png",
  dresser: "/assets/props/dresser.png",
  barrel: "/assets/props/barrel.png",
  torch: "/assets/props/torch.png",
  door: "/assets/props/door.png",
  fence: "/assets/props/fence.png",
  gravestone: "/assets/props/gravestone.png",
  furnace: "/assets/props/furnace.png",
  crate: "/assets/props/crate.png",
  dirtFloor: "/assets/props/dirt-floor.png",
  dirtFloorVar2: "/assets/props/dirt-floor-var2.png",
  dirtFloorVar3: "/assets/props/dirt-floor-var3.png",
  dirtFloorVar4: "/assets/props/dirt-floor-var4.png",
  stoneArchwayTopLeft: "/assets/props/stone-archway-top-left.png",
  stoneArchwayTopRight: "/assets/props/stone-archway-top-right.png",
  stonePillarTop: "/assets/props/stone-pillar-top.png",
  ironSconce: "/assets/props/iron-sconce.png",
  torchSconceGreen: "/assets/props/torch-sconce-green.png",
  greenGemTorch: "/assets/props/green-gem-torch.png",
  darkFloor: "/assets/props/dark-floor.png",
  darkFloorVar2: "/assets/props/dark-floor-var2.png",
  dirtFloorPebbles: "/assets/props/dirt-floor-pebbles.png",
  dirtFloorPebbles2: "/assets/props/dirt-floor-pebbles2.png",
  stoneArchwayOpenLeft: "/assets/props/stone-archway-open-left.png",
  stoneArchwayOpenRight: "/assets/props/stone-archway-open-right.png",
  stonePillarBase: "/assets/props/stone-pillar-base.png",
  stonePillarCap: "/assets/props/stone-pillar-cap.png",
  wallSconce: "/assets/props/wall-sconce.png",
  gargoyleFaceLeft: "/assets/props/gargoyle-face-left.png",
  gargoyleFaceRight: "/assets/props/gargoyle-face-right.png",
  darkWall: "/assets/props/dark-wall.png",
  darkWallVar2: "/assets/props/dark-wall-var2.png",
  darkWallVar3: "/assets/props/dark-wall-var3.png",
  dirtFloorRocks: "/assets/props/dirt-floor-rocks.png",
  dirtFloorRocks2: "/assets/props/dirt-floor-rocks2.png",
  stoneFrameLeft: "/assets/props/stone-frame-left.png",
  stoneFrameRight: "/assets/props/stone-frame-right.png",
  stoneWall: "/assets/props/stone-wall.png",
  redBanner: "/assets/props/red-banner.png",
  sandFloor: "/assets/props/sand-floor.png",
  stoneVent: "/assets/props/stone-vent.png",
  emeraldAltar: "/assets/props/emerald-altar.png",
  woodDoorClosedLeft: "/assets/props/wood-door-closed-left.png",
  woodDoorClosedMid: "/assets/props/wood-door-closed-mid.png",
  woodDoorClosedRight: "/assets/props/wood-door-closed-right.png",
  plankWall: "/assets/props/plank-wall.png",
  plankWallVar2: "/assets/props/plank-wall-var2.png",
  plankWallVar3: "/assets/props/plank-wall-var3.png",
  plankWallEdge: "/assets/props/plank-wall-edge.png",
  stoneWallVar2: "/assets/props/stone-wall-var2.png",
  crossWindow: "/assets/props/cross-window.png",
  stoneFloorTiles: "/assets/props/stone-floor-tiles.png",
  stoneSarcophagus: "/assets/props/stone-sarcophagus.png",
  emeraldSarcophagus: "/assets/props/emerald-sarcophagus.png",
  woodDoorKnobLeft: "/assets/props/wood-door-knob-left.png",
  woodDoorKnobMid: "/assets/props/wood-door-knob-mid.png",
  woodDoorKnobRight: "/assets/props/wood-door-knob-right.png",
  sandFloorVar2: "/assets/props/sand-floor-var2.png",
  sandFloorSpeckled: "/assets/props/sand-floor-speckled.png",
  sandFloorVar3: "/assets/props/sand-floor-var3.png",
  sandFloorSpeckled2: "/assets/props/sand-floor-speckled2.png",
  sandFloorVar4: "/assets/props/sand-floor-var4.png",
  sandFloorVar5: "/assets/props/sand-floor-var5.png",
  metalLocker: "/assets/props/metal-locker.png",
  metalLockerVar2: "/assets/props/metal-locker-var2.png",
  shieldEmblem: "/assets/props/shield-emblem.png",
  stoneBrickWall: "/assets/props/stone-brick-wall.png",
  stoneBrickWallVar2: "/assets/props/stone-brick-wall-var2.png",
  stoneBrickWallVar3: "/assets/props/stone-brick-wall-var3.png",
  targetMarker: "/assets/props/target-marker.png",
  bandageIcon: "/assets/props/bandage-icon.png",
  clothIcon: "/assets/props/cloth-icon.png",
  woodDresser: "/assets/props/wood-dresser.png",
  anvil: "/assets/props/anvil.png",
  metalCabinet: "/assets/props/metal-cabinet.png",
  roundShield: "/assets/props/round-shield.png",
  ironGate: "/assets/props/iron-gate.png",
  ironGateVar2: "/assets/props/iron-gate-var2.png",
  spiralRailing: "/assets/props/spiral-railing.png",
  labyrinthFloorPart1: "/assets/props/labyrinth-floor-part1.png",
  labyrinthFloorPart2: "/assets/props/labyrinth-floor-part2.png",
  woodTable: "/assets/props/wood-table.png",
  woodStool: "/assets/props/wood-stool.png",
  golemHead: "/assets/props/golem-head.png",
  woodDresserVar2: "/assets/props/wood-dresser-var2.png",
  woodFence: "/assets/props/wood-fence.png",
  woodFenceVar2: "/assets/props/wood-fence-var2.png",
  woodFenceVar3: "/assets/props/wood-fence-var3.png",
  woodFenceVar4: "/assets/props/wood-fence-var4.png",
  labyrinthFloorPart3: "/assets/props/labyrinth-floor-part3.png",
  labyrinthFloorPart4: "/assets/props/labyrinth-floor-part4.png",
  labyrinthCenter: "/assets/props/labyrinth-center.png",
  labyrinthFloorPart5: "/assets/props/labyrinth-floor-part5.png",
  portraitPurpleWizard: "/assets/props/portrait-purple-wizard.png",
  portraitVillager: "/assets/props/portrait-villager.png",
  portraitVillagerVar2: "/assets/props/portrait-villager-var2.png",
  portraitDwarf: "/assets/props/portrait-dwarf.png",
  portraitVillagerVar3: "/assets/props/portrait-villager-var3.png",
  chestClosed: "/assets/props/chest-closed.png",
  chestOpen: "/assets/props/chest-open.png",
  mimicChest: "/assets/props/mimic-chest.png",
  mimicChestOpenMouth: "/assets/props/mimic-chest-open-mouth.png",
  labyrinthFloorPart6: "/assets/props/labyrinth-floor-part6.png",
  labyrinthFloorPart7: "/assets/props/labyrinth-floor-part7.png",
  labyrinthFloorPart8: "/assets/props/labyrinth-floor-part8.png",
  portraitKnight: "/assets/props/portrait-knight.png",
  portraitKnightVar2: "/assets/props/portrait-knight-var2.png",
  portraitVillagerVar4: "/assets/props/portrait-villager-var4.png",
  portraitGirl: "/assets/props/portrait-girl.png",
  portraitDwarfVar2: "/assets/props/portrait-dwarf-var2.png",
  frameIcon: "/assets/props/frame-icon.png",
  blueGem: "/assets/props/blue-gem.png",
  dagger: "/assets/props/dagger.png",
  sword: "/assets/props/sword.png",
  swordOrnate: "/assets/props/sword-ornate.png",
  swordSilver: "/assets/props/sword-silver.png",
  swordRuby: "/assets/props/sword-ruby.png",
  slimeMonster: "/assets/props/slime-monster.png",
  ogreMonster: "/assets/props/ogre-monster.png",
  crabMonster: "/assets/props/crab-monster.png",
  portraitOldMan: "/assets/props/portrait-old-man.png",
  portraitGreenDwarf: "/assets/props/portrait-green-dwarf.png",
  potionGray: "/assets/props/potion-gray.png",
  potionGreen: "/assets/props/potion-green.png",
  potionRed: "/assets/props/potion-red.png",
  potionBlue: "/assets/props/potion-blue.png",
  hammer: "/assets/props/hammer.png",
  mace: "/assets/props/mace.png",
  flail: "/assets/props/flail.png",
  beastFace: "/assets/props/beast-face.png",
  ghost: "/assets/props/ghost.png",
  monsterShield: "/assets/props/monster-shield.png",
  helmet: "/assets/props/helmet.png",
  helmetVar2: "/assets/props/helmet-var2.png",
  staffGreen: "/assets/props/staff-green.png",
  staffRed: "/assets/props/staff-red.png",
  staffBlueTip: "/assets/props/staff-blue-tip.png",
  staffBlue: "/assets/props/staff-blue.png",
  wandPurple: "/assets/props/wand-purple.png",
  wandBlue: "/assets/props/wand-blue.png",
  swordBasic: "/assets/props/sword-basic.png",
};
const PROP_ICONS: Record<PropType, HTMLImageElement> = Object.fromEntries(
  PROP_TYPES.map((type) => {
    const img = new Image();
    img.onload = () => requestPropIconRedraw?.();
    img.src = PROP_ICON_PATHS[type];
    return [type, img];
  }),
) as Record<PropType, HTMLImageElement>;

function numberToCssColor(hex: number): string {
  return `#${hex.toString(16).padStart(6, "0")}`;
}

function cssColorToNumber(css: string): number {
  return parseInt(css.slice(1), 16) || 0;
}

const CLIFF_COLOR_PRESETS = [
  { label: "Dirt", value: 0x6b4a2f },
  { label: "Rock", value: 0x808080 },
];

export type EditableMap = Omit<GameMapDTO, "id" | "isActive"> & { id?: string };

type Tool =
  | { kind: "tile"; tileType: number }
  | { kind: "elevation" }
  | { kind: "blocksMovement" }
  | { kind: "prop"; propType: PropType | null }
  | { kind: "player-spawn" }
  | { kind: "monster-spawn"; monsterTemplateId: string; isBoss: boolean }
  | { kind: "npc-spawn"; npcTemplateId: string }
  | { kind: "portal"; targetMapId: string };

interface CellState {
  tileType: number;
  elevation: number;
  // Invisible movement/LOS/projectile blocker, independent of tileType — see
  // shared/src/map.ts's WorldGrid.blocksMovementAt. Shown in this editor as
  // a red overlay (see draw()) so it stays paintable despite being invisible
  // in the actual game.
  blocksMovement: boolean;
  // Decorative furniture painted on top of this cell — purely visual, no
  // gameplay effect (pair with blocksMovement on the same cell if it should
  // also be solid). See client/src/assets.ts's PROP_TEXTURE_KEYS.
  propType: PropType | null;
}

const DEFAULT_CELL: CellState = { tileType: TileType.Grass, elevation: 0, blocksMovement: false, propType: null };
const MIN_ELEVATION = -4;
const MAX_ELEVATION = 4;

function tileKey(col: number, row: number): string {
  return `${col},${row}`;
}

// Cached per draw() call: each visible tile's actual on-screen diamond, used
// by hit-testing so clicks resolve against what's actually rendered (crucial
// once elevation makes tiles visually overlap their neighbors) rather than
// an analytical ground-plane guess. Deliberately the UNPADDED corners (see
// SEAM_PAD) — the padded fill corners intentionally overlap between
// neighbors, which would make ordinary flat-terrain clicks near any tile
// boundary ambiguous, not just elevation cliffs.
interface HitTestEntry {
  col: number;
  row: number;
  points: Array<{ x: number; y: number }>;
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

// Standard point-in-convex-polygon test via consistent cross-product sign
// across every edge. A uniform translation (like an elevation shift) never
// changes a convex polygon's winding/convexity, so this stays correct at
// any elevation.
function pointInPolygon(x: number, y: number, points: Array<{ x: number; y: number }>): boolean {
  let sign = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    const cross = (b.x - a.x) * (y - a.y) - (b.y - a.y) * (x - a.x);
    if (cross === 0) continue;
    const s = cross > 0 ? 1 : -1;
    if (sign === 0) sign = s;
    else if (s !== sign) return false;
  }
  return true;
}

export function renderMapEditor(
  container: HTMLElement,
  initialMap: EditableMap,
  monsters: MonsterTemplateDTO[],
  npcs: NpcTemplateDTO[],
  // Every other map, for the portal tool's "where does this lead" dropdown —
  // the map currently being edited is excluded by the caller.
  maps: GameMapDTO[],
  // Undefined mapId (brand-new, unsaved map) means there's nothing painted
  // yet anywhere — callers should skip fetching entirely in that case.
  fetchTiles: (minCol: number, minRow: number, maxCol: number, maxRow: number) => Promise<MapTileDTO[]>,
  onSave: (input: GameMapInput, tiles: MapTileDTO[]) => Promise<void>,
  onCancel: () => void,
): void {
  const state = {
    name: initialMap.name,
    tileSize: initialMap.tileSize,
    ambientSpawnChance: initialMap.ambientSpawnChance,
    cliffColor: initialMap.cliffColor,
    isDungeon: initialMap.isDungeon,
    minLevel: initialMap.minLevel,
    description: initialMap.description,
    playerSpawnCol: Math.floor(initialMap.spawnX / initialMap.tileSize),
    playerSpawnRow: Math.floor(initialMap.spawnY / initialMap.tileSize),
    monsterSpawns: initialMap.spawns.map((s) => ({
      col: Math.floor(s.x / initialMap.tileSize),
      row: Math.floor(s.y / initialMap.tileSize),
      monsterTemplateId: s.monsterTemplateId,
      isBoss: s.isBoss,
    })),
    npcSpawns: initialMap.npcSpawns.map((s) => ({
      col: Math.floor(s.x / initialMap.tileSize),
      row: Math.floor(s.y / initialMap.tileSize),
      npcTemplateId: s.npcTemplateId,
    })),
    ambientSpawns: initialMap.ambientSpawns.map((a) => ({ monsterTemplateId: a.monsterTemplateId, weight: a.weight })),
    portals: initialMap.portals.map((p) => ({
      col: Math.floor(p.x / initialMap.tileSize),
      row: Math.floor(p.y / initialMap.tileSize),
      targetMapId: p.targetMapId,
    })),
    // Already order-sorted by the API (see server/src/api/maps.ts's toDTO).
    dungeonObjectives: initialMap.dungeonObjectives.map((o) => ({
      description: o.description,
      kind: o.kind,
      monsterTemplateId: o.monsterTemplateId,
      requiredCount: o.requiredCount,
    })),
  };

  // Camera lives in PROJECTED space (isoProject's output units) — cameraProjX/Y
  // is whatever projected point appears at the canvas center, `zoom` is
  // canvas-pixels-per-projected-unit. Initialized centered on the player spawn.
  const initialProj = isoProject(
    state.playerSpawnCol * state.tileSize + state.tileSize / 2,
    state.playerSpawnRow * state.tileSize + state.tileSize / 2,
  );
  let cameraProjX = initialProj.x;
  let cameraProjY = initialProj.y;
  let zoom = DEFAULT_ZOOM;
  let tool: Tool = { kind: "tile", tileType: TileType.Grass };

  // Last-fetched tiles for whatever range has been viewed so far, and
  // not-yet-saved paints — dirtyTiles is independent of the viewport and
  // survives panning/zooming until Save (or the editor is closed). Each
  // entry holds full per-cell state (tileType + elevation) since the two
  // are independently paintable but stored together.
  const loadedTiles = new Map<string, CellState>();
  const dirtyTiles = new Map<string, CellState>();
  let hitTestCache: HitTestEntry[] = [];

  const wrapper = document.createElement("div");
  wrapper.className = "map-editor";

  const layout = document.createElement("div");
  layout.className = "map-editor-layout";

  // --- Palette: Unity-Tile-Palette-style side panel. Click an item to arm
  // it as the active tool (selectTool), then click the canvas to place it
  // (applyToolAt) — every tab below funnels into that same two-step flow. ---
  const palette = document.createElement("div");
  palette.className = "map-editor-palette";
  const paletteTabs = document.createElement("div");
  paletteTabs.className = "palette-tabs";
  const paletteBody = document.createElement("div");
  paletteBody.className = "palette-body";
  palette.append(paletteTabs, paletteBody);

  const toolButtons: HTMLButtonElement[] = [];

  function selectTool(newTool: Tool, btn: HTMLButtonElement) {
    tool = newTool;
    toolButtons.forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
  }

  const paletteSections = new Map<string, HTMLElement>();
  const paletteTabButtons = new Map<string, HTMLButtonElement>();

  function showPaletteTab(key: string) {
    for (const [k, section] of paletteSections) section.classList.toggle("active", k === key);
    for (const [k, btn] of paletteTabButtons) btn.classList.toggle("active", k === key);
  }

  function addPaletteTab(key: string, label: string): HTMLElement {
    const tabBtn = document.createElement("button");
    tabBtn.type = "button";
    tabBtn.className = "palette-tab";
    tabBtn.textContent = label;
    tabBtn.addEventListener("click", () => showPaletteTab(key));
    paletteTabs.appendChild(tabBtn);
    paletteTabButtons.set(key, tabBtn);

    const section = document.createElement("div");
    section.className = "palette-section";
    paletteBody.appendChild(section);
    paletteSections.set(key, section);
    return section;
  }

  // A palette item is itself the tool-select control — no separate dropdown
  // + "activate" button like the old toolbar had; clicking "Goblin" arms
  // the monster-spawn tool for Goblin directly. iconSrc (when given) draws
  // an actual thumbnail of the block/prop art instead of (not alongside) a
  // flat swatchColor — with 190+ blocks/props now in the palette, a color
  // dot alone or a bare label doesn't tell them apart.
  function addPaletteItem(
    section: HTMLElement,
    label: string,
    swatchColor: string | null,
    onClick: (item: HTMLButtonElement) => void,
    iconSrc?: string,
  ): HTMLButtonElement {
    const item = document.createElement("button");
    item.type = "button";
    item.className = "palette-item";
    if (iconSrc) {
      const thumb = document.createElement("img");
      thumb.className = "palette-thumb";
      thumb.src = iconSrc;
      thumb.alt = "";
      item.appendChild(thumb);
    } else if (swatchColor) {
      const swatch = document.createElement("span");
      swatch.className = "palette-swatch";
      swatch.style.background = swatchColor;
      item.appendChild(swatch);
    }
    const text = document.createElement("span");
    text.textContent = label;
    item.appendChild(text);
    item.addEventListener("click", () => onClick(item));
    section.appendChild(item);
    toolButtons.push(item);
    return item;
  }

  // --- Tiles ---
  const tilesSection = addPaletteTab("tiles", "Tiles");
  const tileButtons: Array<{ label: string; tileType: number }> = [
    { label: "Grass", tileType: TileType.Grass },
    { label: "Path", tileType: TileType.Path },
    { label: "Water", tileType: TileType.Water },
    { label: "Wall", tileType: TileType.Wall },
    { label: "Sand", tileType: TileType.Sand },
    { label: "Snow", tileType: TileType.Snow },
    { label: "Green Block", tileType: TileType.GreenBlock },
    { label: "Orange Terracotta Solid", tileType: TileType.OrangeTerracottaSolid },
    { label: "Hedge", tileType: TileType.Hedge },
    { label: "Ice", tileType: TileType.Ice },
    { label: "Cracked Ice", tileType: TileType.CrackedIce },
    { label: "Molten Rock", tileType: TileType.MoltenRock },
    { label: "Stone", tileType: TileType.Stone },
    { label: "Grass Stone Sides", tileType: TileType.GrassStoneSides },
    { label: "Dirt Stone Sides", tileType: TileType.DirtStoneSides },
    { label: "Sand Stone Sides", tileType: TileType.SandStoneSides },
    { label: "Snow Stone Sides", tileType: TileType.SnowStoneSides },
    { label: "Wood Log", tileType: TileType.WoodLog },
    { label: "Marble", tileType: TileType.Marble },
    { label: "Jade Block", tileType: TileType.JadeBlock },
    { label: "Red Brick", tileType: TileType.RedBrick },
    { label: "Sandstone", tileType: TileType.Sandstone },
    { label: "White Marble Solid", tileType: TileType.WhiteMarbleSolid },
    { label: "Terracotta Smooth", tileType: TileType.TerracottaSmooth },
    { label: "Green Wool", tileType: TileType.GreenWool },
    { label: "Blue Wool", tileType: TileType.BlueWool },
    { label: "Cream Wool", tileType: TileType.CreamWool },
    { label: "Wood Planks", tileType: TileType.WoodPlanks },
    { label: "Brick Coursed", tileType: TileType.BrickCoursed },
    { label: "Rocky Dirt", tileType: TileType.RockyDirt },
    { label: "Speckled Stone", tileType: TileType.SpeckledStone },
    { label: "Dark Stone Brick", tileType: TileType.DarkStoneBrick },
    { label: "Coal Ore", tileType: TileType.CoalOre },
    { label: "Emerald Ore", tileType: TileType.EmeraldOre },
    { label: "Copper Ore", tileType: TileType.CopperOre },
    { label: "Iron Ore", tileType: TileType.IronOre },
    { label: "Gold Ore", tileType: TileType.GoldOre },
    { label: "Diamond Ore", tileType: TileType.DiamondOre },
    { label: "Red Clay", tileType: TileType.RedClay },
    { label: "Red Clay Mottled", tileType: TileType.RedClayMottled },
    { label: "Red Clay Rough", tileType: TileType.RedClayRough },
    { label: "Red Clay Emerald", tileType: TileType.RedClayEmerald },
    { label: "Red Clay Emerald Rich", tileType: TileType.RedClayEmeraldRich },
    { label: "Basalt Coal", tileType: TileType.BasaltCoal },
    { label: "Stone Emerald Alt", tileType: TileType.StoneEmeraldAlt },
    { label: "Stone Copper Alt", tileType: TileType.StoneCopperAlt },
    { label: "Stone Iron Alt", tileType: TileType.StoneIronAlt },
    { label: "Stone Gold Rich", tileType: TileType.StoneGoldRich },
    { label: "Stone Diamond Alt", tileType: TileType.StoneDiamondAlt },
    { label: "Light Gray Stone", tileType: TileType.LightGrayStone },
    { label: "Pale Stone", tileType: TileType.PaleStone },
    { label: "Slate Stone", tileType: TileType.SlateStone },
    { label: "Slate Ruby", tileType: TileType.SlateRuby },
    { label: "Slate Ruby Rich", tileType: TileType.SlateRubyRich },
    { label: "Dirt Solid", tileType: TileType.DirtSolid },
    { label: "Grass Solid Bright", tileType: TileType.GrassSolidBright },
    { label: "Grass Classic", tileType: TileType.GrassClassic },
  ];
  for (const { label, tileType } of tileButtons) {
    addPaletteItem(
      tilesSection,
      label,
      TILE_COLORS[tileType],
      (item) => selectTool({ kind: "tile", tileType }, item),
      TILE_ICON_PATHS[tileType],
    );
  }

  // --- Elevation ---
  // A separate paintable attribute from tile type, applied to whatever's
  // already at a cell rather than replacing it — see applyToolAt. The
  // number input's live value is read at paint time (not captured into the
  // Tool), so changing it doesn't require reselecting.
  const elevationSection = addPaletteTab("elevation", "Elevation");
  const elevationFieldLabel = document.createElement("label");
  elevationFieldLabel.className = "palette-field";
  elevationFieldLabel.textContent = `Level (${MIN_ELEVATION}..${MAX_ELEVATION})`;
  const elevationInput = document.createElement("input");
  elevationInput.type = "number";
  elevationInput.min = String(MIN_ELEVATION);
  elevationInput.max = String(MAX_ELEVATION);
  elevationInput.step = "1";
  elevationInput.value = "1";
  elevationFieldLabel.appendChild(elevationInput);
  elevationSection.appendChild(elevationFieldLabel);
  addPaletteItem(elevationSection, "Elevation Tool", null, (item) => selectTool({ kind: "elevation" }, item));

  // --- Barrier (invisible movement/LOS/projectile blocker) ---
  // Also applied to whatever's already at a cell rather than replacing it,
  // same as Elevation — click a cell to toggle the flag on/off. Shown in
  // this editor as a red overlay (see draw()) since it's otherwise
  // invisible in actual gameplay; the intended use is hand-defining a hard
  // edge (or any other invisible obstacle) on an otherwise-infinite map
  // without needing a visible wall there.
  const barrierSection = addPaletteTab("barrier", "Barrier");
  const barrierHint = document.createElement("p");
  barrierHint.className = "palette-empty";
  barrierHint.textContent = "Click a cell to toggle an invisible movement/line-of-sight blocker on top of it.";
  barrierSection.appendChild(barrierHint);
  addPaletteItem(barrierSection, "Barrier Tool", null, (item) => selectTool({ kind: "blocksMovement" }, item));

  // --- Furniture (decorative props, for building houses/dungeons) ---
  // Also applied on top of whatever's already at a cell, same as Elevation/
  // Barrier — click a cell to set/replace its prop, or use Clear to remove
  // one. Purely visual (see PropType) — pair with the Barrier tool on the
  // same cell if a piece should also block movement (e.g. a dresser
  // blocking a doorway).
  const furnitureSection = addPaletteTab("furniture", "Furniture");
  const furnitureHint = document.createElement("p");
  furnitureHint.className = "palette-empty";
  furnitureHint.textContent = "Click a cell to place/replace a decorative prop on top of it.";
  furnitureSection.appendChild(furnitureHint);
  const PROP_LABELS: Record<PropType, string> = {
    table: "Table",
    chest: "Chest",
    dresser: "Dresser",
    barrel: "Barrel",
    torch: "Torch",
    door: "Door",
    fence: "Fence",
    gravestone: "Gravestone",
    furnace: "Furnace",
    crate: "Crate",
    dirtFloor: "Dirt Floor",
    dirtFloorVar2: "Dirt Floor Var 2",
    dirtFloorVar3: "Dirt Floor Var 3",
    dirtFloorVar4: "Dirt Floor Var 4",
    stoneArchwayTopLeft: "Stone Archway Top Left",
    stoneArchwayTopRight: "Stone Archway Top Right",
    stonePillarTop: "Stone Pillar Top",
    ironSconce: "Iron Sconce",
    torchSconceGreen: "Torch Sconce Green",
    greenGemTorch: "Green Gem Torch",
    darkFloor: "Dark Floor",
    darkFloorVar2: "Dark Floor Var 2",
    dirtFloorPebbles: "Dirt Floor Pebbles",
    dirtFloorPebbles2: "Dirt Floor Pebbles 2",
    stoneArchwayOpenLeft: "Stone Archway Open Left",
    stoneArchwayOpenRight: "Stone Archway Open Right",
    stonePillarBase: "Stone Pillar Base",
    stonePillarCap: "Stone Pillar Cap",
    wallSconce: "Wall Sconce",
    gargoyleFaceLeft: "Gargoyle Face Left",
    gargoyleFaceRight: "Gargoyle Face Right",
    darkWall: "Dark Wall",
    darkWallVar2: "Dark Wall Var 2",
    darkWallVar3: "Dark Wall Var 3",
    dirtFloorRocks: "Dirt Floor Rocks",
    dirtFloorRocks2: "Dirt Floor Rocks 2",
    stoneFrameLeft: "Stone Frame Left",
    stoneFrameRight: "Stone Frame Right",
    stoneWall: "Stone Wall",
    redBanner: "Red Banner",
    sandFloor: "Sand Floor",
    stoneVent: "Stone Vent",
    emeraldAltar: "Emerald Altar",
    woodDoorClosedLeft: "Wood Door Closed Left",
    woodDoorClosedMid: "Wood Door Closed Mid",
    woodDoorClosedRight: "Wood Door Closed Right",
    plankWall: "Plank Wall",
    plankWallVar2: "Plank Wall Var 2",
    plankWallVar3: "Plank Wall Var 3",
    plankWallEdge: "Plank Wall Edge",
    stoneWallVar2: "Stone Wall Var 2",
    crossWindow: "Cross Window",
    stoneFloorTiles: "Stone Floor Tiles",
    stoneSarcophagus: "Stone Sarcophagus",
    emeraldSarcophagus: "Emerald Sarcophagus",
    woodDoorKnobLeft: "Wood Door Knob Left",
    woodDoorKnobMid: "Wood Door Knob Mid",
    woodDoorKnobRight: "Wood Door Knob Right",
    sandFloorVar2: "Sand Floor Var 2",
    sandFloorSpeckled: "Sand Floor Speckled",
    sandFloorVar3: "Sand Floor Var 3",
    sandFloorSpeckled2: "Sand Floor Speckled 2",
    sandFloorVar4: "Sand Floor Var 4",
    sandFloorVar5: "Sand Floor Var 5",
    metalLocker: "Metal Locker",
    metalLockerVar2: "Metal Locker Var 2",
    shieldEmblem: "Shield Emblem",
    stoneBrickWall: "Stone Brick Wall",
    stoneBrickWallVar2: "Stone Brick Wall Var 2",
    stoneBrickWallVar3: "Stone Brick Wall Var 3",
    targetMarker: "Target Marker",
    bandageIcon: "Bandage Icon",
    clothIcon: "Cloth Icon",
    woodDresser: "Wood Dresser",
    anvil: "Anvil",
    metalCabinet: "Metal Cabinet",
    roundShield: "Round Shield",
    ironGate: "Iron Gate",
    ironGateVar2: "Iron Gate Var 2",
    spiralRailing: "Spiral Railing",
    labyrinthFloorPart1: "Labyrinth Floor Part 1",
    labyrinthFloorPart2: "Labyrinth Floor Part 2",
    woodTable: "Wood Table",
    woodStool: "Wood Stool",
    golemHead: "Golem Head",
    woodDresserVar2: "Wood Dresser Var 2",
    woodFence: "Wood Fence",
    woodFenceVar2: "Wood Fence Var 2",
    woodFenceVar3: "Wood Fence Var 3",
    woodFenceVar4: "Wood Fence Var 4",
    labyrinthFloorPart3: "Labyrinth Floor Part 3",
    labyrinthFloorPart4: "Labyrinth Floor Part 4",
    labyrinthCenter: "Labyrinth Center",
    labyrinthFloorPart5: "Labyrinth Floor Part 5",
    portraitPurpleWizard: "Portrait Purple Wizard",
    portraitVillager: "Portrait Villager",
    portraitVillagerVar2: "Portrait Villager Var 2",
    portraitDwarf: "Portrait Dwarf",
    portraitVillagerVar3: "Portrait Villager Var 3",
    chestClosed: "Chest Closed",
    chestOpen: "Chest Open",
    mimicChest: "Mimic Chest",
    mimicChestOpenMouth: "Mimic Chest Open Mouth",
    labyrinthFloorPart6: "Labyrinth Floor Part 6",
    labyrinthFloorPart7: "Labyrinth Floor Part 7",
    labyrinthFloorPart8: "Labyrinth Floor Part 8",
    portraitKnight: "Portrait Knight",
    portraitKnightVar2: "Portrait Knight Var 2",
    portraitVillagerVar4: "Portrait Villager Var 4",
    portraitGirl: "Portrait Girl",
    portraitDwarfVar2: "Portrait Dwarf Var 2",
    frameIcon: "Frame Icon",
    blueGem: "Blue Gem",
    dagger: "Dagger",
    sword: "Sword",
    swordOrnate: "Sword Ornate",
    swordSilver: "Sword Silver",
    swordRuby: "Sword Ruby",
    slimeMonster: "Slime Monster",
    ogreMonster: "Ogre Monster",
    crabMonster: "Crab Monster",
    portraitOldMan: "Portrait Old Man",
    portraitGreenDwarf: "Portrait Green Dwarf",
    potionGray: "Potion Gray",
    potionGreen: "Potion Green",
    potionRed: "Potion Red",
    potionBlue: "Potion Blue",
    hammer: "Hammer",
    mace: "Mace",
    flail: "Flail",
    beastFace: "Beast Face",
    ghost: "Ghost",
    monsterShield: "Monster Shield",
    helmet: "Helmet",
    helmetVar2: "Helmet Var 2",
    staffGreen: "Staff Green",
    staffRed: "Staff Red",
    staffBlueTip: "Staff Blue Tip",
    staffBlue: "Staff Blue",
    wandPurple: "Wand Purple",
    wandBlue: "Wand Blue",
    swordBasic: "Sword Basic",
  };
  for (const propType of PROP_TYPES) {
    addPaletteItem(
      furnitureSection,
      PROP_LABELS[propType],
      null,
      (item) => selectTool({ kind: "prop", propType }, item),
      PROP_ICON_PATHS[propType],
    );
  }
  addPaletteItem(furnitureSection, "Clear Furniture", null, (item) => selectTool({ kind: "prop", propType: null }, item));

  // --- Spawn (player start point) ---
  const spawnSection = addPaletteTab("spawn", "Spawn");
  addPaletteItem(spawnSection, "Player Spawn", null, (item) => selectTool({ kind: "player-spawn" }, item));

  // --- Monsters ---
  const monstersSection = addPaletteTab("monsters", "Monsters");
  // Marks the placement (not the template — the same monster could be
  // placed several times) as a dungeon's boss. Captured into the tool at
  // click time, same as which monster was clicked.
  const isBossLabel = document.createElement("label");
  isBossLabel.className = "palette-field-inline";
  const isBossInput = document.createElement("input");
  isBossInput.type = "checkbox";
  isBossLabel.append(isBossInput, document.createTextNode(" Mark as boss"));
  monstersSection.appendChild(isBossLabel);
  if (monsters.length === 0) {
    const empty = document.createElement("div");
    empty.className = "palette-empty";
    empty.textContent = "No monsters yet";
    monstersSection.appendChild(empty);
  }
  for (const m of monsters) {
    addPaletteItem(monstersSection, m.name, colorFor(m.id), (item) =>
      selectTool({ kind: "monster-spawn", monsterTemplateId: m.id, isBoss: isBossInput.checked }, item),
    );
  }

  // --- NPCs ---
  const npcsSection = addPaletteTab("npcs", "NPCs");
  if (npcs.length === 0) {
    const empty = document.createElement("div");
    empty.className = "palette-empty";
    empty.textContent = "No NPCs yet";
    npcsSection.appendChild(empty);
  }
  for (const n of npcs) {
    addPaletteItem(npcsSection, n.name, colorFor(n.id), (item) => selectTool({ kind: "npc-spawn", npcTemplateId: n.id }, item));
  }

  // --- Portals ---
  // A portal leading to no map isn't meaningful, so the tab just explains
  // that instead of offering anything to click — matches this editor's
  // general style of not over-validating (see the module-level comment on
  // cycle detection being skipped for talent prerequisites).
  const portalsSection = addPaletteTab("portals", "Portals");
  if (maps.length === 0) {
    const empty = document.createElement("div");
    empty.className = "palette-empty";
    empty.textContent = "No other maps to link to yet";
    portalsSection.appendChild(empty);
  } else {
    for (const m of maps) {
      addPaletteItem(portalsSection, `${m.name}${m.isDungeon ? " (dungeon)" : ""}`, null, (item) =>
        selectTool({ kind: "portal", targetMapId: m.id }, item),
      );
    }
  }

  // --- Settings (map-wide, not a placeable tool) ---
  const settingsSection = addPaletteTab("settings", "Settings");

  const nameFieldLabel = document.createElement("label");
  nameFieldLabel.className = "palette-field";
  nameFieldLabel.textContent = "Map name";
  const nameInput = document.createElement("input");
  nameInput.value = state.name;
  nameInput.addEventListener("input", () => {
    state.name = nameInput.value;
  });
  nameFieldLabel.appendChild(nameInput);
  settingsSection.appendChild(nameFieldLabel);

  // A dungeon map is never the (single) active overworld map — it's only
  // ever reached through a portal, as its own instanced room. minLevel
  // gates entry (checked against every member of the entering party) and
  // only matters when isDungeon is checked.
  const isDungeonLabel = document.createElement("label");
  isDungeonLabel.className = "palette-field-inline";
  const isDungeonInput = document.createElement("input");
  isDungeonInput.type = "checkbox";
  isDungeonInput.checked = state.isDungeon;
  isDungeonLabel.append(isDungeonInput, document.createTextNode(" Dungeon"));
  settingsSection.appendChild(isDungeonLabel);

  const minLevelFieldLabel = document.createElement("label");
  minLevelFieldLabel.className = "palette-field";
  minLevelFieldLabel.textContent = "Min level to enter";
  const minLevelInput = document.createElement("input");
  minLevelInput.type = "number";
  minLevelInput.min = "1";
  minLevelInput.step = "1";
  minLevelInput.value = String(state.minLevel);
  minLevelFieldLabel.style.display = state.isDungeon ? "" : "none";
  isDungeonInput.addEventListener("change", () => {
    state.isDungeon = isDungeonInput.checked;
    minLevelFieldLabel.style.display = state.isDungeon ? "" : "none";
  });
  minLevelInput.addEventListener("input", () => {
    state.minLevel = Math.max(1, Math.round(Number(minLevelInput.value)) || 1);
  });
  minLevelFieldLabel.appendChild(minLevelInput);
  settingsSection.appendChild(minLevelFieldLabel);

  // Shown to players in the entry prompt before they commit to a dungeon —
  // only meaningful (and only shown here) when isDungeon is checked, same
  // gating as minLevel above.
  const descriptionFieldLabel = document.createElement("label");
  descriptionFieldLabel.className = "palette-field";
  descriptionFieldLabel.textContent = "Dungeon description";
  const descriptionInput = document.createElement("textarea");
  descriptionInput.rows = 3;
  descriptionInput.value = state.description;
  descriptionFieldLabel.style.display = state.isDungeon ? "" : "none";
  isDungeonInput.addEventListener("change", () => {
    descriptionFieldLabel.style.display = state.isDungeon ? "" : "none";
  });
  descriptionInput.addEventListener("input", () => {
    state.description = descriptionInput.value;
  });
  descriptionFieldLabel.appendChild(descriptionInput);
  settingsSection.appendChild(descriptionFieldLabel);

  // Solid fill color for the "riser" face drawn between two tiles of
  // different elevation (see draw()'s drawCliffFace) — e.g. brown for a
  // dirt cliff, gray for stone if building a castle. Saved per-map so the
  // actual game renders the same color, not just the editor preview.
  const cliffColorFieldLabel = document.createElement("label");
  cliffColorFieldLabel.className = "palette-field";
  cliffColorFieldLabel.textContent = "Cliff color";
  const cliffColorInput = document.createElement("input");
  cliffColorInput.type = "color";
  cliffColorInput.value = numberToCssColor(state.cliffColor);
  cliffColorInput.addEventListener("input", () => {
    state.cliffColor = cssColorToNumber(cliffColorInput.value);
    draw();
  });
  cliffColorFieldLabel.appendChild(cliffColorInput);
  settingsSection.appendChild(cliffColorFieldLabel);

  const cliffPresetsRow = document.createElement("div");
  cliffPresetsRow.className = "palette-preset-row";
  for (const preset of CLIFF_COLOR_PRESETS) {
    const presetBtn = document.createElement("button");
    presetBtn.type = "button";
    presetBtn.textContent = preset.label;
    presetBtn.style.background = numberToCssColor(preset.value);
    presetBtn.style.color = "#fff";
    presetBtn.addEventListener("click", () => {
      state.cliffColor = preset.value;
      cliffColorInput.value = numberToCssColor(preset.value);
      draw();
    });
    cliffPresetsRow.appendChild(presetBtn);
  }
  settingsSection.appendChild(cliffPresetsRow);

  // Ambient (procedural) spawn config — which monsters can appear as
  // players wander into unpainted territory, and how often.
  const ambientChanceFieldLabel = document.createElement("label");
  ambientChanceFieldLabel.className = "palette-field";
  ambientChanceFieldLabel.textContent = "Ambient spawn chance per chunk (0-1)";
  const ambientChanceInput = document.createElement("input");
  ambientChanceInput.type = "number";
  ambientChanceInput.min = "0";
  ambientChanceInput.max = "1";
  ambientChanceInput.step = "0.05";
  ambientChanceInput.value = String(state.ambientSpawnChance);
  ambientChanceInput.addEventListener("input", () => {
    state.ambientSpawnChance = Number(ambientChanceInput.value) || 0;
  });
  ambientChanceFieldLabel.appendChild(ambientChanceInput);
  settingsSection.appendChild(ambientChanceFieldLabel);

  const ambientSubheading = document.createElement("div");
  ambientSubheading.className = "palette-subheading";
  ambientSubheading.textContent = "Ambient spawns";
  settingsSection.appendChild(ambientSubheading);

  const monsterOptionsWithNone = [{ value: "", label: "-- none --" }, ...monsters.map((m) => ({ value: m.id, label: m.name }))];
  const ambientRows: Array<{ select: HTMLSelectElement; weight: HTMLInputElement }> = [];
  for (let i = 0; i < AMBIENT_SLOT_COUNT; i++) {
    const rule = state.ambientSpawns[i];
    const row = document.createElement("div");
    row.className = "palette-ambient-row";
    const select = document.createElement("select");
    for (const opt of monsterOptionsWithNone) {
      const el = document.createElement("option");
      el.value = opt.value;
      el.textContent = opt.label;
      select.appendChild(el);
    }
    select.value = rule?.monsterTemplateId ?? "";
    const weight = document.createElement("input");
    weight.type = "number";
    weight.min = "0";
    weight.step = "0.5";
    weight.value = String(rule?.weight ?? 1);
    row.append(select, weight);
    settingsSection.appendChild(row);
    ambientRows.push({ select, weight });
  }

  // --- Objectives: only meaningful for a dungeon map (see isDungeon above)
  // — completing every defined objective clears the dungeon instead of the
  // old hardcoded "any boss kill clears it" rule (see WorldRoom.
  // updateDungeonObjectives). Leaving every row blank (kind "-- none --")
  // keeps that old behavior unchanged, same as leaving an ambient-spawn or
  // drop slot empty elsewhere in this editor.
  const objectivesSection = addPaletteTab("objectives", "Objectives");
  const objectivesTabBtn = paletteTabButtons.get("objectives")!;
  const updateObjectivesTabVisibility = () => {
    objectivesTabBtn.style.display = state.isDungeon ? "" : "none";
  };
  updateObjectivesTabVisibility();
  isDungeonInput.addEventListener("change", updateObjectivesTabVisibility);

  const objectivesHint = document.createElement("p");
  objectivesHint.className = "palette-empty";
  objectivesHint.textContent =
    'Completing every objective below clears the dungeon (spawns the exit portal). Leave a row\'s kind as "-- none --" to skip it.';
  objectivesSection.appendChild(objectivesHint);

  const OBJECTIVE_KIND_OPTIONS: Array<{ value: DungeonObjectiveKind | ""; label: string }> = [
    { value: "", label: "-- none --" },
    { value: "killBoss", label: "Kill the boss" },
    { value: "killAllMonsters", label: "Kill every monster" },
    { value: "killCount", label: "Kill a number of a specific monster" },
  ];

  const objectiveRows: Array<{
    description: HTMLInputElement;
    kind: HTMLSelectElement;
    monsterSelect: HTMLSelectElement;
    requiredCount: HTMLInputElement;
  }> = [];
  for (let i = 0; i < OBJECTIVE_SLOT_COUNT; i++) {
    const objective = state.dungeonObjectives[i];
    const row = document.createElement("div");
    row.className = "palette-objective-row";

    const description = document.createElement("input");
    description.type = "text";
    description.placeholder = "Description (e.g. Defeat the Bone Golem)";
    description.value = objective?.description ?? "";

    const kind = document.createElement("select");
    for (const opt of OBJECTIVE_KIND_OPTIONS) {
      const el = document.createElement("option");
      el.value = opt.value;
      el.textContent = opt.label;
      kind.appendChild(el);
    }
    kind.value = objective?.kind ?? "";

    const monsterSelect = document.createElement("select");
    for (const opt of monsterOptionsWithNone) {
      const el = document.createElement("option");
      el.value = opt.value;
      el.textContent = opt.label;
      monsterSelect.appendChild(el);
    }
    monsterSelect.value = objective?.monsterTemplateId ?? "";

    const requiredCount = document.createElement("input");
    requiredCount.type = "number";
    requiredCount.min = "1";
    requiredCount.step = "1";
    requiredCount.value = String(objective?.requiredCount ?? 1);

    // Only killCount needs a specific monster + a target count — killBoss
    // is always "the" boss and killAllMonsters' target is computed
    // server-side from the dungeon's own hand-placed monster count.
    const updateRowVisibility = () => {
      const isKillCount = kind.value === "killCount";
      monsterSelect.style.display = isKillCount ? "" : "none";
      requiredCount.style.display = isKillCount ? "" : "none";
    };
    updateRowVisibility();
    kind.addEventListener("change", updateRowVisibility);

    row.append(description, kind, monsterSelect, requiredCount);
    objectivesSection.appendChild(row);
    objectiveRows.push({ description, kind, monsterSelect, requiredCount });
  }

  showPaletteTab("tiles");
  toolButtons[0]?.classList.add("active");

  // --- Main column: view controls, canvas, save/cancel ---
  const main = document.createElement("div");
  main.className = "map-editor-main";

  // Pan/zoom controls — the canvas shows a fixed-size window into an
  // unbounded world; these move the camera instead of resizing a bounded
  // grid, which no longer exists.
  const viewToolbar = document.createElement("div");
  viewToolbar.className = "map-editor-viewbar";

  function addViewButton(label: string, onClick: () => void) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.textContent = label;
    btn.addEventListener("click", onClick);
    viewToolbar.appendChild(btn);
    return btn;
  }

  addViewButton("←", () => pan(-1, 0));
  addViewButton("↑", () => pan(0, -1));
  addViewButton("↓", () => pan(0, 1));
  addViewButton("→", () => pan(1, 0));
  addViewButton("Center on spawn", () => {
    const proj = isoProject(
      state.playerSpawnCol * state.tileSize + state.tileSize / 2,
      state.playerSpawnRow * state.tileSize + state.tileSize / 2,
    );
    cameraProjX = proj.x;
    cameraProjY = proj.y;
    draw();
    void loadVisibleRange();
  });
  addViewButton("Zoom in", () => zoomBy(ZOOM_STEP_FACTOR));
  addViewButton("Zoom out", () => zoomBy(1 / ZOOM_STEP_FACTOR));
  const coordsLabel = document.createElement("span");
  coordsLabel.className = "map-editor-coords";
  viewToolbar.appendChild(coordsLabel);

  const canvas = document.createElement("canvas");
  canvas.width = CANVAS_WIDTH;
  canvas.height = CANVAS_HEIGHT;
  canvas.className = "map-editor-canvas";
  canvas.addEventListener("contextmenu", (e) => e.preventDefault());
  const ctx = canvas.getContext("2d")!;

  // --- Coordinate space helpers -------------------------------------------
  // Three spaces are in play: raw WORLD pixels (simulation truth), PROJECTED
  // space (isoProject's output — camera position lives here), and SCREEN
  // pixels (what's actually drawn). Every call site goes through these
  // named helpers rather than inlining the arithmetic, specifically to keep
  // the three spaces from getting mixed up.
  function worldToProjected(worldX: number, worldY: number): { x: number; y: number } {
    return isoProject(worldX, worldY);
  }

  function projectedToScreen(px: number, py: number): { x: number; y: number } {
    return { x: (px - cameraProjX) * zoom + CANVAS_WIDTH / 2, y: (py - cameraProjY) * zoom + CANVAS_HEIGHT / 2 };
  }

  function screenToProjected(sx: number, sy: number): { x: number; y: number } {
    return { x: (sx - CANVAS_WIDTH / 2) / zoom + cameraProjX, y: (sy - CANVAS_HEIGHT / 2) / zoom + cameraProjY };
  }

  // Elevation shift MUST happen in projected space, before the camera/zoom
  // transform — doing it after would make tiles rise by a constant pixel
  // amount regardless of zoom instead of scaling with it.
  function worldToScreen(worldX: number, worldY: number, elevation: number, tileSize: number): { x: number; y: number } {
    const p = worldToProjected(worldX, worldY);
    return projectedToScreen(p.x, p.y - isoElevationOffset(elevation, tileSize));
  }

  // Which (col,row) tile range is visible, clamped to a safe upper bound so
  // zooming far out can never trigger an oversized/rejected fetch. A
  // screen-aligned rect unprojects to a rotated quadrilateral in world
  // space, not another axis-aligned rect, so all 4 corners are unprojected
  // and the bounding box taken across them (same technique the game client
  // uses for chunk streaming — WorldScene.refreshVisibleChunks).
  function visibleTileRange(): { minCol: number; minRow: number; maxCol: number; maxRow: number; clamped: boolean } {
    const tileSize = state.tileSize;
    const corners = [
      screenToProjected(0, 0),
      screenToProjected(CANVAS_WIDTH, 0),
      screenToProjected(0, CANVAS_HEIGHT),
      screenToProjected(CANVAS_WIDTH, CANVAS_HEIGHT),
    ].map((p) => isoUnproject(p.x, p.y));

    let minCol = Math.floor(Math.min(...corners.map((c) => c.x)) / tileSize);
    let minRow = Math.floor(Math.min(...corners.map((c) => c.y)) / tileSize);
    let maxCol = Math.ceil(Math.max(...corners.map((c) => c.x)) / tileSize);
    let maxRow = Math.ceil(Math.max(...corners.map((c) => c.y)) / tileSize);

    let clamped = false;
    const centerWorld = isoUnproject(cameraProjX, cameraProjY);
    const half = Math.floor(MAX_VISIBLE_TILES_PER_AXIS / 2);
    if (maxCol - minCol + 1 > MAX_VISIBLE_TILES_PER_AXIS) {
      const centerCol = Math.floor(centerWorld.x / tileSize);
      minCol = centerCol - half;
      maxCol = centerCol + half;
      clamped = true;
    }
    if (maxRow - minRow + 1 > MAX_VISIBLE_TILES_PER_AXIS) {
      const centerRow = Math.floor(centerWorld.y / tileSize);
      minRow = centerRow - half;
      maxRow = centerRow + half;
      clamped = true;
    }

    return { minCol, minRow, maxCol, maxRow, clamped };
  }

  function cellAt(col: number, row: number): CellState {
    const key = tileKey(col, row);
    return dirtyTiles.get(key) ?? loadedTiles.get(key) ?? DEFAULT_CELL;
  }

  async function loadVisibleRange() {
    if (!initialMap.id) return; // brand-new, unsaved map — nothing painted anywhere yet
    const { minCol, minRow, maxCol, maxRow } = visibleTileRange();
    try {
      const tiles = await fetchTiles(minCol, minRow, maxCol, maxRow);
      for (const t of tiles)
        loadedTiles.set(tileKey(t.col, t.row), {
          tileType: t.tileType,
          elevation: t.elevation,
          blocksMovement: t.blocksMovement,
          propType: t.propType,
        });
    } catch (err) {
      console.error("Failed to load map tiles:", err);
    }
    draw();
  }

  function colorFor(id: string): string {
    // stable-ish color per template id so different types are visually
    // distinguishable on the grid without needing a full legend
    let hash = 0;
    for (const char of id) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
    const hue = hash % 360;
    return `hsl(${hue}, 80%, 55%)`;
  }

  // Fills the vertical gap between two adjacent tiles at different
  // elevations with a solid color — a simplified "riser" wall face (not
  // true 3D geometry). (worldX1,worldY1)-(worldX2,worldY2) is their shared
  // edge in raw world space; topElevation belongs to the higher (current)
  // tile, bottomElevation to the lower neighbor. riserColor is the map's
  // generic dirt cliffColor for ordinary terrain, but a Wall tile uses its
  // own flat color instead — a wall block should read as one solid color
  // regardless of which elevation it's placed at.
  function drawCliffFace(
    worldX1: number,
    worldY1: number,
    worldX2: number,
    worldY2: number,
    topElevation: number,
    bottomElevation: number,
    tileSize: number,
    riserColor: string,
  ) {
    const top1 = worldToScreen(worldX1, worldY1, topElevation, tileSize);
    const top2 = worldToScreen(worldX2, worldY2, topElevation, tileSize);
    const bottom1 = worldToScreen(worldX1, worldY1, bottomElevation, tileSize);
    const bottom2 = worldToScreen(worldX2, worldY2, bottomElevation, tileSize);

    ctx.fillStyle = riserColor;
    ctx.beginPath();
    ctx.moveTo(top1.x, top1.y);
    ctx.lineTo(top2.x, top2.y);
    ctx.lineTo(bottom2.x, bottom2.y);
    ctx.lineTo(bottom1.x, bottom1.y);
    ctx.closePath();
    ctx.fill();
  }

  function draw() {
    const range = visibleTileRange();
    coordsLabel.textContent = range.clamped
      ? ` zoom ${Math.round(zoom * 100)}%  (zoomed out too far to edit everywhere — zoom in to reach the edges)`
      : ` zoom ${Math.round(zoom * 100)}%`;

    ctx.clearRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

    const tileSize = state.tileSize;
    const cells: Array<{ col: number; row: number }> = [];
    for (let col = range.minCol; col <= range.maxCol; col++) {
      for (let row = range.minRow; row <= range.maxRow; row++) cells.push({ col, row });
    }
    // Painter's algorithm: farthest tiles first. Depth for this projection
    // is proportional to col+row — required as soon as any tile can have a
    // vertical (elevation) offset, or raised tiles can paint incorrectly
    // over/under neighbors depending on raw iteration order.
    cells.sort((a, b) => a.col + a.row - (b.col + b.row));

    hitTestCache = [];

    for (const { col, row } of cells) {
      const cell = cellAt(col, row);
      const worldLeft = col * tileSize;
      const worldTop = row * tileSize;
      const corners = [
        worldToScreen(worldLeft, worldTop, cell.elevation, tileSize),
        worldToScreen(worldLeft + tileSize, worldTop, cell.elevation, tileSize),
        worldToScreen(worldLeft + tileSize, worldTop + tileSize, cell.elevation, tileSize),
        worldToScreen(worldLeft, worldTop + tileSize, cell.elevation, tileSize),
      ];

      const xs = corners.map((p) => p.x);
      const ys = corners.map((p) => p.y);
      hitTestCache.push({
        col,
        row,
        points: corners,
        minX: Math.min(...xs),
        maxX: Math.max(...xs),
        minY: Math.min(...ys),
        maxY: Math.max(...ys),
      });

      const centerX = (corners[0].x + corners[2].x) / 2;
      const centerY = (corners[0].y + corners[2].y) / 2;
      const padded = corners.map((p) => {
        const dx = p.x - centerX;
        const dy = p.y - centerY;
        const len = Math.hypot(dx, dy) || 1;
        return { x: p.x + (dx / len) * SEAM_PAD, y: p.y + (dy / len) * SEAM_PAD };
      });

      const cellColor = TILE_COLORS[cell.tileType] ?? "#000000";
      const riserColor = cell.tileType === TileType.Wall ? cellColor : numberToCssColor(state.cliffColor);

      ctx.fillStyle = cellColor;
      ctx.beginPath();
      ctx.moveTo(padded[0].x, padded[0].y);
      for (let i = 1; i < padded.length; i++) ctx.lineTo(padded[i].x, padded[i].y);
      ctx.closePath();
      ctx.fill();

      ctx.strokeStyle = "rgba(0,0,0,0.2)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(corners[0].x, corners[0].y);
      for (let i = 1; i < corners.length; i++) ctx.lineTo(corners[i].x, corners[i].y);
      ctx.closePath();
      ctx.stroke();

      // Barrier cells are invisible in actual gameplay (see WorldGrid.
      // blocksMovementAt) — this translucent red tint + hatching is
      // editor-only, so the flag stays paintable/visible while authoring
      // without ever showing up to players.
      if (cell.blocksMovement) {
        ctx.fillStyle = "rgba(220,30,30,0.4)";
        ctx.beginPath();
        ctx.moveTo(padded[0].x, padded[0].y);
        for (let i = 1; i < padded.length; i++) ctx.lineTo(padded[i].x, padded[i].y);
        ctx.closePath();
        ctx.fill();

        ctx.strokeStyle = "rgba(255,255,255,0.8)";
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(corners[0].x, corners[0].y);
        ctx.lineTo(corners[2].x, corners[2].y);
        ctx.moveTo(corners[1].x, corners[1].y);
        ctx.lineTo(corners[3].x, corners[3].y);
        ctx.stroke();
      }

      if (cell.propType) {
        const icon = PROP_ICONS[cell.propType];
        // naturalWidth stays 0 until the image has actually finished
        // loading — drawImage on an unloaded image silently no-ops in some
        // browsers but throws in others, so this is a real guard, not
        // defensive-for-its-own-sake. (The redraw-on-load hookup that makes
        // a still-loading icon appear the moment it's ready, instead of
        // staying invisible until the next unrelated pan/zoom/paint, is
        // registered where PROP_ICONS is built — see its definition.)
        if (icon.naturalWidth > 0) {
          const iconSize = tileSize * zoom * 0.8;
          ctx.drawImage(icon, centerX - iconSize / 2, centerY - iconSize / 2, iconSize, iconSize);
        }
      }

      if (cell.elevation !== 0 && zoom >= 0.35) {
        const fontSize = Math.max(8, Math.round(12 * zoom));
        ctx.font = `${fontSize}px sans-serif`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.lineWidth = 2;
        ctx.strokeStyle = "#000000";
        ctx.strokeText(String(cell.elevation), centerX, centerY);
        ctx.fillStyle = "#ffffff";
        ctx.fillText(String(cell.elevation), centerX, centerY);
      }

      // Cliff faces on the two screen-front-facing edges (east + south —
      // the ones meeting at this diamond's frontmost/bottom corner) — drawn
      // wherever this tile sits higher than that neighbor, regardless of
      // how big the gap is (only *movement* is limited to a 1-level step,
      // painting isn't).
      const eastNeighbor = cellAt(col + 1, row);
      if (cell.elevation > eastNeighbor.elevation) {
        drawCliffFace(
          worldLeft + tileSize,
          worldTop,
          worldLeft + tileSize,
          worldTop + tileSize,
          cell.elevation,
          eastNeighbor.elevation,
          tileSize,
          riserColor,
        );
      }
      const southNeighbor = cellAt(col, row + 1);
      if (cell.elevation > southNeighbor.elevation) {
        drawCliffFace(
          worldLeft,
          worldTop + tileSize,
          worldLeft + tileSize,
          worldTop + tileSize,
          cell.elevation,
          southNeighbor.elevation,
          tileSize,
          riserColor,
        );
      }

      // A thin line along whichever top edges border a differently-elevated
      // neighbor, on all four sides — south/east already get a full cliff
      // wall above, but north/west (this projection's "back" edges, where a
      // full wall would look wrong/inside-out) still need *some* boundary
      // marker, or two same-type tiles at different heights are otherwise
      // indistinguishable there.
      const northNeighbor = cellAt(col, row - 1);
      const westNeighbor = cellAt(col - 1, row);
      const topEdges: Array<[{ x: number; y: number }, { x: number; y: number }, number]> = [
        [corners[0], corners[1], northNeighbor.elevation],
        [corners[1], corners[2], eastNeighbor.elevation],
        [corners[2], corners[3], southNeighbor.elevation],
        [corners[3], corners[0], westNeighbor.elevation],
      ];
      ctx.strokeStyle = "rgba(0,0,0,0.5)";
      ctx.lineWidth = 1.5;
      for (const [from, to, neighborElevation] of topEdges) {
        if (neighborElevation === cell.elevation) continue;
        ctx.beginPath();
        ctx.moveTo(from.x, from.y);
        ctx.lineTo(to.x, to.y);
        ctx.stroke();
      }
    }

    // Spawn markers, drawn on top of terrain — each sits at its tile's
    // actual (elevation-shifted) screen position, matching the game.
    const playerElevation = cellAt(state.playerSpawnCol, state.playerSpawnRow).elevation;
    const playerPos = worldToScreen(
      state.playerSpawnCol * tileSize + tileSize / 2,
      state.playerSpawnRow * tileSize + tileSize / 2,
      playerElevation,
      tileSize,
    );
    ctx.fillStyle = "#00ff88";
    ctx.beginPath();
    ctx.arc(playerPos.x, playerPos.y, Math.max(3, 8 * zoom), 0, Math.PI * 2);
    ctx.fill();

    for (const spawn of state.monsterSpawns) {
      const elevation = cellAt(spawn.col, spawn.row).elevation;
      const pos = worldToScreen(spawn.col * tileSize + tileSize / 2, spawn.row * tileSize + tileSize / 2, elevation, tileSize);
      ctx.fillStyle = colorFor(spawn.monsterTemplateId);
      ctx.beginPath();
      ctx.arc(pos.x, pos.y, Math.max(2, 6 * zoom), 0, Math.PI * 2);
      ctx.fill();
    }

    // Squares (vs. monsters' circles) so the two spawn kinds are
    // distinguishable on the grid without a separate legend.
    for (const spawn of state.npcSpawns) {
      const elevation = cellAt(spawn.col, spawn.row).elevation;
      const pos = worldToScreen(spawn.col * tileSize + tileSize / 2, spawn.row * tileSize + tileSize / 2, elevation, tileSize);
      ctx.fillStyle = colorFor(spawn.npcTemplateId);
      const size = Math.max(4, 10 * zoom);
      ctx.fillRect(pos.x - size / 2, pos.y - size / 2, size, size);
    }

    // Rings (vs. monsters' filled circles and NPCs' squares) so a portal
    // reads as distinct from either at a glance — fixed color, since a
    // portal isn't "of" any template to hash a color from.
    for (const portal of state.portals) {
      const elevation = cellAt(portal.col, portal.row).elevation;
      const pos = worldToScreen(portal.col * tileSize + tileSize / 2, portal.row * tileSize + tileSize / 2, elevation, tileSize);
      ctx.strokeStyle = "#9d4dff";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(pos.x, pos.y, Math.max(4, 9 * zoom), 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  // See PROP_ICONS/requestPropIconRedraw's definitions — a prop icon that
  // was still loading at paint time repaints itself in the moment it
  // finishes, instead of staying invisible until some unrelated pan/zoom.
  requestPropIconRedraw = draw;

  // Resolves a click to the tile actually rendered under the cursor —
  // scans the polygon cache built by the last draw() in REVERSE order
  // (frontmost/topmost-drawn tile first), so a raised tile visually
  // overlapping a neighbor correctly wins over it. AABB pre-check keeps
  // this cheap even with thousands of cached candidates.
  function tileAt(clientX: number, clientY: number): { col: number; row: number } | null {
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    const sx = (clientX - rect.left) * scaleX;
    const sy = (clientY - rect.top) * scaleY;

    for (let i = hitTestCache.length - 1; i >= 0; i--) {
      const entry = hitTestCache[i];
      if (sx < entry.minX || sx > entry.maxX || sy < entry.minY || sy > entry.maxY) continue;
      if (pointInPolygon(sx, sy, entry.points)) return { col: entry.col, row: entry.row };
    }
    return null;
  }

  function applyToolAt(col: number, row: number) {
    if (tool.kind === "tile") {
      const current = cellAt(col, row);
      dirtyTiles.set(tileKey(col, row), {
        tileType: tool.tileType,
        elevation: current.elevation,
        blocksMovement: current.blocksMovement,
        propType: current.propType,
      });
    } else if (tool.kind === "elevation") {
      const current = cellAt(col, row);
      const elevation = Math.max(MIN_ELEVATION, Math.min(MAX_ELEVATION, Math.round(Number(elevationInput.value)) || 0));
      dirtyTiles.set(tileKey(col, row), {
        tileType: current.tileType,
        elevation,
        blocksMovement: current.blocksMovement,
        propType: current.propType,
      });
    } else if (tool.kind === "blocksMovement") {
      const current = cellAt(col, row);
      dirtyTiles.set(tileKey(col, row), {
        tileType: current.tileType,
        elevation: current.elevation,
        blocksMovement: !current.blocksMovement,
        propType: current.propType,
      });
    } else if (tool.kind === "prop") {
      const current = cellAt(col, row);
      dirtyTiles.set(tileKey(col, row), {
        tileType: current.tileType,
        elevation: current.elevation,
        blocksMovement: current.blocksMovement,
        propType: tool.propType,
      });
    } else if (tool.kind === "player-spawn") {
      state.playerSpawnCol = col;
      state.playerSpawnRow = row;
    } else if (tool.kind === "monster-spawn") {
      const existingIndex = state.monsterSpawns.findIndex((s) => s.col === col && s.row === row);
      if (existingIndex >= 0) {
        state.monsterSpawns.splice(existingIndex, 1);
      } else {
        state.monsterSpawns.push({ col, row, monsterTemplateId: tool.monsterTemplateId, isBoss: tool.isBoss });
      }
    } else if (tool.kind === "npc-spawn") {
      const existingIndex = state.npcSpawns.findIndex((s) => s.col === col && s.row === row);
      if (existingIndex >= 0) {
        state.npcSpawns.splice(existingIndex, 1);
      } else {
        state.npcSpawns.push({ col, row, npcTemplateId: tool.npcTemplateId });
      }
    } else if (tool.kind === "portal") {
      const existingIndex = state.portals.findIndex((p) => p.col === col && p.row === row);
      if (existingIndex >= 0) {
        state.portals.splice(existingIndex, 1);
      } else {
        state.portals.push({ col, row, targetMapId: tool.targetMapId });
      }
    }
    draw();
  }

  // dCol/dRow are unit screen-axis directions (-1/0/1), not tile counts —
  // camera lives in projected space, so panning "by N tiles" means moving
  // it by N*tileSize projected units, which keeps the on-screen distance
  // moved scaling correctly with the current zoom level.
  function pan(dCol: number, dRow: number) {
    cameraProjX += dCol * PAN_STEP_TILES * state.tileSize;
    cameraProjY += dRow * PAN_STEP_TILES * state.tileSize;
    draw();
    void loadVisibleRange();
  }

  function zoomBy(factor: number) {
    const next = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom * factor));
    if (next === zoom) return;
    zoom = next;
    draw();
    void loadVisibleRange();
  }

  // Left-click paints/toggles (drag paints continuously for the tile/
  // elevation tools). Right-click drags the viewport — panning has to be a
  // different input than painting since both are held-drag gestures on the
  // same canvas.
  let painting = false;
  let panningFrom: { clientX: number; clientY: number; cameraProjX: number; cameraProjY: number } | null = null;

  canvas.addEventListener("mousedown", (e) => {
    // Middle-button drag pans (left is reserved entirely for placing/
    // painting the selected palette tool) — preventDefault stops the
    // browser's own middle-click autoscroll cursor from taking over.
    if (e.button === 1) {
      e.preventDefault();
      panningFrom = { clientX: e.clientX, clientY: e.clientY, cameraProjX, cameraProjY };
      return;
    }
    if (e.button !== 0) return;
    painting = true;
    const hit = tileAt(e.clientX, e.clientY);
    if (hit) applyToolAt(hit.col, hit.row);
  });
  canvas.addEventListener("mousemove", (e) => {
    if (panningFrom) {
      const rect = canvas.getBoundingClientRect();
      const scale = canvas.width / rect.width;
      cameraProjX = panningFrom.cameraProjX - ((e.clientX - panningFrom.clientX) * scale) / zoom;
      cameraProjY = panningFrom.cameraProjY - ((e.clientY - panningFrom.clientY) * scale) / zoom;
      draw();
      return;
    }
    if (!painting || (tool.kind !== "tile" && tool.kind !== "elevation")) return;
    const hit = tileAt(e.clientX, e.clientY);
    if (hit) applyToolAt(hit.col, hit.row);
  });
  window.addEventListener("mouseup", () => {
    painting = false;
    if (panningFrom) {
      panningFrom = null;
      void loadVisibleRange();
    }
  });
  canvas.addEventListener(
    "wheel",
    (e) => {
      e.preventDefault();
      zoomBy(e.deltaY < 0 ? ZOOM_STEP_FACTOR : 1 / ZOOM_STEP_FACTOR);
    },
    { passive: false },
  );

  const actions = document.createElement("div");
  actions.className = "map-editor-actions";

  const saveBtn = document.createElement("button");
  saveBtn.type = "button";
  saveBtn.textContent = "Save";
  saveBtn.addEventListener("click", async () => {
    const tileSize = state.tileSize;
    const ambientSpawns = ambientRows
      .filter((r) => r.select.value)
      .map((r) => ({ monsterTemplateId: r.select.value, weight: Number(r.weight.value) || 1 }));
    const dungeonObjectives = objectiveRows
      .filter((r) => r.kind.value)
      .map((r, i) => {
        const kind = r.kind.value as DungeonObjectiveKind;
        return {
          order: i,
          description: r.description.value,
          kind,
          monsterTemplateId: kind === "killCount" ? r.monsterSelect.value || null : null,
          requiredCount: kind === "killCount" ? Math.max(1, Math.round(Number(r.requiredCount.value)) || 1) : null,
        };
      });

    const input: GameMapInput = {
      name: state.name,
      tileSize,
      ambientSpawnChance: state.ambientSpawnChance,
      cliffColor: state.cliffColor,
      isDungeon: state.isDungeon,
      minLevel: state.minLevel,
      description: state.description,
      spawnX: state.playerSpawnCol * tileSize + tileSize / 2,
      spawnY: state.playerSpawnRow * tileSize + tileSize / 2,
      spawns: state.monsterSpawns.map((s) => ({
        monsterTemplateId: s.monsterTemplateId,
        x: s.col * tileSize + tileSize / 2,
        y: s.row * tileSize + tileSize / 2,
        isBoss: s.isBoss,
      })),
      npcSpawns: state.npcSpawns.map((s) => ({
        npcTemplateId: s.npcTemplateId,
        x: s.col * tileSize + tileSize / 2,
        y: s.row * tileSize + tileSize / 2,
      })),
      ambientSpawns,
      portals: state.portals.map((p) => ({
        targetMapId: p.targetMapId,
        x: p.col * tileSize + tileSize / 2,
        y: p.row * tileSize + tileSize / 2,
      })),
      dungeonObjectives,
    };
    const tiles: MapTileDTO[] = [...dirtyTiles.entries()].map(([key, cell]) => {
      const [col, row] = key.split(",").map(Number);
      return {
        col,
        row,
        tileType: cell.tileType,
        elevation: cell.elevation,
        blocksMovement: cell.blocksMovement,
        propType: cell.propType,
      };
    });

    try {
      await onSave(input, tiles);
      // Only clear on confirmed success — a failed tile flush after the map
      // itself saved shouldn't silently lose unsaved paints on retry.
      dirtyTiles.clear();
    } catch (err) {
      alert(err instanceof Error ? err.message : String(err));
    }
  });

  const cancelBtn = document.createElement("button");
  cancelBtn.type = "button";
  cancelBtn.textContent = "Cancel";
  cancelBtn.addEventListener("click", onCancel);

  actions.append(saveBtn, cancelBtn);

  main.append(viewToolbar, canvas, actions);
  layout.append(palette, main);
  wrapper.append(layout);
  container.appendChild(wrapper);
  draw();
  void loadVisibleRange();
}
