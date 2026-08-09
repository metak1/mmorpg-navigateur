import { Router } from "express";
import { prisma } from "../db.js";
import { asyncRoute } from "./errors.js";
import { requireAdmin } from "./adminAuth.js";
import { notifyContentChanged } from "../contentEvents.js";
import type { TalentTemplateDTO, TalentTemplateInput } from "shared";
import type { TalentTemplate, TalentEffect } from "@prisma/client";

export const talentsRouter = Router();

function toDTO(talent: TalentTemplate & { effects: TalentEffect[] }): TalentTemplateDTO {
  return {
    id: talent.id,
    classId: talent.classId,
    name: talent.name,
    description: talent.description,
    tier: talent.tier,
    maxRank: talent.maxRank,
    prerequisiteId: talent.prerequisiteId,
    effects: talent.effects.map((e) => ({
      id: e.id,
      effectType: e.effectType as TalentTemplateDTO["effects"][number]["effectType"],
      statKey: e.statKey as TalentTemplateDTO["effects"][number]["statKey"],
      spellTemplateId: e.spellTemplateId,
      spellParam: e.spellParam as TalentTemplateDTO["effects"][number]["spellParam"],
      bonusMode: e.bonusMode as TalentTemplateDTO["effects"][number]["bonusMode"],
      valuePerRank: e.valuePerRank,
      flagName: e.flagName as TalentTemplateDTO["effects"][number]["flagName"],
    })),
  };
}

function toData(body: TalentTemplateInput) {
  return {
    classId: body.classId,
    name: body.name,
    description: body.description,
    tier: body.tier,
    maxRank: body.maxRank,
    prerequisiteId: body.prerequisiteId,
  };
}

function effectsCreateInput(effects: TalentTemplateInput["effects"]) {
  return effects.map((e) => ({
    effectType: e.effectType,
    statKey: e.statKey,
    spellTemplateId: e.spellTemplateId,
    spellParam: e.spellParam,
    bonusMode: e.bonusMode,
    valuePerRank: e.valuePerRank,
    flagName: e.flagName,
  }));
}

// A talent's prerequisite must belong to the same class (a cross-class
// prerequisite could never be satisfied) and can't point at itself.
// Deeper cycles (A -> B -> A) aren't checked — same admin-discipline
// tolerance this codebase already accepts elsewhere (e.g. GameMap has no
// server-side terrain-consistency validation either).
async function validatePrerequisite(body: TalentTemplateInput, selfId: string | null): Promise<string | null> {
  if (!body.prerequisiteId) return null;
  if (body.prerequisiteId === selfId) return "A talent can't be its own prerequisite.";
  const prereq = await prisma.talentTemplate.findUnique({ where: { id: body.prerequisiteId } });
  if (!prereq) return "Prerequisite talent not found.";
  if (prereq.classId !== body.classId) return "Prerequisite must belong to the same class.";
  return null;
}

talentsRouter.get(
  "/",
  asyncRoute(async (_req, res) => {
    const talents = await prisma.talentTemplate.findMany({
      include: { effects: true },
      orderBy: [{ classId: "asc" }, { tier: "asc" }],
    });
    res.json(talents.map(toDTO));
  }),
);

talentsRouter.get(
  "/:id",
  asyncRoute(async (req, res) => {
    const talent = await prisma.talentTemplate.findUnique({
      where: { id: req.params.id as string },
      include: { effects: true },
    });
    if (!talent) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    res.json(toDTO(talent));
  }),
);

talentsRouter.post(
  "/",
  requireAdmin,
  asyncRoute(async (req, res) => {
    const body = req.body as TalentTemplateInput;
    const prereqError = await validatePrerequisite(body, null);
    if (prereqError) {
      res.status(400).json({ error: prereqError });
      return;
    }
    const talent = await prisma.talentTemplate.create({
      data: { ...toData(body), effects: { create: effectsCreateInput(body.effects) } },
      include: { effects: true },
    });
    notifyContentChanged("talents");
    res.status(201).json(toDTO(talent));
  }),
);

talentsRouter.put(
  "/:id",
  requireAdmin,
  asyncRoute(async (req, res) => {
    const body = req.body as TalentTemplateInput;
    const id = req.params.id as string;

    const prereqError = await validatePrerequisite(body, id);
    if (prereqError) {
      res.status(400).json({ error: prereqError });
      return;
    }

    const talent = await prisma.$transaction(async (tx) => {
      await tx.talentEffect.deleteMany({ where: { talentTemplateId: id } });
      return tx.talentTemplate.update({
        where: { id },
        data: { ...toData(body), effects: { create: effectsCreateInput(body.effects) } },
        include: { effects: true },
      });
    });

    notifyContentChanged("talents");
    res.json(toDTO(talent));
  }),
);

talentsRouter.delete(
  "/:id",
  requireAdmin,
  asyncRoute(async (req, res) => {
    await prisma.talentTemplate.delete({ where: { id: req.params.id as string } });
    notifyContentChanged("talents");
    res.status(204).end();
  }),
);
