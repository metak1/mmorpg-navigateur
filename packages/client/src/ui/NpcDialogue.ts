import type { NpcDialogueMessage } from "shared";

export interface NpcDialogueHandlers {
  onAccept: (questId: string) => void;
  onTurnIn: (questId: string) => void;
}

// A DOM overlay (like Sidebar/login) rather than a Phaser panel — text
// wrapping and buttons are much simpler to get right in HTML than by hand in
// a canvas, and this only needs to appear over the game, not inside it.
export class NpcDialogue {
  private overlay: HTMLDivElement;
  private handlers?: NpcDialogueHandlers;

  constructor() {
    this.overlay = document.createElement("div");
    this.overlay.id = "npc-dialogue-overlay";
    this.overlay.style.display = "none";
    document.body.appendChild(this.overlay);
  }

  show(message: NpcDialogueMessage, handlers: NpcDialogueHandlers) {
    this.handlers = handlers;
    this.render(message);
    this.overlay.style.display = "flex";
  }

  hide() {
    this.overlay.style.display = "none";
    this.overlay.innerHTML = "";
  }

  private render(message: NpcDialogueMessage) {
    this.overlay.innerHTML = "";

    const panel = document.createElement("div");
    panel.id = "npc-dialogue-panel";

    const title = document.createElement("h3");
    title.textContent = message.npcName;
    panel.appendChild(title);

    if (message.options.length === 0) {
      const empty = document.createElement("p");
      empty.className = "npc-dialogue-empty";
      empty.textContent = "Nothing to say right now.";
      panel.appendChild(empty);
    }

    for (const option of message.options) {
      const card = document.createElement("div");
      card.className = "npc-dialogue-option";

      const optionTitle = document.createElement("div");
      optionTitle.className = "npc-dialogue-option-title";
      optionTitle.textContent = option.title;

      const description = document.createElement("div");
      description.className = "npc-dialogue-option-desc";
      description.textContent = option.description;

      const summary = document.createElement("div");
      summary.className = "npc-dialogue-option-summary";
      summary.textContent = option.objectiveSummary;

      card.append(optionTitle, description, summary);

      if (option.kind === "offer") {
        const button = document.createElement("button");
        button.textContent = "Accept";
        button.addEventListener("click", () => this.handlers?.onAccept(option.questId));
        card.appendChild(button);
      } else if (option.kind === "turnIn") {
        const button = document.createElement("button");
        button.textContent = "Turn In";
        button.addEventListener("click", () => this.handlers?.onTurnIn(option.questId));
        card.appendChild(button);
      } else {
        const hint = document.createElement("div");
        hint.className = "npc-dialogue-hint";
        hint.textContent = "Come back when you're done.";
        card.appendChild(hint);
      }

      panel.appendChild(card);
    }

    const closeButton = document.createElement("button");
    closeButton.id = "npc-dialogue-close";
    closeButton.textContent = "Close";
    closeButton.addEventListener("click", () => this.hide());
    panel.appendChild(closeButton);

    this.overlay.appendChild(panel);
  }
}

export const npcDialogue = new NpcDialogue();
