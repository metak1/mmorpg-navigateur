type PanelKey = "chat" | "inventory" | "quests" | "stats";

const KEY_TO_PANEL: Record<string, PanelKey> = { c: "chat", i: "inventory", l: "quests", k: "stats" };
const DEFAULT_PANEL: PanelKey = "chat";

// Placeholder body copy until each panel grows real content/state of its own.
const PANEL_PLACEHOLDER: Record<PanelKey, string> = {
  chat: "Chat coming soon",
  inventory: "Inventory coming soon",
  quests: "No active quests",
  stats: "Not in a game yet",
};

export interface QuestLogEntry {
  questId: string;
  title: string;
  objectiveSummary: string;
  ready: boolean;
}

export interface CharacterStatsView {
  className: string;
  level: number;
  experience: number;
  xpToNextLevel: number;
  hp: number;
  maxHp: number;
  armor: number;
  strength: number;
  intelligence: number;
  dexterity: number;
  criticalChance: number;
}

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName.toLowerCase();
  return tag === "input" || tag === "textarea" || target.isContentEditable;
}

function statRow(container: HTMLElement, label: string, value: string) {
  const row = document.createElement("div");
  row.className = "stats-row";
  const labelEl = document.createElement("span");
  labelEl.className = "stats-label";
  labelEl.textContent = label;
  const valueEl = document.createElement("span");
  valueEl.className = "stats-value";
  valueEl.textContent = value;
  row.append(labelEl, valueEl);
  container.appendChild(row);
}

// One sidebar surface shared by chat/inventory/quests/stats — only one is
// visible at a time, swapped via its tab hotkey (C/I/L/K) or a click on its tab.
export class Sidebar {
  private tabs = new Map<PanelKey, HTMLElement>();
  private bodyEl: HTMLElement;
  private currentPanel: PanelKey = DEFAULT_PANEL;
  private quests: QuestLogEntry[] = [];
  private stats: CharacterStatsView | null = null;

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

  setStats(stats: CharacterStatsView) {
    this.stats = stats;
    if (this.currentPanel === "stats") this.render();
  }

  private render() {
    this.bodyEl.innerHTML = "";

    if (this.currentPanel === "quests" && this.quests.length > 0) {
      this.renderQuests();
      return;
    }
    if (this.currentPanel === "stats" && this.stats) {
      this.renderStats(this.stats);
      return;
    }

    this.bodyEl.textContent = PANEL_PLACEHOLDER[this.currentPanel];
  }

  private renderQuests() {
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

  private renderStats(stats: CharacterStatsView) {
    const sheet = document.createElement("div");
    sheet.id = "stats-sheet";

    const header = document.createElement("div");
    header.id = "stats-header";
    header.textContent = `Level ${stats.level} ${stats.className}`;
    sheet.appendChild(header);

    const hpBarBg = document.createElement("div");
    hpBarBg.className = "stats-bar-bg";
    const hpBarFill = document.createElement("div");
    hpBarFill.className = "stats-bar-fill stats-bar-hp";
    hpBarFill.style.width = `${Math.max(0, Math.min(1, stats.hp / stats.maxHp)) * 100}%`;
    hpBarBg.appendChild(hpBarFill);
    const hpLabel = document.createElement("div");
    hpLabel.className = "stats-bar-label";
    hpLabel.textContent = `HP  ${Math.ceil(Math.max(0, stats.hp))} / ${stats.maxHp}`;
    sheet.append(hpLabel, hpBarBg);

    const xpBarBg = document.createElement("div");
    xpBarBg.className = "stats-bar-bg";
    const xpBarFill = document.createElement("div");
    xpBarFill.className = "stats-bar-fill stats-bar-xp";
    xpBarFill.style.width = `${Math.max(0, Math.min(1, stats.experience / stats.xpToNextLevel)) * 100}%`;
    xpBarBg.appendChild(xpBarFill);
    const xpLabel = document.createElement("div");
    xpLabel.className = "stats-bar-label";
    xpLabel.textContent = `XP  ${stats.experience} / ${stats.xpToNextLevel}`;
    sheet.append(xpLabel, xpBarBg);

    const statsList = document.createElement("div");
    statsList.id = "stats-list";
    statRow(statsList, "Armor", stats.armor.toFixed(0));
    statRow(statsList, "Strength", stats.strength.toFixed(0));
    statRow(statsList, "Intelligence", stats.intelligence.toFixed(0));
    statRow(statsList, "Dexterity", stats.dexterity.toFixed(0));
    statRow(statsList, "Critical Chance", `${stats.criticalChance.toFixed(0)}%`);
    sheet.appendChild(statsList);

    this.bodyEl.appendChild(sheet);
  }
}

export const sidebar = new Sidebar();
