import { makeDraggable } from "./draggable.js";

export interface PartyFrameMember {
  sessionId: string;
  name: string;
  hp: number;
  maxHp: number;
  isLeader: boolean;
  isSelf: boolean;
}

const STORAGE_KEY = "partyFramesPosition";
// Left side of the screen, clear of the top-left corner — a reasonable
// default "on the world map" position, not meant to be the only one: see
// the drag handle, which persists wherever the player actually leaves it.
const DEFAULT_POSITION = { x: 16, y: 96 };

// A DOM overlay (like NpcDialogue/DungeonPrompt) rather than Phaser-rendered
// UI (like Hud's own HP bar) — free-form dragging anywhere on screen and
// persisting that position is plain DOM/CSS, no need to fight Phaser's
// scroll-factor-0 camera-space positioning for something that isn't tied to
// world coordinates at all.
export class PartyFrames {
  private panel: HTMLDivElement;
  private rowsEl: HTMLDivElement;

  constructor() {
    this.panel = document.createElement("div");
    this.panel.id = "party-frames";
    this.panel.style.display = "none";

    const handle = document.createElement("div");
    handle.id = "party-frames-handle";
    handle.textContent = "Group";
    this.panel.appendChild(handle);

    this.rowsEl = document.createElement("div");
    this.rowsEl.id = "party-frames-rows";
    this.panel.appendChild(this.rowsEl);

    document.body.appendChild(this.panel);

    makeDraggable(this.panel, handle, STORAGE_KEY, DEFAULT_POSITION);
  }

  // Empty members hides the panel entirely (not in a group) — called both
  // on a live roster/HP change and once at scene startup to clear out
  // whatever the previous room's group last showed (see WorldScene.
  // buildWorld — switching rooms tears down and rebuilds the Phaser game
  // but this DOM singleton survives that, so stale content would otherwise
  // briefly show a party from a room you already left).
  update(members: PartyFrameMember[]) {
    if (members.length === 0) {
      this.panel.style.display = "none";
      return;
    }
    this.panel.style.display = "block";
    this.rowsEl.innerHTML = "";
    for (const member of members) {
      const row = document.createElement("div");
      row.className = `party-frame-row${member.isSelf ? " self" : ""}`;

      const name = document.createElement("div");
      name.className = "party-frame-name";
      name.textContent = `${member.isLeader ? "★ " : ""}${member.name}`;
      row.appendChild(name);

      const barBg = document.createElement("div");
      barBg.className = "party-frame-bar-bg";
      const barFill = document.createElement("div");
      barFill.className = "party-frame-bar-fill";
      const frac = member.maxHp > 0 ? Math.max(0, Math.min(1, member.hp / member.maxHp)) : 0;
      barFill.style.width = `${frac * 100}%`;
      const barText = document.createElement("div");
      barText.className = "party-frame-bar-text";
      barText.textContent = `${Math.max(0, Math.round(member.hp))}/${Math.round(member.maxHp)}`;
      barBg.append(barFill, barText);
      row.appendChild(barBg);

      this.rowsEl.appendChild(row);
    }
  }
}

export const partyFrames = new PartyFrames();
