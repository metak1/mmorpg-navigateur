// Runtime constants that apply globally, regardless of map/monster content.
export const MONSTER_RESPAWN_MS = 5000;
export const PLAYER_MAX_HP = 100;
export const PLAYER_RESPAWN_INVULNERABLE_MS = 1000;
// Shared cooldown applied across all spells whenever any spell is cast, on
// top of that spell's own cooldown — prevents weaving instant spells together.
export const GLOBAL_COOLDOWN_MS = 1000;

// Everything below is seed data for prisma/seed.ts (the initial
// MonsterTemplate + MonsterSpawn content) — the running game always loads
// monster stats/spawns from the database via the content backend.
export const DEFAULT_MONSTER_MAX_HP = 100;

// Fixed spawn points on open grass tiles (verified against the default map
// grid in shared/src/map.ts: away from the pond at rows 3-5/cols 5-8 and the
// wall obstacles at (12,15) (12,16) (13,15)).
export const DEFAULT_MONSTER_SPAWNS: Array<{ x: number; y: number }> = [
  { x: 496, y: 112 }, // row 3, col 15
  { x: 656, y: 432 }, // row 13, col 20
];

// Monster AI defaults
export const DEFAULT_WANDER_RADIUS = 96; // px, around the monster's home spawn point
export const DEFAULT_WANDER_INTERVAL_MS = 3000;
export const DEFAULT_WANDER_SPEED = 40; // px/sec
export const DEFAULT_AGGRO_RANGE = 120; // px
export const DEFAULT_CHASE_SPEED = 90; // px/sec
export const DEFAULT_MONSTER_ATTACK_RANGE = 32; // px, contact damage range
export const DEFAULT_MONSTER_TOUCH_DAMAGE = 10;
export const DEFAULT_MONSTER_ATTACK_COOLDOWN_MS = 1000;
export const DEFAULT_MONSTER_LEVEL = 1;
export const DEFAULT_MONSTER_ARMOR = 2;
export const DEFAULT_MONSTER_XP_REWARD = 25;
