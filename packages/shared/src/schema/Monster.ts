import { Schema, type } from "@colyseus/schema";

export class Monster extends Schema {
  @type("string") id: string = "";
  @type("string") name: string = "";
  @type("number") x: number = 0;
  @type("number") y: number = 0;
  @type("number") hp: number = 0;
  @type("number") maxHp: number = 0;
  @type("boolean") slowed: boolean = false;
  @type("number") level: number = 1;
  // Synced so the client can draw an attack-range indicator around the
  // player's current target — under iso projection, screen distance isn't
  // proportional to real distance, so eyeballing "am I in range" from raw
  // pixel closeness is unreliable without a visual boundary.
  @type("number") attackRange: number = 0;
}
