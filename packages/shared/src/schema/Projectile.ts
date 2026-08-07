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
}
