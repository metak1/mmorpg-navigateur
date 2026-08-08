import type { SpellKind } from "./spells.js";

export interface ClassTemplateDTO {
  id: string;
  name: string;
  color: number;
}

export type ClassTemplateInput = Omit<ClassTemplateDTO, "id">;

export interface MonsterTemplateDTO {
  id: string;
  name: string;
  maxHp: number;
  wanderRadius: number;
  wanderIntervalMs: number;
  wanderSpeed: number;
  aggroRange: number;
  chaseSpeed: number;
  attackRange: number;
  touchDamage: number;
  attackCooldownMs: number;
  level: number;
  armor: number;
  xpReward: number;
}

export type MonsterTemplateInput = Omit<MonsterTemplateDTO, "id">;

export interface SpellTemplateDTO {
  id: string;
  classId: string;
  keybind: number;
  name: string;
  kind: SpellKind;
  cooldownMs: number;
  castTimeMs: number;
  color: number;
  size: number;
  damage: number | null;
  projectileSpeed: number | null;
  maxRange: number | null;
  aoeRadius: number | null;
  slowMultiplier: number | null;
  slowDurationMs: number | null;
  healAmount: number | null;
}

export type SpellTemplateInput = Omit<SpellTemplateDTO, "id">;

export interface MonsterSpawnDTO {
  id: string;
  mapId: string;
  monsterTemplateId: string;
  x: number;
  y: number;
}

export type MonsterSpawnInput = Omit<MonsterSpawnDTO, "id" | "mapId">;

export interface NpcTemplateDTO {
  id: string;
  name: string;
  color: number;
}

export type NpcTemplateInput = Omit<NpcTemplateDTO, "id">;

export interface NpcSpawnDTO {
  id: string;
  mapId: string;
  npcTemplateId: string;
  x: number;
  y: number;
}

export type NpcSpawnInput = Omit<NpcSpawnDTO, "id" | "mapId">;

// Categories an equippable item can belong to — ring/trinket are categories
// with two concrete slots each (see EquipmentSlot).
export type ItemSlotType = "helmet" | "gloves" | "chest" | "spalders" | "boots" | "legs" | "amulet" | "ring" | "trinket";

export type ItemRarity = "common" | "rare" | "epic" | "legendary";

// The concrete, addressable slots on a character.
export type EquipmentSlot =
  | "helmet"
  | "gloves"
  | "chest"
  | "spalders"
  | "boots"
  | "legs"
  | "amulet"
  | "ring1"
  | "ring2"
  | "trinket1"
  | "trinket2";

export const EQUIPMENT_SLOTS: EquipmentSlot[] = [
  "helmet",
  "amulet",
  "chest",
  "spalders",
  "gloves",
  "legs",
  "boots",
  "ring1",
  "ring2",
  "trinket1",
  "trinket2",
];

export interface ItemTemplateDTO {
  id: string;
  name: string;
  description: string;
  color: number;
  slotType: ItemSlotType | null;
  rarity: ItemRarity;
  bonusArmor: number;
  bonusStrength: number;
  bonusIntelligence: number;
  bonusDexterity: number;
  bonusCriticalChance: number;
  bonusHp: number;
}

export type ItemTemplateInput = Omit<ItemTemplateDTO, "id">;

export type QuestObjectiveType = "talkToNpc" | "killMonsters" | "bringItems";

export interface QuestRewardItemDTO {
  id: string;
  itemId: string;
  quantity: number;
}

export type QuestRewardItemInput = Omit<QuestRewardItemDTO, "id">;

export interface QuestDTO {
  id: string;
  title: string;
  description: string;
  giverNpcId: string;
  objectiveType: QuestObjectiveType;
  // talkToNpc
  targetNpcId: string | null;
  // killMonsters
  monsterTemplateId: string | null;
  // killMonsters / bringItems
  requiredCount: number;
  // bringItems
  itemId: string | null;
  rewardXp: number;
  rewardItems: QuestRewardItemDTO[];
}

export type QuestInput = Omit<QuestDTO, "id" | "rewardItems"> & { rewardItems: QuestRewardItemInput[] };

export interface GameMapDTO {
  id: string;
  name: string;
  width: number;
  height: number;
  tileSize: number;
  tileData: number[][];
  spawnX: number;
  spawnY: number;
  isActive: boolean;
  spawns: MonsterSpawnDTO[];
  npcSpawns: NpcSpawnDTO[];
}

export type GameMapInput = Omit<GameMapDTO, "id" | "isActive" | "spawns" | "npcSpawns"> & {
  spawns: MonsterSpawnInput[];
  npcSpawns: NpcSpawnInput[];
};

export interface ActiveMapResponse {
  width: number;
  height: number;
  tileSize: number;
  tileData: number[][];
  spawnX: number;
  spawnY: number;
}

export interface AccountDTO {
  id: string;
  username: string;
  role: "player" | "admin";
}

export interface AuthResponse {
  token: string;
  account: AccountDTO;
}

export interface CharacterDTO {
  id: string;
  name: string;
  className: string | null;
  level: number;
}

export type CharacterInput = { name: string; className: string };

export const MAX_CHARACTERS_PER_ACCOUNT = 5;
