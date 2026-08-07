import { Router } from "express";
import { prisma } from "../db.js";
import { asyncRoute } from "./errors.js";
import { requireAdmin } from "./adminAuth.js";
import type { GameMapDTO, GameMapInput, ActiveMapResponse } from "shared";
import type { GameMap, MonsterSpawn } from "@prisma/client";

export const mapsRouter = Router();

function toDTO(map: GameMap & { spawns: MonsterSpawn[] }): GameMapDTO {
  return {
    id: map.id,
    name: map.name,
    width: map.width,
    height: map.height,
    tileSize: map.tileSize,
    tileData: JSON.parse(map.tileData) as number[][],
    spawnX: map.spawnX,
    spawnY: map.spawnY,
    isActive: map.isActive,
    spawns: map.spawns.map((s) => ({
      id: s.id,
      mapId: s.mapId,
      monsterTemplateId: s.monsterTemplateId,
      x: s.x,
      y: s.y,
    })),
  };
}

mapsRouter.get(
  "/",
  asyncRoute(async (_req, res) => {
    const maps = await prisma.gameMap.findMany({ include: { spawns: true }, orderBy: { name: "asc" } });
    res.json(maps.map(toDTO));
  }),
);

// Public, read-only: the game server/client's source of truth for "what map
// is currently live." Kept separate from the general list/detail routes
// below since this is the one endpoint the game client itself calls.
mapsRouter.get(
  "/active",
  asyncRoute(async (_req, res) => {
    const map = await prisma.gameMap.findFirst({ where: { isActive: true } });
    if (!map) {
      res.status(404).json({ error: "No active map" });
      return;
    }
    const response: ActiveMapResponse = {
      width: map.width,
      height: map.height,
      tileSize: map.tileSize,
      tileData: JSON.parse(map.tileData) as number[][],
      spawnX: map.spawnX,
      spawnY: map.spawnY,
    };
    res.json(response);
  }),
);

mapsRouter.get(
  "/:id",
  asyncRoute(async (req, res) => {
    const id = req.params.id as string;
    const map = await prisma.gameMap.findUnique({ where: { id }, include: { spawns: true } });
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
        width: body.width,
        height: body.height,
        tileSize: body.tileSize,
        tileData: JSON.stringify(body.tileData),
        spawnX: body.spawnX,
        spawnY: body.spawnY,
        spawns: { create: body.spawns },
      },
      include: { spawns: true },
    });
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
      return tx.gameMap.update({
        where: { id },
        data: {
          name: body.name,
          width: body.width,
          height: body.height,
          tileSize: body.tileSize,
          tileData: JSON.stringify(body.tileData),
          spawnX: body.spawnX,
          spawnY: body.spawnY,
          spawns: { create: body.spawns },
        },
        include: { spawns: true },
      });
    });

    res.json(toDTO(map));
  }),
);

mapsRouter.delete(
  "/:id",
  requireAdmin,
  asyncRoute(async (req, res) => {
    await prisma.gameMap.delete({ where: { id: req.params.id as string } });
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
    res.status(204).end();
  }),
);
