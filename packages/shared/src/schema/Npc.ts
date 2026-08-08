import { Schema, type } from "@colyseus/schema";

export class Npc extends Schema {
  @type("string") id: string = "";
  @type("string") name: string = "";
  @type("number") x: number = 0;
  @type("number") y: number = 0;
  @type("number") color: number = 0xffffff;
}
