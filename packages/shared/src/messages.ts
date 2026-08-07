import type { SpellId } from "./spells.js";

export const WORLD_ROOM = "world";
export const MOVE_SPEED = 200; // px/sec

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
