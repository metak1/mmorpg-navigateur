import { Router } from "express";
import { prisma } from "../db.js";
import { asyncRoute } from "./errors.js";
import { requireAdmin } from "./adminAuth.js";
import type { ClassTemplateInput } from "shared";

export const classesRouter = Router();

classesRouter.get(
  "/",
  asyncRoute(async (_req, res) => {
    const classes = await prisma.classTemplate.findMany({ orderBy: { name: "asc" } });
    res.json(classes);
  }),
);

classesRouter.get(
  "/:id",
  asyncRoute(async (req, res) => {
    const cls = await prisma.classTemplate.findUnique({ where: { id: req.params.id as string } });
    if (!cls) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    res.json(cls);
  }),
);

classesRouter.post(
  "/",
  requireAdmin,
  asyncRoute(async (req, res) => {
    const data = req.body as ClassTemplateInput;
    const cls = await prisma.classTemplate.create({ data });
    res.status(201).json(cls);
  }),
);

classesRouter.put(
  "/:id",
  requireAdmin,
  asyncRoute(async (req, res) => {
    const data = req.body as ClassTemplateInput;
    const cls = await prisma.classTemplate.update({ where: { id: req.params.id as string }, data });
    res.json(cls);
  }),
);

classesRouter.delete(
  "/:id",
  requireAdmin,
  asyncRoute(async (req, res) => {
    await prisma.classTemplate.delete({ where: { id: req.params.id as string } });
    res.status(204).end();
  }),
);
