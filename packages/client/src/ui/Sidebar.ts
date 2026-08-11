import {
  EQUIPMENT_SLOTS,
  canLearnTalent,
  type EquipmentSlot,
  type ItemSlotType,
  type ItemRarity,
  type ItemStatBonuses,
  type InventoryStateMessage,
  type TalentTemplateDTO,
  type LearnedTalentView,
  type PartyStateMessage,
  type PartyApplicantView,
  type OpenPartyView,
} from "shared";
import { groupFinder, type GroupFinderHandlers } from "./GroupFinder.js";
import { iconForSlotType } from "./itemIcons.js";

type PanelKey = "chat" | "inventory" | "quests" | "stats" | "talents" | "party";

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

// Bag items carry an ItemSlotType (the category — "ring", not "ring1"), so
// tooltips there need their own label map, separate from SLOT_LABELS (which
// is keyed by the concrete EquipmentSlot a paperdoll box occupies).
const SLOT_LABELS_BY_TYPE: Record<ItemSlotType, string> = {
  helmet: "Helmet",
  gloves: "Gloves",
  chest: "Chest",
  spalders: "Spalders",
  boots: "Boots",
  legs: "Legs",
  amulet: "Amulet",
  ring: "Ring",
  trinket: "Trinket",
};

// Inverse of the ring1/ring2/trinket1/trinket2 split — for picking which
// icon an equipped paperdoll box shows (icons are keyed by category, same
// as SLOT_LABELS_BY_TYPE, not by the specific numbered slot).
function slotTypeForEquipmentSlot(slot: EquipmentSlot): ItemSlotType {
  if (slot === "ring1" || slot === "ring2") return "ring";
  if (slot === "trinket1" || slot === "trinket2") return "trinket";
  return slot;
}

// Equipping a ring/trinket-category item doesn't ask which of the two slots
// to use — it fills the first empty one, or replaces slot 1 if both are full.
function pickTargetSlot(slotType: ItemSlotType, equippedSlots: ReadonlySet<EquipmentSlot>): EquipmentSlot {
  if (slotType === "ring") return equippedSlots.has("ring1") ? "ring2" : "ring1";
  if (slotType === "trinket") return equippedSlots.has("trinket1") ? "trinket2" : "trinket1";
  return slotType;
}

const STAT_BONUS_LABELS: Record<keyof ItemStatBonuses, string> = {
  bonusArmor: "Armor",
  bonusStrength: "Strength",
  bonusIntelligence: "Intelligence",
  bonusDexterity: "Dexterity",
  bonusCriticalChance: "Critical Chance",
  bonusHp: "Health",
};

function statBonusLines(stats: ItemStatBonuses): string[] {
  const lines: string[] = [];
  for (const key of Object.keys(STAT_BONUS_LABELS) as Array<keyof ItemStatBonuses>) {
    const value = stats[key];
    if (value === 0) continue;
    const suffix = key === "bonusCriticalChance" ? "%" : "";
    lines.push(`${value > 0 ? "+" : ""}${value}${suffix} ${STAT_BONUS_LABELS[key]}`);
  }
  return lines;
}

// Shared by both equipment slots and bag tiles — a rarity-colored title,
// the slot category (only relevant for equipment/equippable bag items),
// non-zero stat bonuses, and the description, in that WoW-tooltip order.
function buildItemTooltip(
  name: string,
  rarity: ItemRarity,
  description: string,
  slotLabel: string | null,
  stats: ItemStatBonuses,
): HTMLDivElement {
  const tooltip = document.createElement("div");
  tooltip.className = "item-tooltip";

  const title = document.createElement("div");
  title.className = `item-tooltip-title rarity-${rarity}`;
  title.textContent = name;
  tooltip.appendChild(title);

  if (slotLabel) {
    const slotLine = document.createElement("div");
    slotLine.className = "item-tooltip-slot";
    slotLine.textContent = slotLabel;
    tooltip.appendChild(slotLine);
  }

  const lines = statBonusLines(stats);
  if (lines.length > 0) {
    const statsEl = document.createElement("div");
    statsEl.className = "item-tooltip-stats";
    for (const line of lines) {
      const row = document.createElement("div");
      row.textContent = line;
      statsEl.appendChild(row);
    }
    tooltip.appendChild(statsEl);
  }

  if (description) {
    const desc = document.createElement("div");
    desc.className = "item-tooltip-desc";
    desc.textContent = description;
    tooltip.appendChild(desc);
  }

  return tooltip;
}

