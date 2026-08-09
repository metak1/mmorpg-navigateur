import { Router } from "express";
import { prisma } from "../db.js";
import { asyncRoute } from "./errors.js";
import { requireAdmin } from "./adminAuth.js";
import { notifyContentChanged } from "../contentEvents.js";
import type { MonsterTemplateDTO, MonsterTemplateInput } from "shared";
import type { MonsterTemplate, MonsterDrop } from "@prisma/client";

export const monstersRouter = Router();

function toDTO(monster: MonsterTemplate & { drops: MonsterDrop[] }): MonsterTemplateDTO {
  return {
    id: monster.id,
    name: monster.name,
    maxHp: monster.maxHp,
    wanderRadius: monster.wanderRadius,
    wanderIntervalMs: monster.wanderIntervalMs,
    wanderSpeed: monster.wanderSpeed,
    aggroRange: monster.aggroRange,
    chaseSpeed: monster.chaseSpeed,
    attackRange: monster.attackRange,
    touchDamage: monster.touchDamage,
    attackCooldownMs: monster.attackCooldownMs,
    level: monster.level,
    armor: monster.armor,
    xpReward: monster.xpReward,
    spellDamage: monster.spellDamage,
    spellRange: monster.spellRange,
    spellCastTimeMs: monster.spellCastTimeMs,
    spellCooldownMs: monster.spellCooldownMs,
    spellColor: monster.spellColor,
    drops: monster.drops.map((d) => ({
      id: d.id,
      itemId: d.itemId,
      dropChance: d.dropChance,
      minQuantity: d.minQuantity,
      maxQuantity: d.maxQuantity,
    })),
  };
}

function toData(body: MonsterTemplateInput) {
  return {
    name: body.name,
    maxHp: body.maxHp,
    wanderRadius: body.wanderRadius,
    wanderIntervalMs: body.wanderIntervalMs,
    wanderSpeed: body.wanderSpeed,
    aggroRange: body.aggroRange,
    chaseSpeed: body.chaseSpeed,
    attackRange: body.attackRange,
    touchDamage: body.touchDamage,
    attackCooldownMs: body.attackCooldownMs,
    level: body.level,
    armor: body.armor,
    xpReward: body.xpReward,
    spellDamage: body.spellDamage,
    spellRange: body.spellRange,
    spellCastTimeMs: body.spellCastTimeMs,
    spellCooldownMs: body.spellCooldownMs,
    spellColor: body.spellColor,
  };
}

monstersRouter.get(
  "/",
  asyncRoute(async (_req, res) => {
    const monsters = await prisma.monsterTemplate.findMany({ include: { drops: true }, orderBy: { name: "asc" } });
    res.json(monsters.map(toDTO));
  }),
);

monstersRouter.get(
  "/:id",
  asyncRoute(async (req, res) => {
    const monster = await prisma.monsterTemplate.findUnique({
      where: { id: req.params.id as string },
      include: { drops: true },
    });
    if (!monster) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    res.json(toDTO(monster));
  }),
);

monstersRouter.post(
  "/",
  requireAdmin,
  asyncRoute(async (req, res) => {
    const body = req.body as MonsterTemplateInput;
    const monster = await prisma.monsterTemplate.create({
      data: {
        ...toData(body),
        drops: {
          create: body.drops.map((d) => ({
            itemId: d.itemId,
            dropChance: d.dropChance,
            minQuantity: d.minQuantity,
            maxQuantity: d.maxQuantity,
          })),
        },
      },
      include: { drops: true },
    });
    notifyContentChanged("monsters");
    res.status(201).json(toDTO(monster));
  }),
);

monstersRouter.put(
  "/:id",
  requireAdmin,
  asyncRoute(async (req, res) => {
    const body = req.body as MonsterTemplateInput;
    const id = req.params.id as string;

    const monster = await prisma.$transaction(async (tx) => {
      await tx.monsterDrop.deleteMany({ where: { monsterTemplateId: id } });
      return tx.monsterTemplate.update({
        where: { id },
        data: {
          ...toData(body),
          drops: {
            create: body.drops.map((d) => ({
              itemId: d.itemId,
              dropChance: d.dropChance,
              minQuantity: d.minQuantity,
              maxQuantity: d.maxQuantity,
            })),
          },
        },
        include: { drops: true },
      });
    });

    notifyContentChanged("monsters");
    res.json(toDTO(monster));
  }),
);

monstersRouter.delete(
  "/:id",
  requireAdmin,
  asyncRoute(async (req, res) => {
    await prisma.monsterTemplate.delete({ where: { id: req.params.id as string } });
    notifyContentChanged("monsters");
    res.status(204).end();
  }),
);
