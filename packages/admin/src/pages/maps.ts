import { TileType } from "shared";
import type { GameMapDTO, GameMapInput } from "shared";
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
    const widthInput = document.createElement("input");
    widthInput.type = "number";
    widthInput.value = "25";
    const heightInput = document.createElement("input");
    heightInput.type = "number";
    heightInput.value = "18";

    const createBtn = document.createElement("button");
    createBtn.textContent = "New Map";
    createBtn.addEventListener("click", () => {
      const width = Number(widthInput.value);
      const height = Number(heightInput.value);
      const tileSize = 32;
      const tileData = Array.from({ length: height }, () => Array.from({ length: width }, () => TileType.Grass as number));

      void showEditor({
        name: nameInput.value || "New Map",
        width,
        height,
        tileSize,
        tileData,
        spawnX: Math.floor(width / 2) * tileSize + tileSize / 2,
        spawnY: Math.floor(height / 2) * tileSize + tileSize / 2,
        spawns: [],
      });
    });

    newMapForm.append(
      labeled("Name", nameInput),
      labeled("Width (tiles)", widthInput),
      labeled("Height (tiles)", heightInput),
      createBtn,
    );
    container.appendChild(newMapForm);

    const tableSection = document.createElement("div");
    container.appendChild(tableSection);

    const maps = await api.listMaps();
    renderTable<GameMapDTO>(
      tableSection,
      [
        { key: "name", label: "Name" },
        { key: "width", label: "Width" },
        { key: "height", label: "Height" },
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

    const monsters = await api.listMonsters();

    renderMapEditor(
      container,
      map,
      monsters,
      async (input: GameMapInput) => {
        try {
          if (map.id) {
            await api.updateMap(map.id, input);
          } else {
            await api.createMap(input);
          }
          await showList();
        } catch (err) {
          alert(err instanceof Error ? err.message : String(err));
        }
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
