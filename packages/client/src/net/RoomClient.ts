import { Client, getStateCallbacks, type Room } from "colyseus.js";
import { RoomState, WORLD_ROOM, type JoinOptions } from "shared";

const SERVER_URL = import.meta.env.VITE_SERVER_URL ?? "ws://localhost:2567";

export async function connectToWorld(token: string, characterId: string) {
  const client = new Client(SERVER_URL);
  const options: JoinOptions = { token, characterId };
  const room: Room<RoomState> = await client.joinOrCreate(WORLD_ROOM, options);
  const $ = getStateCallbacks(room);
  return { room, $ };
}

// The dungeon-entry counterpart to connectToWorld — joins a specific,
// already-created room instance by id (see PortalGrantedMessage) instead of
// ordinary joinOrCreate matchmaking, which is how the whole party ends up
// in the same instance rather than each member creating their own.
export async function joinRoomById(roomId: string, token: string, characterId: string) {
  const client = new Client(SERVER_URL);
  const options: JoinOptions = { token, characterId };
  const room: Room<RoomState> = await client.joinById(roomId, options);
  const $ = getStateCallbacks(room);
  return { room, $ };
}
