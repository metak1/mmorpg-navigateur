import { makeDraggable } from "./draggable.js";

export interface DungeonObjectiveView {
  id: string;
  description: string;
  progress: number;
  requiredCount: number;
  completed: boolean;
}

const STORAGE_KEY = "dungeonObjectivesPosition";
const PANEL_WIDTH = 220;
const MARGIN = 16;

// Hugs the right edge of the game view itself (#app, see index.html's
// #game-layout), not the browser window — window.innerWidth would land the
// default inside the 300px sidebar instead, since that's what actually
// occupies the window's right edge. Falls back to the window edge if #app
// isn't there for some reason. Only a default: see the drag handle (the
// header itself), which persists wherever the player actually leaves it.
function computeDefaultPosition(): { x: number; y: number } {
  const appRight = document.getElementById("app")?.getBoundingClientRect().right;
  const x = (appRight ?? window.innerWidth) - PANEL_WIDTH - MARGIN;
  return { x, y: MARGIN };
}

// A DOM overlay (like PartyFrames) showing the current dungeon's checklist
// live — see RoomState.dungeonObjectives. Hidden entirely both outside a
// dungeon and inside one whose map defines no objectives (the old
// "any boss kill clears it" dungeons), so this never appears for content
// that hasn't been given objectives yet.
export class DungeonObjectives {
  private panel: HTMLDivElement;
  private listEl: HTMLDivElement;

  constructor() {
    this.panel = document.createElement("div");
    this.panel.id = "dungeon-objectives";
    this.panel.style.display = "none";

    const header = document.createElement("div");
    header.id = "dungeon-objectives-header";
    header.textContent = "Objectives";
    this.panel.appendChild(header);

    this.listEl = document.createElement("div");
    this.listEl.id = "dungeon-objectives-list";
    this.panel.appendChild(this.listEl);

    document.body.appendChild(this.panel);

    makeDraggable(this.panel, header, STORAGE_KEY, computeDefaultPosition());
  }

  update(objectives: DungeonObjectiveView[]) {
    if (objectives.length === 0) {
      this.panel.style.display = "none";
      return;
    }
    this.panel.style.display = "block";
    this.listEl.innerHTML = "";
    for (const objective of objectives) {
      const row = document.createElement("div");
      row.className = `dungeon-objective-row${objective.completed ? " completed" : ""}`;

      const check = document.createElement("span");
      check.className = "dungeon-objective-check";
      check.textContent = objective.completed ? "✓" : "○";
      row.appendChild(check);

      const text = document.createElement("span");
      text.className = "dungeon-objective-text";
      text.textContent =
        objective.requiredCount > 1
          ? `${objective.description} (${objective.progress}/${objective.requiredCount})`
          : objective.description;
      row.appendChild(text);

      this.listEl.appendChild(row);
    }
  }
}

export const dungeonObjectives = new DungeonObjectives();
