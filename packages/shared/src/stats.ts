export interface CombatStats {
  level: number;
  experience: number;
  armor: number;
  strength: number;
  intelligence: number;
  dexterity: number;
  criticalChance: number; // percent, e.g. 5 = 5%
}

// Which stat empowers a class's spell damage/healing — read by rollMagnitude
// and applied on level-up by grantExperience.
export const PRIMARY_STAT_BY_CLASS: Record<string, "strength" | "intelligence" | "dexterity" | undefined> = {
  Warrior: "strength",
  Rogue: "dexterity",
  Mage: "intelligence",
  Priest: "intelligence",
};

// Starting armor/STR/INT/DEX for a newly created character of each class —
// used by POST /api/characters and mirrored by the migration's backfill for
// characters that existed before these stats did.
export const BASE_CLASS_STATS: Record<string, Pick<CombatStats, "armor" | "strength" | "intelligence" | "dexterity">> = {
  Warrior: { armor: 8, strength: 10, intelligence: 0, dexterity: 0 },
  Rogue: { armor: 3, strength: 0, intelligence: 0, dexterity: 12 },
  Mage: { armor: 2, strength: 0, intelligence: 12, dexterity: 0 },
  Priest: { armor: 4, strength: 0, intelligence: 10, dexterity: 0 },
};
export const DEFAULT_CRITICAL_CHANCE = 5;

export const STAT_DAMAGE_SCALING = 0.5; // bonus damage/heal per point of the relevant primary stat
export const CRIT_MULTIPLIER = 2;
// mitigation% = armor / (armor + this) — diminishing returns, never reaches 100%.
export const ARMOR_MITIGATION_CONSTANT = 50;
export const HP_PER_LEVEL = 10;
export const STAT_PER_LEVEL = 2;
export const ARMOR_PER_LEVEL = 1;

export function xpToNextLevel(level: number): number {
  return 100 * level;
}

export function primaryStatValue(
  className: string,
  stats: Pick<CombatStats, "strength" | "intelligence" | "dexterity">,
): number {
  const key = PRIMARY_STAT_BY_CLASS[className];
  return key ? stats[key] : 0;
}

// Used for both spell damage and heal magnitude — a caster's primary stat
// and crit chance boost whatever they're casting.
export function rollMagnitude(
  base: number,
  className: string,
  stats: CombatStats,
): { amount: number; isCrit: boolean } {
  const bonus = primaryStatValue(className, stats) * STAT_DAMAGE_SCALING;
  const isCrit = Math.random() * 100 < stats.criticalChance;
  const amount = (base + bonus) * (isCrit ? CRIT_MULTIPLIER : 1);
  return { amount, isCrit };
}

export function applyArmor(amount: number, armor: number): number {
  const mitigation = armor / (armor + ARMOR_MITIGATION_CONSTANT);
  return amount * (1 - mitigation);
}

// Applies gained XP, handling multiple level-ups in one grant (e.g. a big
// AoE kill). Returns the updated stat block, total maxHp gained, and whether
// any level-up occurred — callers use `leveledUp` to decide whether an
// immediate DB write is warranted, rather than persisting on every XP tick.
export function grantExperience(
  className: string,
  stats: CombatStats,
  xpGained: number,
): { stats: CombatStats; hpGained: number; leveledUp: boolean } {
  let { level, experience, armor, strength, intelligence, dexterity } = stats;
  experience += xpGained;
  let hpGained = 0;
  let leveledUp = false;

  let needed = xpToNextLevel(level);
  while (experience >= needed) {
    experience -= needed;
    level += 1;
    armor += ARMOR_PER_LEVEL;
    hpGained += HP_PER_LEVEL;
    const key = PRIMARY_STAT_BY_CLASS[className];
    if (key === "strength") strength += STAT_PER_LEVEL;
    else if (key === "intelligence") intelligence += STAT_PER_LEVEL;
    else if (key === "dexterity") dexterity += STAT_PER_LEVEL;
    leveledUp = true;
    needed = xpToNextLevel(level);
  }

  return {
    stats: { level, experience, armor, strength, intelligence, dexterity, criticalChance: stats.criticalChance },
    hpGained,
    leveledUp,
  };
}
