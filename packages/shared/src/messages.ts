export const WORLD_ROOM = "world";
export const MOVE_SPEED = 200; // px/sec

export interface MoveInputMessage {
  dx: number;
  dy: number;
  direction: "up" | "down" | "left" | "right";
}
