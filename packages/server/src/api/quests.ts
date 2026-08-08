import { Router } from "express";
import { prisma } from "../db.js";
import { asyncRoute } from "./errors.js";
import { requireAdmin } from "./adminAuth.js";
import { notifyContentChanged } from "../contentEvents.js";
import type { QuestDTO, QuestInput, QuestObjectiveType } from "shared";
import type { Quest, QuestRewardItem } from "@prisma/client";

export const questsRouter = Router();

function toDTO(quest: Quest & { rewardItems: QuestRewardItem[] }): QuestDTO {
  return {
    id: quest.id,
    title: quest.title,
    description: quest.description,
    giverNpcId: quest.giverNpcId,
    objectiveType: quest.objectiveType as QuestObjectiveType,
    targetNpcId: quest.targetNpcId,
    monsterTemplateId: quest.monsterTemplateId,
    itemId: quest.itemId,
    requiredCount: quest.requiredCount,
    rewardXp: quest.rewardXp,
    rewardItems: quest.rewardItems.map((r) => ({ id: r.id, itemId: r.itemId, quantity: r.quantity })),
  };
}

// Only the fields relevant to the quest's objectiveType are ever meaningful;
// the others are nulled out here rather than trusted from the request body,
// so switching a quest's objective type in the admin UI can't leave stale
// targetNpcId/monsterTemplateId/itemId values behind from its previous type.
function toData(body: QuestInput) {
  return {
    title: body.title,
    description: body.description,
    giverNpcId: body.giverNpcId,
    objectiveType: body.objectiveType,
    targetNpcId: body.objectiveType === "talkToNpc" ? body.targetNpcId : null,
    monsterTemplateId: body.objectiveType === "killMonsters" ? body.monsterTemplateId : null,
    itemId: body.objectiveType === "bringItems" ? body.itemId : null,
    requiredCount: body.objectiveType === "talkToNpc" ? 1 : body.requiredCount,
    rewardXp: body.rewardXp,
  };
}

questsRouter.get(
  "/",
  asyncRoute(async (_req, res) => {
    const quests = await prisma.quest.findMany({ include: { rewardItems: true }, orderBy: { title: "asc" } });
    res.json(quests.map(toDTO));
  }),
);

questsRouter.get(
  "/:id",
  asyncRoute(async (req, res) => {
    const quest = await prisma.quest.findUnique({
      where: { id: req.params.id as string },
      include: { rewardItems: true },
    });
    if (!quest) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    res.json(toDTO(quest));
  }),
);

questsRouter.post(
  "/",
  requireAdmin,
  asyncRoute(async (req, res) => {
    const body = req.body as QuestInput;
    const quest = await prisma.quest.create({
      data: {
        ...toData(body),
        rewardItems: { create: body.rewardItems.map((r) => ({ itemId: r.itemId, quantity: r.quantity })) },
      },
      include: { rewardItems: true },
    });
    notifyContentChanged("quests");
    res.status(201).json(toDTO(quest));
  }),
);

questsRouter.put(
  "/:id",
  requireAdmin,
  asyncRoute(async (req, res) => {
    const body = req.body as QuestInput;
    const id = req.params.id as string;

    const quest = await prisma.$transaction(async (tx) => {
      await tx.questRewardItem.deleteMany({ where: { questId: id } });
      return tx.quest.update({
        where: { id },
        data: {
          ...toData(body),
          rewardItems: { create: body.rewardItems.map((r) => ({ itemId: r.itemId, quantity: r.quantity })) },
        },
        include: { rewardItems: true },
      });
    });

    notifyContentChanged("quests");
    res.json(toDTO(quest));
  }),
);

questsRouter.delete(
  "/:id",
  requireAdmin,
  asyncRoute(async (req, res) => {
    await prisma.quest.delete({ where: { id: req.params.id as string } });
    notifyContentChanged("quests");
    res.status(204).end();
  }),
);
