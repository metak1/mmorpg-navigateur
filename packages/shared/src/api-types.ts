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
}

export type GameMapInput = Omit<GameMapDTO, "id" | "isActive" | "spawns"> & {
  spawns: MonsterSpawnInput[];
};

export interface ActiveMapResponse {
  width: number;
  height: number;
  tileSize: number;
  tileData: number[][];
  spawnX: number;
  spawnY: number;
}
