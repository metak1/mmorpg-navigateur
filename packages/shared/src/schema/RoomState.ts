import { ArraySchema, MapSchema, Schema, type } from "@colyseus/schema";
import { Player } from "./Player.js";
import { Monster } from "./Monster.js";
import { Projectile } from "./Projectile.js";
import { Npc } from "./Npc.js";
import { Portal } from "./Portal.js";
import { DungeonObjectiveState } from "./DungeonObjectiveState.js";

export class RoomState extends Schema {
  @type({ map: Player }) players = new MapSchema<Player>();
  @type({ map: Monster }) monsters = new MapSchema<Monster>();
  @type({ map: Projectile }) projectiles = new MapSchema<Projectile>();
  @type({ map: Npc }) npcs = new MapSchema<Npc>();
  @type({ map: Portal }) portals = new MapSchema<Portal>();
  // Empty for the plain overworld room, and for a dungeon instance whose
  // map has no DungeonObjective rows authored (see WorldRoom.onCreate) —
  // the client's checklist UI simply doesn't render anything in either case.
  @type([DungeonObjectiveState]) dungeonObjectives = new ArraySchema<DungeonObjectiveState>();
}
