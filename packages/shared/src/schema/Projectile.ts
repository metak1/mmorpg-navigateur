import { Schema, type } from "@colyseus/schema";

export class Projectile extends Schema {
  @type("string") id: string = "";
  @type("number") x: number = 0;
  @type("number") y: number = 0;
  @type("number") spellId: number = 0;
  // Needed to disambiguate which SpellDef a numeric spellId refers to, since
  // keybinds are only unique within a class (see SpellTemplate's
  // @@unique([classId, keybind])) — two different classes' spells can share
  // the same spellId.
  @type("string") classId: string = "";
  // Lets the client spawn the projectile's sprite at the caster's currently
  // *rendered* position (see WorldScene's projectiles.onAdd) instead of this
  // schema's own x/y — which reflect the caster's server-authoritative
  // position at cast time, not wherever their locally-predicted (or
  // remote-smoothed) sprite has since moved to. Without this, the
  // projectile visibly spawns off the caster's body whenever that position
  // has drifted, e.g. under normal network latency.
  @type("string") casterSessionId: string = "";
}
