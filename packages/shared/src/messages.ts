import type { SpellId } from "./spells.js";
import type { EquipmentSlot, ItemRarity, ItemSlotType } from "./api-types.js";

export const WORLD_ROOM = "world";
export const MOVE_SPEED = 200; // px/sec

// Options sent when joining the world room. The session token is issued by
// POST /api/auth/login or /api/auth/register and identifies the account
// server-side; characterId selects which of that account's characters to
// play — the room verifies both, it never trusts a client-supplied name.
export interface JoinOptions {
  token: string;
  characterId: string;
}

export interface MoveInputMessage {
  dx: number;
  dy: number;
  direction: "up" | "down" | "left" | "right";
}

export interface CastInputMessage {
  spellId: SpellId;
  // Monster id to aim at, captured at cast time. Omitted/ignored for
  // self-targeted kinds (e.g. "heal") and ground-targeted kinds ("groundAoe").
  targetId?: string;
  // World-space cast point for "groundAoe" — wherever the caster's mouse was
  // at cast time. Ignored by every other kind.
  x?: number;
  y?: number;
}

// Broadcast whenever a heal successfully lands (cooldown passed), so clients
// can show a cast effect even though "heal" has no Projectile state to watch.
export interface HealEventMessage {
  sessionId: string;
}

// Broadcast whenever a "groundAoe" cast resolves, so clients can render the
// burst at its (possibly range-clamped) landing point and radius.
export interface GroundAoeEventMessage {
  x: number;
  y: number;
  radius: number;
  color: number;
}

// Sent back to the casting client only, when a targeted cast (single/aoe/
// slow) resolves with no valid target left — e.g. the monster died in the
// window between being targeted and the cast (possibly after a cast-time
// delay) actually resolving. The per-spell cooldown is refunded server-side
// when this fires, so the client rolls back its optimistic cooldown/cast-bar
// UI to match, instead of leaving it playing out for a cast that never
// happened.
export interface CastFizzledMessage {
  spellId: SpellId;
}

// Client -> server: interact with an NPC (approaches it and clicks/presses
// interact). The server replies with "npcDialogue" describing what that NPC
// currently has to say to this character.
export interface TalkMessage {
  npcId: string;
}

export interface AcceptQuestMessage {
  questId: string;
}

export interface TurnInQuestMessage {
  questId: string;
}

export type NpcDialogueOptionKind = "offer" | "turnIn" | "inProgress";

// One quest-shaped thing this NPC currently has to say: a new quest it can
// give ("offer"), an active quest it gave that's ready to complete
// ("turnIn"), or an active quest it gave that isn't ready yet ("inProgress",
// shown so players know to come back later instead of nothing happening).
export interface NpcDialogueOption {
  kind: NpcDialogueOptionKind;
  questId: string;
  title: string;
  description: string;
  objectiveSummary: string;
}

export interface NpcDialogueMessage {
  npcId: string;
  npcName: string;
  options: NpcDialogueOption[];
}

// Sent back to the requesting client only, when accept/turn-in is rejected
// server-side (e.g. already have it, not actually ready yet) — the dialogue
// UI shows the reason instead of silently doing nothing.
export interface QuestActionFailedMessage {
  questId: string;
  reason: string;
}

export interface QuestCompletedMessage {
  questId: string;
  title: string;
  rewardXp: number;
  rewardItems: Array<{ name: string; quantity: number }>;
}

// Client -> server: equip an owned item into a specific concrete slot. The
// slot must be compatible with the item's category (ring items -> ring1/
// ring2, trinket items -> trinket1/trinket2, everything else maps 1:1).
export interface EquipItemMessage {
  itemId: string;
  slot: EquipmentSlot;
}

export interface UnequipItemMessage {
  slot: EquipmentSlot;
}

export interface EquipActionFailedMessage {
  reason: string;
}

export interface InventoryItemView {
  itemId: string;
  name: string;
  description: string;
  color: number;
  rarity: ItemRarity;
  slotType: ItemSlotType | null;
  quantity: number;
}

export interface EquippedItemView {
  slot: EquipmentSlot;
  itemId: string;
  name: string;
  color: number;
  rarity: ItemRarity;
}

// Pushed to the owning client whenever their inventory or equipped loadout
// changes (join, quest reward, equip, unequip) — private per-character data,
// so it's request/response messaging rather than synced room state.
export interface InventoryStateMessage {
  items: InventoryItemView[];
  equipped: EquippedItemView[];
}

// Sent to the killing player only, once per monster death, listing every
// loot-table entry that rolled successfully (may be empty).
export interface LootDroppedMessage {
  drops: Array<{ itemId: string; name: string; color: number; rarity: ItemRarity; quantity: number }>;
}
