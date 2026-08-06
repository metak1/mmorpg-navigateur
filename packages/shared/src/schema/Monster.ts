import { Schema, type } from "@colyseus/schema";

export class Monster extends Schema {
  @type("string") id: string = "";
  @type("number") x: number = 0;
  @type("number") y: number = 0;
  @type("number") hp: number = 0;
  @type("number") maxHp: number = 0;
  @type("boolean") slowed: boolean = false;
}
