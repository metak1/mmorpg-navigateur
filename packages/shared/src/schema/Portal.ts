import { Schema, type } from "@colyseus/schema";

// A clickable portal placed on a map, leading to another map (see
// MapPortal in the Prisma schema). The target map isn't synced to clients —
// it's only needed server-side to resolve where UsePortalMessage should
// send the player, kept in WorldRoom's portalRuntime instead.
export class Portal extends Schema {
  @type("string") id: string = "";
  @type("number") x: number = 0;
  @type("number") y: number = 0;
}
