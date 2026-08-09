import { Schema, type } from "@colyseus/schema";

// One live-tracked entry from a dungeon's checklist (see the Prisma
// DungeonObjective model for how it's authored). Synced room-wide, not
// per-player, since a dungeon instance's objectives are shared by the whole
// party — kind/monsterTemplateId aren't included, only what the client
// needs to render a checklist; the server keeps the rest privately (see
// WorldRoom's dungeonObjectiveMeta) since how completion is computed
// doesn't need to reach the client at all.
export class DungeonObjectiveState extends Schema {
  @type("string") id: string = "";
  @type("string") description: string = "";
  @type("number") progress: number = 0;
  @type("number") requiredCount: number = 1;
  @type("boolean") completed: boolean = false;
}
