import { Router } from "express";
import { prisma } from "../db.js";
import { asyncRoute } from "./errors.js";
import { requireAdmin } from "./adminAuth.js";
import { notifyContentChanged } from "../contentEvents.js";
import { TileType } from "shared";
import type {
  GameMapDTO,
  GameMapInput,
  DungeonObjectiveKind,
  ActiveMapResponse,
  MapTileDTO,
  MapTilesUpdateInput,
  PropType,
} from "shared";
import type { GameMap, MonsterSpawn, NpcSpawn, MapAmbientSpawn, MapPortal, DungeonObjective } from "@prisma/client";

export const mapsRouter = Router();

// Each ranged tile fetch (used both by the play client's ChunkTileCache and
// the admin editor's viewport) is capped at this many cells so an
// oversized/malformed range can't turn into an unbounded query — comfortably
// above what either caller actually needs at once (client chunk loads are
// 16x16=256 cells; the admin viewport tops out well under this too).
const MAX_TILE_RANGE_CELLS = 128 * 128;

function toDTO(
  map: GameMap & {
    spawns: MonsterSpawn[];
    npcSpawns: NpcSpawn[];
    ambientSpawns: MapAmbientSpawn[];
    portals: MapPortal[];
    dungeonObjectives: DungeonObjective[];
  },
): GameMapDTO {
  return {
    id: map.id,
    name: map.name,
    tileSize: map.tileSize,
    spawnX: map.spawnX,
    spawnY: map.spawnY,
    isActive: map.isActive,
    ambientSpawnChance: map.ambientSpawnChance,
    cliffColor: map.cliffColor,
    isDungeon: map.isDungeon,
    minLevel: map.minLevel,
    description: map.description,
    spawns: map.spawns.map((s) => ({
      id: s.id,
      mapId: s.mapId,
      monsterTemplateId: s.monsterTemplateId,
      x: s.x,
      y: s.y,
      isBoss: s.isBoss,
    })),
    npcSpawns: map.npcSpawns.map((s) => ({
      id: s.id,
      mapId: s.mapId,
      npcTemplateId: s.npcTemplateId,
      x: s.x,
      y: s.y,
    })),
    ambientSpawns: map.ambientSpawns.map((a) => ({
      id: a.id,
      monsterTemplateId: a.monsterTemplateId,
      weight: a.weight,
    })),
    portals: map.portals.map((p) => ({
      id: p.id,
      x: p.x,
      y: p.y,
      targetMapId: p.targetMapId,
    })),
    dungeonObjectives: map.dungeonObjectives
      .slice()
      .sort((a, b) => a.order - b.order)
      .map((o) => ({
        id: o.id,
        order: o.order,
        description: o.description,
        kind: o.kind as DungeonObjectiveKind,
        monsterTemplateId: o.monsterTemplateId,
        requiredCount: o.requiredCount,
      })),
  };
}

const MAP_INCLUDE = {
  spawns: true,
  npcSpawns: true,
  ambientSpawns: true,
  portals: true,
  dungeonObjectives: true,
} as const;

mapsRouter.get(
  "/",
  asyncRoute(async (_req, res) => {
    const maps = await prisma.gameMap.findMany({ include: MAP_INCLUDE, orderBy: { name: "asc" } });
    res.json(maps.map(toDTO));
  }),
);

// Public, read-only: the game server/client's source of truth for "what map
// is currently live." The world is infinite, so terrain itself isn't in
// this response — just enough metadata (mapId/tileSize/spawn point) to
// bootstrap a ChunkTileCache that fetches tiles on demand.
mapsRouter.get(
  "/active",
  asyncRoute(async (_req, res) => {
    const map = await prisma.gameMap.findFirst({ where: { isActive: true } });
    if (!map) {
      res.status(404).json({ error: "No active map" });
      return;
    }
    const response: ActiveMapResponse = {
      mapId: map.id,
      tileSize: map.tileSize,
      spawnX: map.spawnX,
      spawnY: map.spawnY,
      cliffColor: map.cliffColor,
    };
    res.json(response);
  }),
);

// Public: returns every explicitly-painted tile within a rectangular
// tile-space range (inclusive). Gaps are the caller's responsibility to
// default-fill as Grass — see ChunkTileCache in shared/src/chunkCache.ts,
// the one client of this endpoint (both the play client and the admin
// editor use it).
mapsRouter.get(
  "/:id/tiles",
  asyncRoute(async (req, res) => {
    const mapId = req.params.id as string;
    const minCol = Number(req.query.minCol);
    const minRow = Number(req.query.minRow);
    const maxCol = Number(req.query.maxCol);
    const maxRow = Number(req.query.maxRow);
    if (![minCol, minRow, maxCol, maxRow].every(Number.isFinite) || maxCol < minCol || maxRow < minRow) {
      res.status(400).json({ error: "Invalid range" });
      return;
    }
    const cellCount = (maxCol - minCol + 1) * (maxRow - minRow + 1);
    if (cellCount > MAX_TILE_RANGE_CELLS) {
      res.status(400).json({ error: `Range too large (max ${MAX_TILE_RANGE_CELLS} cells)` });
      return;
    }

    const tiles = await prisma.mapTile.findMany({
      where: { mapId, col: { gte: minCol, lte: maxCol }, row: { gte: minRow, lte: maxRow } },
    });
    res.json(
      tiles.map(
        (t): MapTileDTO => ({
          col: t.col,
          row: t.row,
          tileType: t.tileType,
          elevation: t.elevation,
          blocksMovement: t.blocksMovement,
          propType: t.propType as PropType | null,
        }),
      ),
    );
  }),
);

