import { Router } from "express";
import { prisma } from "../db.js";
import { asyncRoute } from "./errors.js";
import { requireAdmin } from "./adminAuth.js";
import type { NpcTemplateInput } from "shared";

export const npcsRouter = Router();

npcsRouter.get(
  "/",
  asyncRoute(async (_req, res) => {
    const npcs = await prisma.npcTemplate.findMany({ orderBy: { name: "asc" } });
    res.json(npcs);
  }),
);

npcsRouter.get(
  "/:id",
  asyncRoute(async (req, res) => {
    const npc = await prisma.npcTemplate.findUnique({ where: { id: req.params.id as string } });
    if (!npc) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    res.json(npc);
  }),
);

npcsRouter.post(
  "/",
  requireAdmin,
  asyncRoute(async (req, res) => {
    const data = req.body as NpcTemplateInput;
    const npc = await prisma.npcTemplate.create({ data });
    res.status(201).json(npc);
  }),
);

npcsRouter.put(
  "/:id",
  requireAdmin,
  asyncRoute(async (req, res) => {
    const data = req.body as NpcTemplateInput;
    const npc = await prisma.npcTemplate.update({ where: { id: req.params.id as string }, data });
    res.json(npc);
  }),
);

npcsRouter.delete(
  "/:id",
  requireAdmin,
  asyncRoute(async (req, res) => {
    await prisma.npcTemplate.delete({ where: { id: req.params.id as string } });
    res.status(204).end();
  }),
);
