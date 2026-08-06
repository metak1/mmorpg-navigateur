import { Client, getStateCallbacks, type Room } from "colyseus.js";
import { RoomState, WORLD_ROOM } from "shared";

const SERVER_URL = import.meta.env.VITE_SERVER_URL ?? "ws://localhost:2567";

export async function connectToWorld(playerName: string) {
  const client = new Client(SERVER_URL);
  const room: Room<RoomState> = await client.joinOrCreate(WORLD_ROOM, { name: playerName });
  const $ = getStateCallbacks(room);
  return { room, $ };
}
