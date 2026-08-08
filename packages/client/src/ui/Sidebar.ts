import { EQUIPMENT_SLOTS, type EquipmentSlot, type ItemSlotType, type InventoryStateMessage } from "shared";

type PanelKey = "chat" | "inventory" | "quests" | "stats";

const SLOT_LABELS: Record<EquipmentSlot, string> = {
  helmet: "Helmet",
  gloves: "Gloves",
  chest: "Chest",
  spalders: "Spalders",
  boots: "Boots",
  legs: "Legs",
  amulet: "Amulet",
  ring1: "Ring 1",
  ring2: "Ring 2",
  trinket1: "Trinket 1",
  trinket2: "Trinket 2",
};

// Equipping a ring/trinket-category item doesn't ask which of the two slots
// to use — it fills the first empty one, or replaces slot 1 if both are full.
function pickTargetSlot(slotType: ItemSlotType, equippedSlots: ReadonlySet<EquipmentSlot>): EquipmentSlot {
  if (slotType === "ring") return equippedSlots.has("ring1") ? "ring2" : "ring1";
  if (slotType === "trinket") return equippedSlots.has("trinket1") ? "trinket2" : "trinket1";
  return slotType;
}

export interface InventoryHandlers {
  onEquip: (itemId: string, slot: EquipmentSlot) => void;
  onUnequip: (slot: EquipmentSlot) => void;
}

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

export interface CompletedQuestEntry {
  questId: string;
  title: string;
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
  private completedQuests: CompletedQuestEntry[] = [];
  private showCompletedQuests = false;
  private stats: CharacterStatsView | null = null;
  private inventory: InventoryStateMessage | null = null;
  private inventoryHandlers: InventoryHandlers | null = null;

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

  setCompletedQuests(quests: CompletedQuestEntry[]) {
    this.completedQuests = quests;
    if (this.currentPanel === "quests") this.render();
  }

  setStats(stats: CharacterStatsView) {
    this.stats = stats;
    if (this.currentPanel === "stats") this.render();
  }

  setInventoryHandlers(handlers: InventoryHandlers) {
    this.inventoryHandlers = handlers;
  }

  setInventory(inventory: InventoryStateMessage) {
    this.inventory = inventory;
    if (this.currentPanel === "inventory") this.render();
  }

  private render() {
    this.bodyEl.innerHTML = "";

    if (this.currentPanel === "quests" && (this.quests.length > 0 || this.completedQuests.length > 0)) {
      this.renderQuests();
      return;
    }
    if (this.currentPanel === "stats" && this.stats) {
      this.renderStats(this.stats);
      return;
    }
    if (this.currentPanel === "inventory" && this.inventory) {
      this.renderInventory(this.inventory);
      return;
    }

    this.bodyEl.textContent = PANEL_PLACEHOLDER[this.currentPanel];
  }

  private renderQuests() {
    const list = document.createElement("div");
    list.id = "quest-log-list";
    if (this.quests.length === 0) {
      const empty = document.createElement("div");
      empty.className = "quest-log-empty";
      empty.textContent = "No active quests";
      list.appendChild(empty);
    }
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

    const toggle = document.createElement("button");
    toggle.id = "quest-log-completed-toggle";
    toggle.textContent = `${this.showCompletedQuests ? "▾" : "▸"} Completed Quests (${this.completedQuests.length})`;
    toggle.addEventListener("click", () => {
      this.showCompletedQuests = !this.showCompletedQuests;
      this.render();
    });
    this.bodyEl.appendChild(toggle);

    if (this.showCompletedQuests) {
      const completedList = document.createElement("div");
      completedList.id = "quest-log-completed-list";
      if (this.completedQuests.length === 0) {
        const empty = document.createElement("div");
        empty.className = "quest-log-empty";
        empty.textContent = "No completed quests yet";
        completedList.appendChild(empty);
      }
      for (const quest of this.completedQuests) {
        const item = document.createElement("div");
        item.className = "quest-log-item quest-log-item-completed";
        item.textContent = `${quest.title} ✓`;
        completedList.appendChild(item);
      }
      this.bodyEl.appendChild(completedList);
    }
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

  private renderInventory(inventory: InventoryStateMessage) {
    const wrapper = document.createElement("div");
    wrapper.id = "inventory-panel";

    const equippedBySlot = new Map(inventory.equipped.map((e) => [e.slot, e]));
    const equippedSlots = new Set(inventory.equipped.map((e) => e.slot));

    const grid = document.createElement("div");
    grid.id = "equipment-grid";
    for (const slot of EQUIPMENT_SLOTS) {
      const box = document.createElement("div");
      const equipped = equippedBySlot.get(slot);
      box.className = `equipment-slot ${equipped ? `filled rarity-${equipped.rarity}` : "empty"}`;

      const label = document.createElement("div");
      label.className = "equipment-slot-label";
      label.textContent = SLOT_LABELS[slot];
      box.appendChild(label);

      if (equipped) {
        const name = document.createElement("div");
        name.className = "equipment-slot-item";
        name.textContent = equipped.name;
        box.appendChild(name);
        box.title = "Click to unequip";
        box.addEventListener("click", () => this.inventoryHandlers?.onUnequip(slot));
      }

      grid.appendChild(box);
    }
    wrapper.appendChild(grid);

    const bagHeader = document.createElement("div");
    bagHeader.id = "bag-header";
    bagHeader.textContent = "Bag";
    wrapper.appendChild(bagHeader);

    const bagList = document.createElement("div");
    bagList.id = "bag-list";
    if (inventory.items.length === 0) {
      const empty = document.createElement("div");
      empty.className = "bag-empty";
      empty.textContent = "Empty";
      bagList.appendChild(empty);
    }

    for (const item of inventory.items) {
      const row = document.createElement("div");
      row.className = `bag-item rarity-${item.rarity}`;

      const info = document.createElement("div");
      info.className = "bag-item-info";
      const name = document.createElement("div");
      name.className = "bag-item-name";
      name.textContent = item.quantity > 1 ? `${item.name} x${item.quantity}` : item.name;
      const desc = document.createElement("div");
      desc.className = "bag-item-desc";
      desc.textContent = item.description;
      info.append(name, desc);
      row.appendChild(info);

      if (item.slotType) {
        const slotType = item.slotType;
        const button = document.createElement("button");
        button.textContent = "Equip";
        button.addEventListener("click", () => {
          const slot = pickTargetSlot(slotType, equippedSlots);
          this.inventoryHandlers?.onEquip(item.itemId, slot);
        });
        row.appendChild(button);
      }

      bagList.appendChild(row);
    }
    wrapper.appendChild(bagList);

    this.bodyEl.appendChild(wrapper);
  }
}

export const sidebar = new Sidebar();
