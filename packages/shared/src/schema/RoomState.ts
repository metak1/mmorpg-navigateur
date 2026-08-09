import { MapSchema, Schema, type } from "@colyseus/schema";
import { Player } from "./Player.js";
import { Monster } from "./Monster.js";
import { Projectile } from "./Projectile.js";
import { Npc } from "./Npc.js";
import { Portal } from "./Portal.js";

export class RoomState extends Schema {
  @type({ map: Player }) players = new MapSchema<Player>();
  @type({ map: Monster }) monsters = new MapSchema<Monster>();
  @type({ map: Projectile }) projectiles = new MapSchema<Projectile>();
  @type({ map: Npc }) npcs = new MapSchema<Npc>();
  @type({ map: Portal }) portals = new MapSchema<Portal>();
}
