import { TileType } from "shared";
import type { GameMapDTO, GameMapInput, MonsterTemplateDTO, NpcTemplateDTO } from "shared";

const CELL_PX = 20;

const TILE_COLORS: Record<number, string> = {
  [TileType.Grass]: "#4c9942",
  [TileType.Path]: "#c19a6b",
  [TileType.Water]: "#4084d6",
  [TileType.Wall]: "#606068",
};

export type EditableMap = Omit<GameMapDTO, "id" | "isActive"> & { id?: string };

type Tool =
  | { kind: "tile"; tileType: number }
  | { kind: "player-spawn" }
  | { kind: "monster-spawn"; monsterTemplateId: string }
  | { kind: "npc-spawn"; npcTemplateId: string };

export function renderMapEditor(
  container: HTMLElement,
  initialMap: EditableMap,
  monsters: MonsterTemplateDTO[],
  npcs: NpcTemplateDTO[],
  onSave: (input: GameMapInput) => Promise<void>,
  onCancel: () => void,
): void {
  const state = {
    name: initialMap.name,
    width: initialMap.width,
    height: initialMap.height,
    tileSize: initialMap.tileSize,
    tileData: initialMap.tileData.map((row) => [...row]),
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
  };

  let tool: Tool = { kind: "tile", tileType: TileType.Grass };

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

  const canvas = document.createElement("canvas");
  canvas.width = state.width * CELL_PX;
  canvas.height = state.height * CELL_PX;
  canvas.className = "map-editor-canvas";
  const ctx = canvas.getContext("2d")!;

  function colorFor(id: string): string {
    // stable-ish color per template id so different types are visually
    // distinguishable on the grid without needing a full legend
    let hash = 0;
    for (const char of id) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
    const hue = hash % 360;
    return `hsl(${hue}, 80%, 55%)`;
  }

  function draw() {
    for (let row = 0; row < state.height; row++) {
      for (let col = 0; col < state.width; col++) {
        ctx.fillStyle = TILE_COLORS[state.tileData[row][col]] ?? "#000000";
        ctx.fillRect(col * CELL_PX, row * CELL_PX, CELL_PX, CELL_PX);
        ctx.strokeStyle = "rgba(0,0,0,0.15)";
        ctx.strokeRect(col * CELL_PX, row * CELL_PX, CELL_PX, CELL_PX);
      }
    }

    ctx.fillStyle = "#00ff88";
    ctx.beginPath();
    ctx.arc(
      state.playerSpawnCol * CELL_PX + CELL_PX / 2,
      state.playerSpawnRow * CELL_PX + CELL_PX / 2,
      CELL_PX / 3,
      0,
      Math.PI * 2,
    );
    ctx.fill();

    for (const spawn of state.monsterSpawns) {
      ctx.fillStyle = colorFor(spawn.monsterTemplateId);
      ctx.beginPath();
      ctx.arc(spawn.col * CELL_PX + CELL_PX / 2, spawn.row * CELL_PX + CELL_PX / 2, CELL_PX / 4, 0, Math.PI * 2);
      ctx.fill();
    }

    // Squares (vs. monsters' circles) so the two spawn kinds are
    // distinguishable on the grid without a separate legend.
    for (const spawn of state.npcSpawns) {
      ctx.fillStyle = colorFor(spawn.npcTemplateId);
      const size = CELL_PX / 2;
      ctx.fillRect(spawn.col * CELL_PX + (CELL_PX - size) / 2, spawn.row * CELL_PX + (CELL_PX - size) / 2, size, size);
    }
  }

  function cellFromEvent(event: MouseEvent): { col: number; row: number } {
    const rect = canvas.getBoundingClientRect();
    return {
      col: Math.floor((event.clientX - rect.left) / CELL_PX),
      row: Math.floor((event.clientY - rect.top) / CELL_PX),
    };
  }

  function applyToolAt(col: number, row: number) {
    if (col < 0 || col >= state.width || row < 0 || row >= state.height) return;

    if (tool.kind === "tile") {
      state.tileData[row][col] = tool.tileType;
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

  let painting = false;
  canvas.addEventListener("mousedown", (e) => {
    painting = true;
    const { col, row } = cellFromEvent(e);
    applyToolAt(col, row);
  });
  canvas.addEventListener("mousemove", (e) => {
    if (!painting || tool.kind !== "tile") return;
    const { col, row } = cellFromEvent(e);
    applyToolAt(col, row);
  });
  window.addEventListener("mouseup", () => {
    painting = false;
  });

  const actions = document.createElement("div");
  actions.className = "map-editor-actions";

  const saveBtn = document.createElement("button");
  saveBtn.type = "button";
  saveBtn.textContent = "Save";
  saveBtn.addEventListener("click", async () => {
    const input: GameMapInput = {
      name: state.name,
      width: state.width,
      height: state.height,
      tileSize: state.tileSize,
      tileData: state.tileData,
      spawnX: state.playerSpawnCol * state.tileSize + state.tileSize / 2,
      spawnY: state.playerSpawnRow * state.tileSize + state.tileSize / 2,
      spawns: state.monsterSpawns.map((s) => ({
        monsterTemplateId: s.monsterTemplateId,
        x: s.col * state.tileSize + state.tileSize / 2,
        y: s.row * state.tileSize + state.tileSize / 2,
      })),
      npcSpawns: state.npcSpawns.map((s) => ({
        npcTemplateId: s.npcTemplateId,
        x: s.col * state.tileSize + state.tileSize / 2,
        y: s.row * state.tileSize + state.tileSize / 2,
      })),
    };
    await onSave(input);
  });

  const cancelBtn = document.createElement("button");
  cancelBtn.type = "button";
  cancelBtn.textContent = "Cancel";
  cancelBtn.addEventListener("click", onCancel);

  actions.append(saveBtn, cancelBtn);

  wrapper.append(nameRow, toolbar, canvas, actions);
  container.appendChild(wrapper);
  draw();
}
