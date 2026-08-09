import {
  EQUIPMENT_SLOTS,
  canLearnTalent,
  type EquipmentSlot,
  type ItemSlotType,
  type InventoryStateMessage,
  type TalentTemplateDTO,
  type LearnedTalentView,
} from "shared";

type PanelKey = "chat" | "inventory" | "quests" | "stats" | "talents";

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

export interface TalentHandlers {
  onLearn: (talentId: string) => void;
}

export interface AdminHandlers {
  onLevelTo10: () => void;
}

// defs is the class's full tree definition (content, fetched once via REST —
// see net/api.ts's fetchTalents), while points/learned are the private,
// server-pushed per-character progress (see TalentStateMessage) — this view
// just combines the two so renderTalents doesn't need two separate inputs.
export interface TalentPanelData {
  points: number;
  learned: LearnedTalentView[];
  defs: TalentTemplateDTO[];
}

const KEY_TO_PANEL: Record<string, PanelKey> = { c: "chat", i: "inventory", l: "quests", k: "stats", t: "talents" };
const DEFAULT_PANEL: PanelKey = "chat";

// Placeholder body copy until each panel grows real content/state of its own.
const PANEL_PLACEHOLDER: Record<PanelKey, string> = {
  chat: "Chat coming soon",
  inventory: "Inventory coming soon",
  quests: "No active quests",
  stats: "Not in a game yet",
  talents: "Not in a game yet",
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
  private talents: TalentPanelData | null = null;
  private talentHandlers: TalentHandlers | null = null;
  private isAdmin = false;
  private adminHandlers: AdminHandlers | null = null;

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

  setTalentHandlers(handlers: TalentHandlers) {
    this.talentHandlers = handlers;
  }

  setTalents(talents: TalentPanelData) {
    this.talents = talents;
    if (this.currentPanel === "talents") this.render();
  }

  setAdminHandlers(handlers: AdminHandlers) {
    this.adminHandlers = handlers;
  }

  // Debug/testing tools shown only to admin accounts (see WorldScene, which
  // resolves this from the logged-in account's role) — currently just a
  // shortcut to fast-forward to level 10 and unlock talent points, added to
  // the character sheet since that's where level/points are shown.
  setAdmin(isAdmin: boolean) {
    this.isAdmin = isAdmin;
    if (this.currentPanel === "stats") this.render();
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
    if (this.currentPanel === "talents" && this.talents) {
      this.renderTalents(this.talents);
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

    if (this.isAdmin) {
      const adminSection = document.createElement("div");
      adminSection.id = "admin-tools";
      const adminLabel = document.createElement("div");
      adminLabel.className = "talent-tier-label";
      adminLabel.textContent = "Admin Tools";
      const levelBtn = document.createElement("button");
      levelBtn.textContent = "⚡ Level to 10";
      levelBtn.addEventListener("click", () => this.adminHandlers?.onLevelTo10());
      adminSection.append(adminLabel, levelBtn);
      sheet.appendChild(adminSection);
    }

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

  // WoW-style tree: each talent is a square icon (name initials, hover for
  // the full name/description/rank via a CSS-only tooltip) laid out one flex
  // row per tier; a prerequisite relationship is drawn as a connecting line
  // rather than spelled out in text, lit up once the prerequisite has a
  // point in it.
  private renderTalents(data: TalentPanelData) {
    const wrapper = document.createElement("div");
    wrapper.id = "talents-panel";

    const pointsLabel = document.createElement("div");
    pointsLabel.id = "talent-points";
    pointsLabel.textContent = `${data.points} point${data.points === 1 ? "" : "s"} available`;
    wrapper.appendChild(pointsLabel);

    if (data.defs.length === 0) {
      const empty = document.createElement("div");
      empty.className = "bag-empty";
      empty.textContent = "This class has no talents yet";
      wrapper.append(empty);
      this.bodyEl.appendChild(wrapper);
      return;
    }

    const learnedRanks = new Map(data.learned.map((l) => [l.talentId, l.rank]));

    const byTier = new Map<number, TalentTemplateDTO[]>();
    for (const talent of data.defs) {
      const list = byTier.get(talent.tier) ?? [];
      list.push(talent);
      byTier.set(talent.tier, list);
    }
    const tiers = [...byTier.keys()].sort((a, b) => a - b);

    const tree = document.createElement("div");
    tree.id = "talent-tree";

    // Namespaced element creation (createElementNS, not createElement) is
    // required for SVG — the plain DOM API would create an invalid/inert
    // HTML element named "svg" instead of a real SVG node.
    const svgNs = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(svgNs, "svg");
    svg.id = "talent-lines";
    tree.appendChild(svg);

    const nodeEls = new Map<string, HTMLElement>();

    for (const tier of tiers) {
      const row = document.createElement("div");
      row.className = "talent-tier-row";

      for (const talent of byTier.get(tier) ?? []) {
        const rank = learnedRanks.get(talent.id) ?? 0;
        const maxed = rank >= talent.maxRank;
        // Same rule the server enforces on learnTalent (see
        // WorldRoom.handleLearnTalent) — evaluated here purely for display,
        // the server is still the actual gate.
        const learnable = canLearnTalent(talent, learnedRanks, data.points);

        const icon = document.createElement("div");
        icon.className = `talent-node-icon ${learnable ? "learnable" : maxed ? "maxed" : "locked"}`;
        icon.textContent = talent.name.slice(0, 2).toUpperCase();
        if (learnable) icon.addEventListener("click", () => this.talentHandlers?.onLearn(talent.id));

        const rankBadge = document.createElement("span");
        rankBadge.className = "talent-node-rank-badge";
        rankBadge.textContent = `${rank}/${talent.maxRank}`;
        icon.appendChild(rankBadge);

        const tooltip = document.createElement("div");
        tooltip.className = "talent-tooltip";
        const tooltipTitle = document.createElement("div");
        tooltipTitle.className = "talent-tooltip-title";
        tooltipTitle.textContent = talent.name;
        const tooltipDesc = document.createElement("div");
        tooltipDesc.className = "talent-tooltip-desc";
        tooltipDesc.textContent = talent.description;
        const tooltipRank = document.createElement("div");
        tooltipRank.className = "talent-tooltip-rank";
        tooltipRank.textContent = `Rank ${rank} / ${talent.maxRank}`;
        tooltip.append(tooltipTitle, tooltipDesc, tooltipRank);
        icon.appendChild(tooltip);

        row.appendChild(icon);
        nodeEls.set(talent.id, icon);
      }
      tree.appendChild(row);
    }

    wrapper.appendChild(tree);
    this.bodyEl.appendChild(wrapper);

    // Node positions (offsetLeft/offsetTop) only reflect real layout once
    // the browser has actually laid the tree out, which hasn't necessarily
    // happened synchronously right after appending — deferring to the next
    // frame guarantees it has.
    requestAnimationFrame(() => {
      svg.setAttribute("width", String(tree.scrollWidth));
      svg.setAttribute("height", String(tree.scrollHeight));
      for (const talent of data.defs) {
        if (!talent.prerequisiteId) continue;
        const from = nodeEls.get(talent.prerequisiteId);
        const to = nodeEls.get(talent.id);
        if (!from || !to) continue;

        const line = document.createElementNS(svgNs, "line");
        line.setAttribute("x1", String(from.offsetLeft + from.offsetWidth / 2));
        line.setAttribute("y1", String(from.offsetTop + from.offsetHeight / 2));
        line.setAttribute("x2", String(to.offsetLeft + to.offsetWidth / 2));
        line.setAttribute("y2", String(to.offsetTop + to.offsetHeight / 2));
        line.setAttribute("class", `talent-line${(learnedRanks.get(talent.prerequisiteId) ?? 0) > 0 ? " active" : ""}`);
        svg.appendChild(line);
      }
    });
  }
}

export const sidebar = new Sidebar();
