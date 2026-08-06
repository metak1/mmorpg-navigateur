import { Router } from "express";
import { prisma } from "../db.js";
import { asyncRoute } from "./errors.js";
import type { SpellTemplateInput } from "shared";

export const spellsRouter = Router();

spellsRouter.get(
  "/",
  asyncRoute(async (_req, res) => {
    const spells = await prisma.spellTemplate.findMany({ orderBy: { keybind: "asc" } });
    res.json(spells);
  }),
);

spellsRouter.get(
  "/:id",
  asyncRoute(async (req, res) => {
    const spell = await prisma.spellTemplate.findUnique({ where: { id: req.params.id as string } });
    if (!spell) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    res.json(spell);
  }),
);

spellsRouter.post(
  "/",
  asyncRoute(async (req, res) => {
    const data = req.body as SpellTemplateInput;
    const spell = await prisma.spellTemplate.create({ data });
    res.status(201).json(spell);
  }),
);

spellsRouter.put(
  "/:id",
  asyncRoute(async (req, res) => {
    const data = req.body as SpellTemplateInput;
    const spell = await prisma.spellTemplate.update({ where: { id: req.params.id as string }, data });
    res.json(spell);
  }),
);

spellsRouter.delete(
  "/:id",
  asyncRoute(async (req, res) => {
    await prisma.spellTemplate.delete({ where: { id: req.params.id as string } });
    res.status(204).end();
  }),
);