// Admin-only: paints (or, for entries back at the full default — Grass at
// elevation 0 with no barrier and no prop — resets to default, deleting the
// row) a batch of tiles. Batched so an editor Save flushes all dirty cells
// in one request rather than one write per paint stroke.
mapsRouter.put(
  "/:id/tiles",
  requireAdmin,
  asyncRoute(async (req, res) => {
    const mapId = req.params.id as string;
    const body = req.body as MapTilesUpdateInput;

    await prisma.$transaction(
      body.tiles.map((tile) =>
        tile.tileType === TileType.Grass && tile.elevation === 0 && !tile.blocksMovement && !tile.propType
          ? prisma.mapTile.deleteMany({ where: { mapId, col: tile.col, row: tile.row } })
          : prisma.mapTile.upsert({
              where: { mapId_col_row: { mapId, col: tile.col, row: tile.row } },
              update: {
                tileType: tile.tileType,
                elevation: tile.elevation,
                blocksMovement: tile.blocksMovement,
                propType: tile.propType,
              },
              create: {
                mapId,
                col: tile.col,
                row: tile.row,
                tileType: tile.tileType,
                elevation: tile.elevation,
                blocksMovement: tile.blocksMovement,
                propType: tile.propType,
              },
            }),
      ),
    );

    notifyContentChanged("maps");
    res.status(204).end();
  }),
);

mapsRouter.get(
  "/:id",
  asyncRoute(async (req, res) => {
    const id = req.params.id as string;
    const map = await prisma.gameMap.findUnique({ where: { id }, include: MAP_INCLUDE });
    if (!map) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    res.json(toDTO(map));
  }),
);

mapsRouter.post(
  "/",
  requireAdmin,
  asyncRoute(async (req, res) => {
    const body = req.body as GameMapInput;
    const map = await prisma.gameMap.create({
      data: {
        name: body.name,
        tileSize: body.tileSize,
        spawnX: body.spawnX,
        spawnY: body.spawnY,
        ambientSpawnChance: body.ambientSpawnChance,
        cliffColor: body.cliffColor,
        isDungeon: body.isDungeon,
        minLevel: body.minLevel,
        description: body.description,
        spawns: { create: body.spawns },
        npcSpawns: { create: body.npcSpawns },
        ambientSpawns: { create: body.ambientSpawns },
        portals: { create: body.portals },
        dungeonObjectives: { create: body.dungeonObjectives },
      },
      include: MAP_INCLUDE,
    });
    notifyContentChanged("maps");
    res.status(201).json(toDTO(map));
  }),
);

mapsRouter.put(
  "/:id",
  requireAdmin,
  asyncRoute(async (req, res) => {
    const body = req.body as GameMapInput;
    const id = req.params.id as string;

    const map = await prisma.$transaction(async (tx) => {
      await tx.monsterSpawn.deleteMany({ where: { mapId: id } });
      await tx.npcSpawn.deleteMany({ where: { mapId: id } });
      await tx.mapAmbientSpawn.deleteMany({ where: { mapId: id } });
      await tx.mapPortal.deleteMany({ where: { mapId: id } });
      await tx.dungeonObjective.deleteMany({ where: { mapId: id } });
      return tx.gameMap.update({
        where: { id },
        data: {
          name: body.name,
          tileSize: body.tileSize,
          spawnX: body.spawnX,
          spawnY: body.spawnY,
          ambientSpawnChance: body.ambientSpawnChance,
          cliffColor: body.cliffColor,
          isDungeon: body.isDungeon,
          minLevel: body.minLevel,
          description: body.description,
          spawns: { create: body.spawns },
          npcSpawns: { create: body.npcSpawns },
          ambientSpawns: { create: body.ambientSpawns },
          portals: { create: body.portals },
          dungeonObjectives: { create: body.dungeonObjectives },
        },
        include: MAP_INCLUDE,
      });
    });

    notifyContentChanged("maps");
    res.json(toDTO(map));
  }),
);

mapsRouter.delete(
  "/:id",
  requireAdmin,
  asyncRoute(async (req, res) => {
    await prisma.gameMap.delete({ where: { id: req.params.id as string } });
    notifyContentChanged("maps");
    res.status(204).end();
  }),
);

mapsRouter.post(
  "/:id/activate",
  requireAdmin,
  asyncRoute(async (req, res) => {
    const id = req.params.id as string;
    await prisma.$transaction([
      prisma.gameMap.updateMany({ data: { isActive: false }, where: {} }),
      prisma.gameMap.update({ where: { id }, data: { isActive: true } }),
    ]);
    notifyContentChanged("maps");
    res.status(204).end();
  }),
);
