import type { SpellKind } from "./spells.js";

export interface ClassTemplateDTO {
  id: string;
  name: string;
  color: number;
}

export type ClassTemplateInput = Omit<ClassTemplateDTO, "id">;

export interface MonsterDropDTO {
  id: string;
  itemId: string;
  dropChance: number;
  minQuantity: number;
  maxQuantity: number;
}

export type MonsterDropInput = Omit<MonsterDropDTO, "id">;

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
  // Optional ranged spell attack, on top of the always-present melee touch
  // attack above — null means melee-only. All five are set together or not
  // at all (see WorldRoom.updateMonsters).
  spellDamage: number | null;
  spellRange: number | null;
  spellCastTimeMs: number | null;
  spellCooldownMs: number | null;
  spellColor: number | null;
  drops: MonsterDropDTO[];
}

export type MonsterTemplateInput = Omit<MonsterTemplateDTO, "id" | "drops"> & { drops: MonsterDropInput[] };

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

export type TalentEffectType = "statBonus" | "spellModifier" | "mechanicFlag";
export type TalentBonusMode = "flat" | "percent";
export type TalentStatKey = "armor" | "strength" | "intelligence" | "dexterity" | "criticalChance" | "maxHp";
export type TalentSpellParam = "damage" | "cooldownMs" | "aoeRadius" | "healAmount" | "maxRange";

// Fixed, growing set of bespoke gameplay hooks a mechanicFlag effect can
// name. Each flag's actual behavior is hand-coded server-side separately,
// one at a time, as requested — this list is only the admin-authorable
// source of truth for which flag names exist to attach to a talent.
export const TALENT_MECHANIC_FLAGS = ["extraDashCharge", "lifestealOnCrit"] as const;
export type TalentMechanicFlag = (typeof TALENT_MECHANIC_FLAGS)[number];

export interface TalentEffectDTO {
  id: string;
  effectType: TalentEffectType;
  // statBonus
  statKey: TalentStatKey | null;
  // spellModifier
  spellTemplateId: string | null;
  spellParam: TalentSpellParam | null;
  // statBonus & spellModifier
  bonusMode: TalentBonusMode | null;
  valuePerRank: number | null;
  // mechanicFlag
  flagName: TalentMechanicFlag | null;
}

export type TalentEffectInput = Omit<TalentEffectDTO, "id">;

export interface TalentTemplateDTO {
  id: string;
  classId: string;
  name: string;
  description: string;
  tier: number;
  maxRank: number;
  prerequisiteId: string | null;
  effects: TalentEffectDTO[];
}

export type TalentTemplateInput = Omit<TalentTemplateDTO, "id" | "effects"> & { effects: TalentEffectInput[] };

