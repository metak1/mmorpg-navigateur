import { Schema, type } from "@colyseus/schema";

export class Player extends Schema {
  @type("string") sessionId: string = "";
  @type("string") name: string = "";
  @type("number") x: number = 0;
  @type("number") y: number = 0;
  @type("string") direction: "up" | "down" | "left" | "right" = "down";
  @type("number") hp: number = 0;
  @type("number") maxHp: number = 0;
}
