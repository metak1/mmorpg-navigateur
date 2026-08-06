export type SpellId = 1 | 2 | 3 | 4 | 5;
export type SpellKind = "single" | "aoe" | "heal" | "slow";

export interface SpellDef {
  name: string;
  kind: SpellKind;
  cooldownMs: number;
  color: number;
  size: number; // projectile render size (px), unused for "heal"
  // single / aoe / slow
  damage?: number;
  projectileSpeed?: number;
  maxRange?: number;
  // aoe only
  aoeRadius?: number;
  // slow only
  slowMultiplier?: number;
  slowDurationMs?: number;
  // heal only
  healAmount?: number;
}

// Seed data for prisma/seed.ts (the initial SpellTemplate content) — the
// running game always loads spells from the database via the content backend.
export const DEFAULT_SPELLS: Record<SpellId, SpellDef> = {
  1: {
    name: "Bolt",
    kind: "single",
    cooldownMs: 400,
    color: 0xffee55,
    size: 6,
    damage: 15,
    projectileSpeed: 500,
    maxRange: 400,
  },
  2: {
    name: "Nuke",
    kind: "single",
    cooldownMs: 2500,
    color: 0xff5522,
    size: 12,
    damage: 60,
    projectileSpeed: 260,
    maxRange: 500,
  },
  3: {
    name: "AOE Blast",
    kind: "aoe",
    cooldownMs: 3000,
    color: 0xaa55ff,
    size: 10,
    damage: 25,
    projectileSpeed: 350,
    maxRange: 450,
    aoeRadius: 70,
  },
  4: {
    name: "Heal",
    kind: "heal",
    cooldownMs: 4000,
    color: 0x55ff88,
    size: 0,
    healAmount: 40,
  },
  5: {
    name: "Root",
    kind: "slow",
    cooldownMs: 2000,
    color: 0x55ddff,
    size: 8,
    damage: 5,
    projectileSpeed: 400,
    maxRange: 400,
    slowMultiplier: 0.2,
    slowDurationMs: 3000,
  },
};

export const PROJECTILE_HIT_RADIUS = 6;