// One square icon tile — used for both equipped-slot boxes and bag slots,
// same visual language WoW uses for both. rarity === null means an empty
// slot (grayed out, no click handler); tooltip is optional so genuinely
// empty bag-padding slots (no item, no category to explain) can render with
// none at all.
function buildItemTile(
  icon: string | null,
  rarity: ItemRarity | null,
  quantity: number | undefined,
  tooltip: HTMLElement | null,
  onClick?: () => void,
): HTMLDivElement {
  const tile = document.createElement("div");
  tile.className = `item-tile ${rarity ? `filled rarity-${rarity}` : "empty"}`;
  if (icon) tile.textContent = icon;

  if (quantity && quantity > 1) {
    const qty = document.createElement("span");
    qty.className = "item-tile-qty";
    qty.textContent = String(quantity);
    tile.appendChild(qty);
  }

  if (tooltip) {
    tile.appendChild(tooltip);
    attachHoverTooltip(tile, tooltip);
  }

  if (onClick) tile.addEventListener("click", onClick);

  return tile;
}

// Bag slots are a fixed grid (same idea as WoW's bag squares), padded with
// empty tiles past the last real item — always at least two full rows, and
// always at least one empty slot after the last item, so it never reads as
// a suspiciously-exact-fit list. There's no actual inventory-size cap
// server-side (see WorldRoom.sendInventoryState) so this never truncates
// real items, it only ever adds more rows. BAG_COLUMNS is only used for
// that row-rounding math — the actual CSS layout (#bag-grid) uses
// auto-fill so it's never wrong if the sidebar's width ever changes; this
// just needs to be a reasonable assumption for "how wide is a row".
const BAG_COLUMNS = 6;
const BAG_MIN_ROWS = 2;

// Shared by talent nodes and item tiles (equipment/bag) — position:fixed
// with JS-computed top/left rather than a CSS anchor, since both live
// inside #sidebar-body's overflow-y:auto and a CSS-anchored tooltip would
// get clipped by that ancestor whenever the anchor is near the top/bottom
// of the scroll area. Flips above/below based on real available space and
// clamps horizontally to the viewport.
function attachHoverTooltip(anchor: HTMLElement, tooltip: HTMLElement) {
  const gap = 8;
  anchor.addEventListener("mouseenter", () => {
    tooltip.style.display = "block";
    const anchorRect = anchor.getBoundingClientRect();
    const tooltipRect = tooltip.getBoundingClientRect();
    const showBelow = anchorRect.top < tooltipRect.height + gap;
    tooltip.style.top = showBelow
      ? `${anchorRect.bottom + gap}px`
      : `${anchorRect.top - tooltipRect.height - gap}px`;
    const left = Math.max(
      4,
      Math.min(
        anchorRect.left + anchorRect.width / 2 - tooltipRect.width / 2,
        window.innerWidth - tooltipRect.width - 4,
      ),
    );
    tooltip.style.left = `${left}px`;
  });
  anchor.addEventListener("mouseleave", () => {
    tooltip.style.display = "none";
  });
}

// Must match .talent-node-icon's width/height and .talent-tier-row's gap in
// index.html — used to size each tier row's CSS grid so a column means the
// same horizontal position in every row.
const TALENT_ICON_SIZE = 44;

