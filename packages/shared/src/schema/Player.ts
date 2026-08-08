import { ArraySchema, Schema, type } from "@colyseus/schema";
import { QuestProgress } from "./QuestProgress.js";

export class Player extends Schema {
  @type("string") sessionId: string = "";
  @type("string") name: string = "";
  @type("number") x: number = 0;
  @type("number") y: number = 0;
  @type("string") direction: "up" | "down" | "left" | "right" = "down";
  @type("number") hp: number = 0;
  @type("number") maxHp: number = 0;
  @type("string") classId: string = "";
  @type("string") className: string = "";
  @type("number") level: number = 1;
  @type("number") experience: number = 0;
  @type("number") xpToNextLevel: number = 100;
  @type([QuestProgress]) quests = new ArraySchema<QuestProgress>();
}
