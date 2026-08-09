import type { DungeonPromptMessage } from "shared";

export interface DungeonPromptHandlers {
  onEnter: (portalId: string) => void;
  onCancel: () => void;
}

// A DOM overlay (like NpcDialogue/Sidebar), shown in place of instantly
// entering a dungeon — gives the player a chance to read what they're
// walking into. Party assembly isn't handled in here directly: show()
// returns a docking element that the caller (WorldScene) hands to
// GroupFinder, which renders the actual roster/invite/create-group UI into
// it — keeping "here's the dungeon" and "here's your group" as two
// independently reusable pieces that just happen to appear together.
export class DungeonPrompt {
  private overlay: HTMLDivElement;
  private handlers?: DungeonPromptHandlers;
  private message?: DungeonPromptMessage;

  constructor() {
    this.overlay = document.createElement("div");
    this.overlay.id = "dungeon-prompt-overlay";
    this.overlay.style.display = "none";
    document.body.appendChild(this.overlay);
  }

  // Returns the empty dock element the group panel should be rendered into
  // (see GroupFinder.show) — created fresh each call, since a stale
  // reference from a previous show() would already have been removed from
  // the DOM by this same render.
  show(message: DungeonPromptMessage, handlers: DungeonPromptHandlers): HTMLElement {
    this.message = message;
    this.handlers = handlers;
    return this.render();
  }

  hide() {
    this.message = undefined;
    this.overlay.style.display = "none";
    this.overlay.innerHTML = "";
  }

  private render(): HTMLElement {
    const message = this.message;
    if (!message) throw new Error("DungeonPrompt.render called with no message");
    this.overlay.innerHTML = "";

    const row = document.createElement("div");
    row.className = "dungeon-prompt-row";

    const panel = document.createElement("div");
    panel.id = "dungeon-prompt-panel";

    const title = document.createElement("h3");
    title.textContent = message.name;
    panel.appendChild(title);

    const minLevel = document.createElement("div");
    minLevel.className = "dungeon-prompt-min-level";
    minLevel.textContent = `Requires level ${message.minLevel}+`;
    panel.appendChild(minLevel);

    if (message.description) {
      const description = document.createElement("p");
      description.className = "dungeon-prompt-description";
      description.textContent = message.description;
      panel.appendChild(description);
    }

    const actions = document.createElement("div");
    actions.className = "dungeon-prompt-actions";

    const enterButton = document.createElement("button");
    enterButton.className = "dungeon-prompt-enter-btn";
    enterButton.textContent = "Enter Dungeon";
    enterButton.addEventListener("click", () => this.handlers?.onEnter(message.portalId));
    actions.appendChild(enterButton);

    const cancelButton = document.createElement("button");
    cancelButton.className = "dungeon-prompt-cancel-btn";
    cancelButton.textContent = "Cancel";
    cancelButton.addEventListener("click", () => {
      this.handlers?.onCancel();
      this.hide();
    });
    actions.appendChild(cancelButton);

    panel.appendChild(actions);
    row.appendChild(panel);

    const groupDock = document.createElement("div");
    groupDock.className = "group-finder-dock";
    row.appendChild(groupDock);

    this.overlay.appendChild(row);
    this.overlay.style.display = "flex";
    return groupDock;
  }
}

export const dungeonPrompt = new DungeonPrompt();
