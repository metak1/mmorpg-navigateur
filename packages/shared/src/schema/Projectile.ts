import { Schema, type } from "@colyseus/schema";

export class Projectile extends Schema {
  @type("string") id: string = "";
  @type("number") x: number = 0;
  @type("number") y: number = 0;
  @type("number") spellId: number = 0;
}
