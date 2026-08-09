import { TileType, isoProject, isoUnproject, isoElevationOffset, TILE_COLORS as TILE_COLORS_HEX } from "shared";
import type { GameMapDTO, GameMapInput, MapTileDTO, MonsterTemplateDTO, NpcTemplateDTO } from "shared";

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
// 125*125=15,625 cells — under the server's 128*128=16,384 range cap
// (packages/server/src/api/maps.ts) with margin, computed to actually
// cover the naive bounding box at MIN_ZOOM (which reaches ~150x150).
const MAX_VISIBLE_TILES_PER_AXIS = 125;
// Nudges each tile's fill corners outward by a hair so adjacent diamonds
// overlap slightly instead of leaving sub-pixel seams — same technique the
// game client uses (WorldScene.createChunkLayer).
const SEAM_PAD = 1;

// ctx.fillStyle wants "#rrggbb"; the shared palette is Phaser-style numeric
// 0xrrggbb (packages/shared/src/tileColors.ts) — same source either way, so
// the editor's preview and the actual game always agree on tile color.
const TILE_COLORS: Record<number, string> = Object.fromEntries(
  Object.entries(TILE_COLORS_HEX).map(([key, hex]) => [key, `#${hex.toString(16).padStart(6, "0")}`]),
);

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
  | { kind: "player-spawn" }
  | { kind: "monster-spawn"; monsterTemplateId: string }
  | { kind: "npc-spawn"; npcTemplateId: string };

interface CellState {
  tileType: number;
  elevation: number;
}

