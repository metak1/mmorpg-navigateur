import { Router } from "express";
import { prisma } from "../db.js";
import { asyncRoute } from "./errors.js";
import { requireAdmin } from "./adminAuth.js";
import type { ItemTemplateInput } from "shared";

export const itemsRouter = Router();

itemsRouter.get(
  "/",
  asyncRoute(async (_req, res) => {
    const items = await prisma.itemTemplate.findMany({ orderBy: { name: "asc" } });
    res.json(items);
  }),
);

itemsRouter.get(
  "/:id",
  asyncRoute(async (req, res) => {
    const item = await prisma.itemTemplate.findUnique({ where: { id: req.params.id as string } });
    if (!item) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    res.json(item);
  }),
);

itemsRouter.post(
  "/",
  requireAdmin,
  asyncRoute(async (req, res) => {
    const data = req.body as ItemTemplateInput;
    const item = await prisma.itemTemplate.create({ data });
    res.status(201).json(item);
  }),
);

itemsRouter.put(
  "/:id",
  requireAdmin,
  asyncRoute(async (req, res) => {
    const data = req.body as ItemTemplateInput;
    const item = await prisma.itemTemplate.update({ where: { id: req.params.id as string }, data });
    res.json(item);
  }),
);

itemsRouter.delete(
  "/:id",
  requireAdmin,
  asyncRoute(async (req, res) => {
    await prisma.itemTemplate.delete({ where: { id: req.params.id as string } });
    res.status(204).end();
  }),
);
