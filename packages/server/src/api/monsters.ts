import { Router } from "express";
import { prisma } from "../db.js";
import { asyncRoute } from "./errors.js";
import type { MonsterTemplateInput } from "shared";

export const monstersRouter = Router();

monstersRouter.get(
  "/",
  asyncRoute(async (_req, res) => {
    const monsters = await prisma.monsterTemplate.findMany({ orderBy: { name: "asc" } });
    res.json(monsters);
  }),
);

monstersRouter.get(
  "/:id",
  asyncRoute(async (req, res) => {
    const monster = await prisma.monsterTemplate.findUnique({ where: { id: req.params.id as string } });
    if (!monster) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    res.json(monster);
  }),
);

monstersRouter.post(
  "/",
  asyncRoute(async (req, res) => {
    const data = req.body as MonsterTemplateInput;
    const monster = await prisma.monsterTemplate.create({ data });
    res.status(201).json(monster);
  }),
);

monstersRouter.put(
  "/:id",
  asyncRoute(async (req, res) => {
    const data = req.body as MonsterTemplateInput;
    const monster = await prisma.monsterTemplate.update({ where: { id: req.params.id as string }, data });
    res.json(monster);
  }),
);

monstersRouter.delete(
  "/:id",
  asyncRoute(async (req, res) => {
    await prisma.monsterTemplate.delete({ where: { id: req.params.id as string } });
    res.status(204).end();
  }),
);