const DEFAULT_CELL: CellState = { tileType: TileType.Grass, elevation: 0 };
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
    playerSpawnCol: Math.floor(initialMap.spawnX / initialMap.tileSize),
    playerSpawnRow: Math.floor(initialMap.spawnY / initialMap.tileSize),
    monsterSpawns: initialMap.spawns.map((s) => ({
      col: Math.floor(s.x / initialMap.tileSize),
      row: Math.floor(s.y / initialMap.tileSize),
      monsterTemplateId: s.monsterTemplateId,
    })),
    npcSpawns: initialMap.npcSpawns.map((s) => ({
      col: Math.floor(s.x / initialMap.tileSize),
      row: Math.floor(s.y / initialMap.tileSize),
      npcTemplateId: s.npcTemplateId,
    })),
    ambientSpawns: initialMap.ambientSpawns.map((a) => ({ monsterTemplateId: a.monsterTemplateId, weight: a.weight })),
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

  const nameRow = document.createElement("div");
  nameRow.className = "map-editor-toolbar";
  const nameLabel = document.createElement("label");
  nameLabel.textContent = "Map name ";
  const nameInput = document.createElement("input");
  nameInput.value = state.name;
  nameInput.addEventListener("input", () => {
    state.name = nameInput.value;
  });
  nameLabel.appendChild(nameInput);
  nameRow.appendChild(nameLabel);

  const toolbar = document.createElement("div");
  toolbar.className = "map-editor-toolbar";

  const toolButtons: HTMLButtonElement[] = [];

  function selectTool(newTool: Tool, btn: HTMLButtonElement) {
    tool = newTool;
    toolButtons.forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
  }

  const tileButtons: Array<{ label: string; tileType: number }> = [
    { label: "Grass", tileType: TileType.Grass },
    { label: "Path", tileType: TileType.Path },
    { label: "Water", tileType: TileType.Water },
    { label: "Wall", tileType: TileType.Wall },
  ];

  for (const { label, tileType } of tileButtons) {
    const btn = document.createElement("button");
    btn.textContent = label;
    btn.style.background = TILE_COLORS[tileType];
    btn.style.color = "#111";
    btn.addEventListener("click", () => selectTool({ kind: "tile", tileType }, btn));
    toolButtons.push(btn);
    toolbar.appendChild(btn);
  }

  // Elevation is a separate paintable attribute from tile type, applied to
  // whatever's already at a cell rather than replacing it — see
  // applyToolAt. The number input's live value is read at paint time (not
  // captured into the Tool), so changing it doesn't require reselecting.
  const elevationInput = document.createElement("input");
  elevationInput.type = "number";
  elevationInput.min = String(MIN_ELEVATION);
  elevationInput.max = String(MAX_ELEVATION);
  elevationInput.step = "1";
  elevationInput.value = "1";
  elevationInput.title = `Elevation level (${MIN_ELEVATION}..${MAX_ELEVATION})`;

  const elevationBtn = document.createElement("button");
  elevationBtn.textContent = "Elevation";
  elevationBtn.addEventListener("click", () => selectTool({ kind: "elevation" }, elevationBtn));
  toolButtons.push(elevationBtn);
  toolbar.append(elevationBtn, elevationInput);

  // Solid fill color for the "riser" face drawn between two tiles of
  // different elevation (see draw()'s drawCliffFace) — e.g. brown for a
  // dirt cliff, gray for stone if building a castle. Saved per-map so the
  // actual game renders the same color, not just the editor preview.
  const cliffColorLabel = document.createElement("label");
  cliffColorLabel.textContent = " Cliff color ";
  const cliffColorInput = document.createElement("input");
  cliffColorInput.type = "color";
  cliffColorInput.value = numberToCssColor(state.cliffColor);
  cliffColorInput.addEventListener("input", () => {
    state.cliffColor = cssColorToNumber(cliffColorInput.value);
    draw();
  });
  cliffColorLabel.appendChild(cliffColorInput);
  toolbar.appendChild(cliffColorLabel);
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
    toolbar.appendChild(presetBtn);
  }

  const spawnBtn = document.createElement("button");
  spawnBtn.textContent = "Player Spawn";
  spawnBtn.addEventListener("click", () => selectTool({ kind: "player-spawn" }, spawnBtn));
  toolButtons.push(spawnBtn);
  toolbar.appendChild(spawnBtn);

  const monsterSelect = document.createElement("select");
  for (const m of monsters) {
    const opt = document.createElement("option");
    opt.value = m.id;
    opt.textContent = m.name;
    monsterSelect.appendChild(opt);
  }
  toolbar.appendChild(monsterSelect);

  const monsterSpawnBtn = document.createElement("button");
  monsterSpawnBtn.textContent = "Monster Spawn (click to toggle)";
  monsterSpawnBtn.addEventListener("click", () =>
    selectTool({ kind: "monster-spawn", monsterTemplateId: monsterSelect.value }, monsterSpawnBtn),
  );
  toolButtons.push(monsterSpawnBtn);
  toolbar.appendChild(monsterSpawnBtn);

  const npcSelect = document.createElement("select");
  for (const n of npcs) {
    const opt = document.createElement("option");
    opt.value = n.id;
    opt.textContent = n.name;
    npcSelect.appendChild(opt);
  }
  toolbar.appendChild(npcSelect);

  const npcSpawnBtn = document.createElement("button");
  npcSpawnBtn.textContent = "NPC Spawn (click to toggle)";
  npcSpawnBtn.addEventListener("click", () => selectTool({ kind: "npc-spawn", npcTemplateId: npcSelect.value }, npcSpawnBtn));
  toolButtons.push(npcSpawnBtn);
  toolbar.appendChild(npcSpawnBtn);

  toolButtons[0]?.classList.add("active");

  // Pan/zoom controls — the canvas shows a fixed-size window into an
  // unbounded world; these move the camera instead of resizing a bounded
  // grid, which no longer exists.
  const viewToolbar = document.createElement("div");
  viewToolbar.className = "map-editor-toolbar";

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

  // Ambient (procedural) spawn config — which monsters can appear as
  // players wander into unpainted territory, and how often.
  const ambientSection = document.createElement("div");
  ambientSection.className = "map-editor-toolbar";
  const ambientChanceLabel = document.createElement("label");
  ambientChanceLabel.textContent = "Ambient spawn chance per chunk (0-1) ";
  const ambientChanceInput = document.createElement("input");
  ambientChanceInput.type = "number";
  ambientChanceInput.min = "0";
  ambientChanceInput.max = "1";
  ambientChanceInput.step = "0.05";
  ambientChanceInput.value = String(state.ambientSpawnChance);
  ambientChanceInput.addEventListener("input", () => {
    state.ambientSpawnChance = Number(ambientChanceInput.value) || 0;
  });
  ambientChanceLabel.appendChild(ambientChanceInput);
  ambientSection.appendChild(ambientChanceLabel);

  const monsterOptionsWithNone = [{ value: "", label: "-- none --" }, ...monsters.map((m) => ({ value: m.id, label: m.name }))];
  const ambientRows: Array<{ select: HTMLSelectElement; weight: HTMLInputElement }> = [];
  for (let i = 0; i < AMBIENT_SLOT_COUNT; i++) {
    const rule = state.ambientSpawns[i];
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
    ambientSection.append(select, weight);
    ambientRows.push({ select, weight });
  }

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
      for (const t of tiles) loadedTiles.set(tileKey(t.col, t.row), { tileType: t.tileType, elevation: t.elevation });
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
  // tile, bottomElevation to the lower neighbor.
  function drawCliffFace(
    worldX1: number,
    worldY1: number,
    worldX2: number,
    worldY2: number,
    topElevation: number,
    bottomElevation: number,
    tileSize: number,
  ) {
    const top1 = worldToScreen(worldX1, worldY1, topElevation, tileSize);
    const top2 = worldToScreen(worldX2, worldY2, topElevation, tileSize);
    const bottom1 = worldToScreen(worldX1, worldY1, bottomElevation, tileSize);
    const bottom2 = worldToScreen(worldX2, worldY2, bottomElevation, tileSize);

    ctx.fillStyle = numberToCssColor(state.cliffColor);
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

      ctx.fillStyle = TILE_COLORS[cell.tileType] ?? "#000000";
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
  }

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
      dirtyTiles.set(tileKey(col, row), { tileType: tool.tileType, elevation: current.elevation });
    } else if (tool.kind === "elevation") {
      const current = cellAt(col, row);
      const elevation = Math.max(MIN_ELEVATION, Math.min(MAX_ELEVATION, Math.round(Number(elevationInput.value)) || 0));
      dirtyTiles.set(tileKey(col, row), { tileType: current.tileType, elevation });
    } else if (tool.kind === "player-spawn") {
      state.playerSpawnCol = col;
      state.playerSpawnRow = row;
    } else if (tool.kind === "monster-spawn") {
      const existingIndex = state.monsterSpawns.findIndex((s) => s.col === col && s.row === row);
      if (existingIndex >= 0) {
        state.monsterSpawns.splice(existingIndex, 1);
      } else {
        state.monsterSpawns.push({ col, row, monsterTemplateId: tool.monsterTemplateId });
      }
    } else if (tool.kind === "npc-spawn") {
      const existingIndex = state.npcSpawns.findIndex((s) => s.col === col && s.row === row);
      if (existingIndex >= 0) {
        state.npcSpawns.splice(existingIndex, 1);
      } else {
        state.npcSpawns.push({ col, row, npcTemplateId: tool.npcTemplateId });
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
    if (e.button === 2) {
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

    const input: GameMapInput = {
      name: state.name,
      tileSize,
      ambientSpawnChance: state.ambientSpawnChance,
      cliffColor: state.cliffColor,
      spawnX: state.playerSpawnCol * tileSize + tileSize / 2,
      spawnY: state.playerSpawnRow * tileSize + tileSize / 2,
      spawns: state.monsterSpawns.map((s) => ({
        monsterTemplateId: s.monsterTemplateId,
        x: s.col * tileSize + tileSize / 2,
        y: s.row * tileSize + tileSize / 2,
      })),
      npcSpawns: state.npcSpawns.map((s) => ({
        npcTemplateId: s.npcTemplateId,
        x: s.col * tileSize + tileSize / 2,
        y: s.row * tileSize + tileSize / 2,
      })),
      ambientSpawns,
    };
    const tiles: MapTileDTO[] = [...dirtyTiles.entries()].map(([key, cell]) => {
      const [col, row] = key.split(",").map(Number);
      return { col, row, tileType: cell.tileType, elevation: cell.elevation };
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

  wrapper.append(nameRow, toolbar, viewToolbar, ambientSection, canvas, actions);
  container.appendChild(wrapper);
  draw();
  void loadVisibleRange();
}
