type PanelKey = "chat" | "inventory" | "quests";

const KEY_TO_PANEL: Record<string, PanelKey> = { c: "chat", i: "inventory", l: "quests" };
const DEFAULT_PANEL: PanelKey = "chat";

// Placeholder body copy until each panel grows real content/state of its own.
const PANEL_PLACEHOLDER: Record<PanelKey, string> = {
  chat: "Chat coming soon",
  inventory: "Inventory coming soon",
  quests: "No active quests",
};

export interface QuestLogEntry {
  questId: string;
  title: string;
  objectiveSummary: string;
  ready: boolean;
}

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName.toLowerCase();
  return tag === "input" || tag === "textarea" || target.isContentEditable;
}

// One sidebar surface shared by chat/inventory/quests — only one is visible
// at a time, swapped via its tab hotkey (C/I/L) or a click on its tab.
export class Sidebar {
  private tabs = new Map<PanelKey, HTMLElement>();
  private bodyEl: HTMLElement;
  private currentPanel: PanelKey = DEFAULT_PANEL;
  private quests: QuestLogEntry[] = [];

  constructor() {
    this.bodyEl = document.querySelector<HTMLElement>("#sidebar-body")!;

    document.querySelectorAll<HTMLElement>(".sidebar-tab").forEach((el) => {
      const panel = el.dataset.panel as PanelKey;
      this.tabs.set(panel, el);
      el.addEventListener("click", () => this.show(panel));
    });

    window.addEventListener("keydown", (event) => {
      if (isTypingTarget(event.target)) return;
      const panel = KEY_TO_PANEL[event.key.toLowerCase()];
      if (panel) this.show(panel);
    });

    this.show(DEFAULT_PANEL);
  }

  show(panel: PanelKey) {
    for (const [key, el] of this.tabs) el.classList.toggle("active", key === panel);
    this.currentPanel = panel;
    this.render();
  }

  setQuests(quests: QuestLogEntry[]) {
    this.quests = quests;
    if (this.currentPanel === "quests") this.render();
  }

  private render() {
    this.bodyEl.innerHTML = "";

    if (this.currentPanel !== "quests" || this.quests.length === 0) {
      this.bodyEl.textContent = PANEL_PLACEHOLDER[this.currentPanel];
      return;
    }

    const list = document.createElement("div");
    list.id = "quest-log-list";
    for (const quest of this.quests) {
      const item = document.createElement("div");
      item.className = "quest-log-item";

      const title = document.createElement("div");
      title.className = "quest-log-title";
      title.textContent = quest.ready ? `${quest.title} ✓` : quest.title;

      const summary = document.createElement("div");
      summary.className = "quest-log-summary";
      summary.textContent = quest.objectiveSummary;

      item.append(title, summary);
      list.appendChild(item);
    }
    this.bodyEl.appendChild(list);
  }
}

export const sidebar = new Sidebar();