// Assigns every talent a column such that a talent shares its
// prerequisite's column whenever possible (WoW-style: a chain runs straight
// down), falling back to the next free column for anything that can't —
// roots, or a second/third talent branching off the same prerequisite,
// which would otherwise overlap in that tier's row. Columns are shared
// across all tiers (never reused/reset per row), so column N lines up
// vertically all the way down the tree.
function assignTalentColumns(tiers: number[], byTier: Map<number, TalentTemplateDTO[]>): Map<string, number> {
  const columnById = new Map<string, number>();
  let nextFreeColumn = 0;

  for (const tier of tiers) {
    const talents = byTier.get(tier) ?? [];
    const usedThisTier = new Set<number>();

    // First pass: inherit the prerequisite's column where possible, so the
    // first child of a talent lands directly beneath it.
    for (const talent of talents) {
      const parentCol = talent.prerequisiteId ? columnById.get(talent.prerequisiteId) : undefined;
      if (parentCol === undefined || usedThisTier.has(parentCol)) continue;
      columnById.set(talent.id, parentCol);
      usedThisTier.add(parentCol);
      nextFreeColumn = Math.max(nextFreeColumn, parentCol + 1);
    }
    // Second pass: everything left (roots, or a sibling whose parent's
    // column was already claimed) gets the next unused column.
    for (const talent of talents) {
      if (columnById.has(talent.id)) continue;
      while (usedThisTier.has(nextFreeColumn)) nextFreeColumn++;
      columnById.set(talent.id, nextFreeColumn);
      usedThisTier.add(nextFreeColumn);
      nextFreeColumn++;
    }
  }

  return columnById;
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

export interface OnlinePlayerView {
  sessionId: string;
  name: string;
}

// Re-exported under the sidebar's own name for callers that only know about
// the Party tab — it's the exact same handler shape GroupFinder itself
// uses, since the sidebar just docks that one shared component in.
export type PartyHandlers = GroupFinderHandlers;

// defs is the class's full tree definition (content, fetched once via REST —
// see net/api.ts's fetchTalents), while points/learned are the private,
// server-pushed per-character progress (see TalentStateMessage) — this view
// just combines the two so renderTalents doesn't need two separate inputs.
export interface TalentPanelData {
  points: number;
  learned: LearnedTalentView[];
  defs: TalentTemplateDTO[];
}

const KEY_TO_PANEL: Record<string, PanelKey> = {
  c: "chat",
  i: "inventory",
  l: "quests",
  k: "stats",
  t: "talents",
  p: "party",
};
const DEFAULT_PANEL: PanelKey = "chat";

// Placeholder body copy until each panel grows real content/state of its own.
const PANEL_PLACEHOLDER: Record<PanelKey, string> = {
  chat: "Chat coming soon",
  inventory: "Inventory coming soon",
  quests: "No active quests",
  stats: "Not in a game yet",
  talents: "Not in a game yet",
  party: "Not in a game yet",
};

const EMPTY_PARTY_STATE: PartyStateMessage = { leaderSessionId: null, members: [], open: false };

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
  private mySessionId = "";
  private party: PartyStateMessage = EMPTY_PARTY_STATE;
  private onlinePlayers: OnlinePlayerView[] = [];
  private applicants: PartyApplicantView[] = [];
  private openParties: OpenPartyView[] = [];
  private myPendingApplications: ReadonlySet<string> = new Set();
  private partyHandlers: PartyHandlers | null = null;

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

    // Below the index.html max-width:700px breakpoint, #sidebar becomes a
    // fixed off-canvas overlay instead of sitting alongside the game canvas
    // (a 300px sidebar next to the canvas leaves almost nothing for the game
    // on a phone) — this button is the only way to open/close it there;
    // above the breakpoint it's hidden by CSS and the "open" class is inert.
    const sidebarEl = document.querySelector<HTMLElement>("#sidebar")!;
    const toggleEl = document.querySelector<HTMLElement>("#sidebar-toggle")!;
    toggleEl.addEventListener("click", () => sidebarEl.classList.toggle("open"));

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

  setMySessionId(sessionId: string) {
    this.mySessionId = sessionId;
  }

  // Recomputed by the caller from room.state.players whenever it changes
  // (join/leave) — this is the pool of people invitable to a party, so it
  // needs to stay current even while the party panel isn't the active tab.
  setOnlinePlayers(players: OnlinePlayerView[]) {
    this.onlinePlayers = players;
    if (this.currentPanel === "party") this.render();
  }

  setParty(party: PartyStateMessage) {
    this.party = party;
    if (this.currentPanel === "party") this.render();
  }

  // Leader-only in practice (see WorldRoom.sendPartyApplications) — empty
  // for everyone else, so this just quietly renders nothing extra for them.
  setApplicants(applicants: PartyApplicantView[]) {
    this.applicants = applicants;
    if (this.currentPanel === "party") this.render();
  }

  // The server-wide browsable list of open, non-full parties — kept current
  // even while the Party tab isn't active for the same reason
  // setOnlinePlayers is.
  setOpenParties(parties: OpenPartyView[]) {
    this.openParties = parties;
    if (this.currentPanel === "party") this.render();
  }

  setMyPendingApplications(pending: ReadonlySet<string>) {
    this.myPendingApplications = pending;
    if (this.currentPanel === "party") this.render();
  }

  setPartyHandlers(handlers: PartyHandlers) {
    this.partyHandlers = handlers;
  }

  private render() {
    this.bodyEl.innerHTML = "";
    // GroupFinder tracks a single container at a time (see its own hide()
    // doc) — clearing bodyEl above already wipes it visually whenever a
    // non-party panel renders, but without this it would still think that
    // (now-repurposed) element is live and render stale party updates into
    // whatever panel replaced it.
    if (this.currentPanel !== "party") groupFinder.hide();

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
    if (this.currentPanel === "party" && this.mySessionId) {
      const handlers: PartyHandlers = this.partyHandlers ?? {
        onCreateGroup: () => {},
        onInvite: () => {},
        onLeave: () => {},
        onSetOpen: () => {},
        onApply: () => {},
        onWithdrawApplication: () => {},
        onRespondApplication: () => {},
      };
      groupFinder.show(
        this.bodyEl,
        {
          party: this.party,
          onlinePlayers: this.onlinePlayers,
          mySessionId: this.mySessionId,
          applicants: this.applicants,
          openParties: this.openParties,
          myPendingApplications: this.myPendingApplications,
        },
        handlers,
      );
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

  // WoW-style: every item (equipped or bagged) is a square icon tile,
  // hover for a tooltip with its stats — see buildItemTile/buildItemTooltip.
  private renderInventory(inventory: InventoryStateMessage) {
    const wrapper = document.createElement("div");
    wrapper.id = "inventory-panel";

    const equippedBySlot = new Map(inventory.equipped.map((e) => [e.slot, e]));
    const equippedSlots = new Set(inventory.equipped.map((e) => e.slot));

    const grid = document.createElement("div");
    grid.id = "equipment-grid";
    for (const slot of EQUIPMENT_SLOTS) {
      const equipped = equippedBySlot.get(slot);
      const slotLabel = SLOT_LABELS[slot];

      if (equipped) {
        const tooltip = buildItemTooltip(equipped.name, equipped.rarity, equipped.description, slotLabel, equipped);
        const tile = buildItemTile(iconForSlotType(slotTypeForEquipmentSlot(slot)), equipped.rarity, undefined, tooltip, () =>
          this.inventoryHandlers?.onUnequip(slot),
        );
        tile.title = "Click to unequip";
        grid.appendChild(tile);
      } else {
        const tooltip = document.createElement("div");
        tooltip.className = "item-tooltip";
        const title = document.createElement("div");
        title.className = "item-tooltip-slot-empty";
        title.textContent = `${slotLabel} (Empty)`;
        tooltip.appendChild(title);
        grid.appendChild(buildItemTile(iconForSlotType(slotTypeForEquipmentSlot(slot)), null, undefined, tooltip));
      }
    }
    wrapper.appendChild(grid);

    const bagHeader = document.createElement("div");
    bagHeader.id = "bag-header";
    bagHeader.textContent = "Bag";
    wrapper.appendChild(bagHeader);

    const bagGrid = document.createElement("div");
    bagGrid.id = "bag-grid";

    for (const item of inventory.items) {
      const tooltip = buildItemTooltip(item.name, item.rarity, item.description, item.slotType ? SLOT_LABELS_BY_TYPE[item.slotType] : null, item);
      const onClick = item.slotType
        ? () => this.inventoryHandlers?.onEquip(item.itemId, pickTargetSlot(item.slotType!, equippedSlots))
        : undefined;
      const tile = buildItemTile(iconForSlotType(item.slotType), item.rarity, item.quantity, tooltip, onClick);
      if (item.slotType) tile.title = "Click to equip";
      bagGrid.appendChild(tile);
    }

    const totalSlots = Math.max(BAG_COLUMNS * BAG_MIN_ROWS, Math.ceil((inventory.items.length + 1) / BAG_COLUMNS) * BAG_COLUMNS);
    for (let i = inventory.items.length; i < totalSlots; i++) {
      bagGrid.appendChild(buildItemTile(null, null, undefined, null));
    }
    wrapper.appendChild(bagGrid);

    this.bodyEl.appendChild(wrapper);
  }

  // WoW-style tree: each talent is a square icon (name initials, hover for
  // the full name/description/rank via a tooltip) laid out one row per
  // tier, each row a CSS grid sharing the same column tracks (see
  // assignTalentColumns) so a talent lines up directly under its
  // prerequisite; the connecting line drawn between them is then a clean
  // vertical (rather than a diagonal cutting across unrelated icons).
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

    const columnById = assignTalentColumns(tiers, byTier);
    const totalColumns = Math.max(0, ...[...columnById.values()].map((c) => c + 1));
    const gridTemplateColumns = `repeat(${totalColumns}, ${TALENT_ICON_SIZE}px)`;

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
      row.style.gridTemplateColumns = gridTemplateColumns;

      for (const talent of byTier.get(tier) ?? []) {
        const rank = learnedRanks.get(talent.id) ?? 0;
        const maxed = rank >= talent.maxRank;
        // Same rule the server enforces on learnTalent (see
        // WorldRoom.handleLearnTalent) — evaluated here purely for display,
        // the server is still the actual gate.
        const learnable = canLearnTalent(talent, learnedRanks, data.points);

        const icon = document.createElement("div");
        icon.className = `talent-node-icon ${learnable ? "learnable" : maxed ? "maxed" : "locked"}`;
        // grid-column is 1-indexed; the same column number in every tier
        // row maps to the same CSS grid track (same gridTemplateColumns
        // string), so column N is pixel-aligned across the whole tree.
        icon.style.gridColumn = String((columnById.get(talent.id) ?? 0) + 1);
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
        attachHoverTooltip(icon, tooltip);

        row.appendChild(icon);
        nodeEls.set(talent.id, icon);
      }
      tree.appendChild(row);
    }

    wrapper.appendChild(tree);
    this.bodyEl.appendChild(wrapper);

    // Node positions only reflect real layout once the browser has actually
    // laid the tree out, which hasn't necessarily happened synchronously
    // right after appending — deferring to the next frame guarantees it has.
    requestAnimationFrame(() => {
      svg.setAttribute("width", String(tree.scrollWidth));
      svg.setAttribute("height", String(tree.scrollHeight));
      const treeRect = tree.getBoundingClientRect();
      for (const talent of data.defs) {
        if (!talent.prerequisiteId) continue;
        const from = nodeEls.get(talent.prerequisiteId);
        const to = nodeEls.get(talent.id);
        if (!from || !to) continue;

        // getBoundingClientRect (not offsetLeft/offsetTop) because each icon's
        // offsetParent is its own .talent-tier-row (position: relative), not
        // the tree — offsetLeft/Top would be relative to different rows per
        // node instead of one shared coordinate space, scattering the lines.
        const fromRect = from.getBoundingClientRect();
        const toRect = to.getBoundingClientRect();

        // Edge-to-edge (bottom of the prerequisite to top of the dependent),
        // not center-to-center — a center-to-center line cuts straight
        // through both icon squares (and the rank badge) instead of just
        // connecting them. Tiers render top-to-bottom in ascending order, so
        // the prerequisite is always the one above.
        const line = document.createElementNS(svgNs, "line");
        line.setAttribute("x1", String(fromRect.left + fromRect.width / 2 - treeRect.left));
        line.setAttribute("y1", String(fromRect.bottom - treeRect.top));
        line.setAttribute("x2", String(toRect.left + toRect.width / 2 - treeRect.left));
        line.setAttribute("y2", String(toRect.top - treeRect.top));
        line.setAttribute("class", `talent-line${(learnedRanks.get(talent.prerequisiteId) ?? 0) > 0 ? " active" : ""}`);
        svg.appendChild(line);
      }
    });
  }

}

export const sidebar = new Sidebar();
