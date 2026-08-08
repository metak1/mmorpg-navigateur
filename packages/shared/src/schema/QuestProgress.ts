import { Schema, type } from "@colyseus/schema";

// One entry per quest the character has accepted and not yet turned in —
// synced on Player so the client's quest log updates live (e.g. kill
// progress ticking up) with no extra request/response messaging.
export class QuestProgress extends Schema {
  @type("string") questId: string = "";
  @type("string") title: string = "";
  @type("string") objectiveSummary: string = "";
  @type("number") progress: number = 0;
  @type("number") requiredCount: number = 1;
  @type("boolean") ready: boolean = false;
}
