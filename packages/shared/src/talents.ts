// The one rule that decides whether a point can be spent on a talent right
// now — evaluated identically server-side (as the actual gate on
// learnTalent) and client-side (to grey out talents the sidebar shouldn't
// let a player click), so the two can never disagree about what's
// learnable.
export interface TalentDefLite {
  id: string;
  maxRank: number;
  prerequisiteId: string | null;
}

export function canLearnTalent(talent: TalentDefLite, learnedRanks: Map<string, number>, availablePoints: number): boolean {
  if (availablePoints < 1) return false;
  if ((learnedRanks.get(talent.id) ?? 0) >= talent.maxRank) return false;
  if (talent.prerequisiteId && (learnedRanks.get(talent.prerequisiteId) ?? 0) < 1) return false;
  return true;
}