export interface MonsterSpawnDTO {
  id: string;
  mapId: string;
  monsterTemplateId: string;
  x: number;
  y: number;
  // Marks this specific placement (not the template) as a dungeon's boss —
  // see MonsterSpawn.isBoss in schema.prisma.
  isBoss: boolean;
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

export interface AmbientSpawnDTO {
  id: string;
  monsterTemplateId: string;
  weight: number;
}

export type AmbientSpawnInput = Omit<AmbientSpawnDTO, "id">;

export interface MapPortalDTO {
  id: string;
  x: number;
  y: number;
  targetMapId: string;
}

export type MapPortalInput = Omit<MapPortalDTO, "id">;

export type DungeonObjectiveKind = "killBoss" | "killAllMonsters" | "killCount";

export interface DungeonObjectiveDTO {
  id: string;
  order: number;
  description: string;
  kind: DungeonObjectiveKind;
  // killCount only.
  monsterTemplateId: string | null;
  requiredCount: number | null;
}

export type DungeonObjectiveInput = Omit<DungeonObjectiveDTO, "id">;

export interface GameMapDTO {
  id: string;
  name: string;
  tileSize: number;
  spawnX: number;
  spawnY: number;
  isActive: boolean;
  ambientSpawnChance: number;
  // Solid fill color (0xrrggbb) for the "riser" face drawn between two
  // adjacent tiles with different elevation — purely cosmetic.
  cliffColor: number;
  // A dungeon map is never the active overworld map — it's only reached
  // through a portal, as its own instanced room. minLevel is only
  // meaningful when isDungeon is true.
  isDungeon: boolean;
  minLevel: number;
  // Shown to players in the dungeon-entry prompt before they commit to
  // entering — only meaningful when isDungeon is true, same as minLevel.
  description: string;
  spawns: MonsterSpawnDTO[];
  npcSpawns: NpcSpawnDTO[];
  ambientSpawns: AmbientSpawnDTO[];
  portals: MapPortalDTO[];
  dungeonObjectives: DungeonObjectiveDTO[];
}

export type GameMapInput = Omit<
  GameMapDTO,
  "id" | "isActive" | "spawns" | "npcSpawns" | "ambientSpawns" | "portals" | "dungeonObjectives"
> & {
  spawns: MonsterSpawnInput[];
  npcSpawns: NpcSpawnInput[];
  ambientSpawns: AmbientSpawnInput[];
  portals: MapPortalInput[];
  dungeonObjectives: DungeonObjectiveInput[];
};

// The active map's terrain is not shipped in this response — it's infinite,
// so the client fetches tiles on demand in ranges (see MapTileDTO) via a
// ChunkTileCache instead. This is just enough metadata to bootstrap that.
export interface ActiveMapResponse {
  mapId: string;
  tileSize: number;
  spawnX: number;
  spawnY: number;
  cliffColor: number;
}

// Decorative furniture/dungeon-dressing an admin can paint onto a tile —
// purely visual (see client/src/assets.ts's PROP_TEXTURE_KEYS), no gameplay
// effect of its own. Pair with blocksMovement on the same cell if it should
// also be solid (e.g. a dresser blocking a doorway).
export const PROP_TYPES = [
  "table", "chest", "dresser", "barrel", "torch", "door", "fence", "gravestone",
  // Below: the full Kenney "Isometric Blocks" (furnace/crate) and "Tiny
  // Dungeon" packs, added so the admin map editor's Furniture palette can
  // offer everything in both packs, not just this project's original
  // hand-picked eight.
  "furnace", "crate", "dirtFloor", "dirtFloorVar2", "dirtFloorVar3", "dirtFloorVar4", "stoneArchwayTopLeft", "stoneArchwayTopRight", "stonePillarTop", "ironSconce", "torchSconceGreen", "greenGemTorch", "darkFloor", "darkFloorVar2", "dirtFloorPebbles", "dirtFloorPebbles2", "stoneArchwayOpenLeft", "stoneArchwayOpenRight", "stonePillarBase", "stonePillarCap", "wallSconce", "gargoyleFaceLeft", "gargoyleFaceRight", "darkWall", "darkWallVar2", "darkWallVar3", "dirtFloorRocks", "dirtFloorRocks2", "stoneFrameLeft", "stoneFrameRight", "stoneWall", "redBanner", "sandFloor", "stoneVent", "emeraldAltar", "woodDoorClosedLeft", "woodDoorClosedMid", "woodDoorClosedRight", "plankWall", "plankWallVar2", "plankWallVar3", "plankWallEdge", "stoneWallVar2", "crossWindow", "stoneFloorTiles", "stoneSarcophagus", "emeraldSarcophagus", "woodDoorKnobLeft", "woodDoorKnobMid", "woodDoorKnobRight", "sandFloorVar2", "sandFloorSpeckled", "sandFloorVar3", "sandFloorSpeckled2", "sandFloorVar4", "sandFloorVar5", "metalLocker", "metalLockerVar2", "shieldEmblem", "stoneBrickWall", "stoneBrickWallVar2", "stoneBrickWallVar3", "targetMarker", "bandageIcon", "clothIcon", "woodDresser", "anvil", "metalCabinet", "roundShield", "ironGate", "ironGateVar2", "spiralRailing", "labyrinthFloorPart1", "labyrinthFloorPart2", "woodTable", "woodStool", "golemHead", "woodDresserVar2", "woodFence", "woodFenceVar2", "woodFenceVar3", "woodFenceVar4", "labyrinthFloorPart3", "labyrinthFloorPart4", "labyrinthCenter", "labyrinthFloorPart5", "portraitPurpleWizard", "portraitVillager", "portraitVillagerVar2", "portraitDwarf", "portraitVillagerVar3", "chestClosed", "chestOpen", "mimicChest", "mimicChestOpenMouth", "labyrinthFloorPart6", "labyrinthFloorPart7", "labyrinthFloorPart8", "portraitKnight", "portraitKnightVar2", "portraitVillagerVar4", "portraitGirl", "portraitDwarfVar2", "frameIcon", "blueGem", "dagger", "sword", "swordOrnate", "swordSilver", "swordRuby", "slimeMonster", "ogreMonster", "crabMonster", "portraitOldMan", "portraitGreenDwarf", "potionGray", "potionGreen", "potionRed", "potionBlue", "hammer", "mace", "flail", "beastFace", "ghost", "monsterShield", "helmet", "helmetVar2", "staffGreen", "staffRed", "staffBlueTip", "staffBlue", "wandPurple", "wandBlue", "swordBasic",
] as const;
export type PropType = (typeof PROP_TYPES)[number];

export interface MapTileDTO {
  col: number;
  row: number;
  tileType: number;
  elevation: number;
  // Invisible movement/LOS/projectile blocker layered on top of whatever
  // tileType/elevation this cell already has — see WorldGrid.blocksMovementAt.
  blocksMovement: boolean;
  propType: PropType | null;
}

// A tile entry with tileType equal to TileType.Grass (0) AND elevation
// equal to 0 means "reset to default" — the server deletes that row rather
// than storing an explicit default override, keeping the sparse table
// sparse. Any other combination (including Grass at a nonzero elevation)
// is stored explicitly.
export interface MapTilesUpdateInput {
  tiles: MapTileDTO[];
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
