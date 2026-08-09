import { TileType } from "./map.js";

// Flat placeholder colors for each tile type — used by both the game
// client (Phaser wants numeric 0xrrggbb, see WorldScene's chunk rendering)
// and the admin map editor (derives a "#rrggbb" CSS string from the same
// numbers), so the editor's preview and the actual game always agree.
export const TILE_COLORS: Record<number, number> = {
  [TileType.Grass]: 0x4c9942,
  [TileType.Path]: 0xc19a6b,
  [TileType.Water]: 0x4084d6,
  [TileType.Wall]: 0x606068,
};
