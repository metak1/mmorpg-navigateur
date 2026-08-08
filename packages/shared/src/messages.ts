import type { SpellId } from "./spells.js";

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
