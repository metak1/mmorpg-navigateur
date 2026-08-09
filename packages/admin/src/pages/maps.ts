import type { GameMapDTO, GameMapInput, MapTileDTO } from "shared";
import { api } from "../api.js";
import { renderTable } from "../ui.js";
import { renderMapEditor, type EditableMap } from "../mapEditor.js";

export async function renderMapsPage(container: HTMLElement) {
  await showList();

  async function showList() {
    container.innerHTML = "";

    const heading = document.createElement("h2");
    heading.textContent = "Maps";
    container.appendChild(heading);

    const newMapForm = document.createElement("div");
    newMapForm.className = "new-map-form";

    const nameInput = document.createElement("input");
    nameInput.value = "New Map";

    const createBtn = document.createElement("button");
    createBtn.textContent = "New Map";
    createBtn.addEventListener("click", () => {
      const tileSize = 32;

      // A brand-new map is an empty, unbounded canvas — everywhere defaults
      // to Grass until painted, so there's nothing to size up front. Spawn
      // starts at the world origin; the editor opens centered on it.
      void showEditor({
        name: nameInput.value || "New Map",
        tileSize,
        spawnX: tileSize / 2,
        spawnY: tileSize / 2,
        ambientSpawnChance: 0.3,
        cliffColor: 0x6b4a2f, // dirt brown
        isDungeon: false,
        minLevel: 1,
        description: "",
        spawns: [],
        npcSpawns: [],
        ambientSpawns: [],
        portals: [],
        dungeonObjectives: [],
      });
    });

    newMapForm.append(labeled("Name", nameInput), createBtn);
    container.appendChild(newMapForm);

    const tableSection = document.createElement("div");
    container.appendChild(tableSection);

    const maps = await api.listMaps();
    renderTable<GameMapDTO>(
      tableSection,
      [
        { key: "name", label: "Name" },
        { key: "ambientSpawnChance", label: "Ambient Spawn Chance" },
        { key: "isActive", label: "Active", format: (v) => (v ? "Yes" : "No") },
      ],
      maps,
      [
        {
          label: "Edit",
          onClick: async (row) => {
            const full = await api.getMap(row.id);
            await showEditor(full);
          },
        },
        {
          label: "Activate",
          onClick: async (row) => {
            await api.activateMap(row.id);
            await showList();
          },
        },
        {
          label: "Delete",
          className: "danger",
          onClick: async (row) => {
            if (confirm(`Delete map "${row.name}"?`)) {
              await api.deleteMap(row.id);
              await showList();
            }
          },
        },
      ],
    );
  }

  async function showEditor(map: EditableMap) {
    container.innerHTML = "";

    const heading = document.createElement("h2");
    heading.textContent = map.id ? `Edit Map: ${map.name}` : "New Map";
    container.appendChild(heading);

    const [monsters, npcs, maps] = await Promise.all([api.listMonsters(), api.listNpcs(), api.listMaps()]);

    renderMapEditor(
      container,
      map,
      monsters,
      npcs,
      // A portal can't meaningfully target the map currently being edited —
      // exclude it so the dropdown only offers real destinations.
      maps.filter((m) => m.id !== map.id),
      (minCol, minRow, maxCol, maxRow) => {
        if (!map.id) return Promise.resolve([]);
        return api.getMapTiles(map.id, minCol, minRow, maxCol, maxRow);
      },
      async (input: GameMapInput, tiles: MapTileDTO[]) => {
        // Two-step: the map needs an id before tiles can be saved against
        // it, so a brand-new map is created first (base fields only), then
        // any painted tiles are flushed in a second request.
        const saved = map.id ? await api.updateMap(map.id, input) : await api.createMap(input);
        if (tiles.length > 0) {
          await api.putMapTiles(saved.id, tiles);
        }
        await showList();
      },
      () => void showList(),
    );
  }
}

function labeled(text: string, input: HTMLElement): HTMLElement {
  const label = document.createElement("label");
  label.textContent = text;
  label.appendChild(input);
  return label;
}
