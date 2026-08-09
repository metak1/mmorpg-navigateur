export type SpellId = 1 | 2 | 3 | 4 | 5 | 6;
export type SpellKind = "single" | "aoe" | "heal" | "slow" | "groundAoe" | "interrupt";

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
  // Also used by groundAoe as the max cast distance from the caster, and by
  // interrupt as its max targeting distance — interrupt uses nothing else
  // (no damage/heal/aoe/projectile: it's a pure instant utility effect that
  // cancels a monster's in-progress cast, see WorldRoom.resolveCastEffect).
  maxRange?: number;
  // aoe / groundAoe
  aoeRadius?: number;
  // slow only
  slowMultiplier?: number;
  slowDurationMs?: number;
  // heal / groundAoe
  healAmount?: number;
}

export const PROJECTILE_HIT_RADIUS = 6;
