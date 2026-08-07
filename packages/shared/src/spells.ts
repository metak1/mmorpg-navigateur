export type SpellId = 1 | 2 | 3 | 4 | 5 | 6;
export type SpellKind = "single" | "aoe" | "heal" | "slow" | "groundAoe";

export interface SpellDef {
  name: string;
  kind: SpellKind;
  cooldownMs: number;
  castTimeMs: number; // 0 = instant; otherwise a cast bar delays the effect
  color: number;
  size: number; // projectile render size (px), unused for "heal"/"groundAoe"
  // single / aoe / slow
  damage?: number;
  projectileSpeed?: number;
  maxRange?: number; // also used by groundAoe as the max cast distance from the caster
  // aoe / groundAoe
  aoeRadius?: number;
  // slow only
  slowMultiplier?: number;
  slowDurationMs?: number;
  // heal / groundAoe
  healAmount?: number;
}

export const PROJECTILE_HIT_RADIUS = 6;
