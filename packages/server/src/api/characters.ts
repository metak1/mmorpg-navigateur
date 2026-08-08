import { Router } from "express";
import type { CharacterDTO } from "shared";
import { MAX_CHARACTERS_PER_ACCOUNT } from "shared";
import { prisma } from "../db.js";
import { asyncRoute } from "./errors.js";
import { requireAuth } from "./adminAuth.js";

export const charactersRouter = Router();
charactersRouter.use(requireAuth);

function characterDTO(character: { id: string; name: string; class: { name: string } | null }): CharacterDTO {
  return { id: character.id, name: character.name, className: character.class?.name ?? null };
}

charactersRouter.get(
  "/",
  asyncRoute(async (req, res) => {
    const characters = await prisma.character.findMany({
      where: { accountId: req.account!.sub },
      include: { class: true },
      orderBy: { createdAt: "asc" },
    });
    res.json(characters.map(characterDTO));
  }),
);

charactersRouter.post(
  "/",
  asyncRoute(async (req, res) => {
    const { name, className } = req.body as { name?: string; className?: string };

    const trimmedName = name?.trim() ?? "";
    if (trimmedName.length < 3 || trimmedName.length > 24) {
      res.status(400).json({ error: "Character name must be 3-24 characters." });
      return;
    }

    const existingCount = await prisma.character.count({ where: { accountId: req.account!.sub } });
    if (existingCount >= MAX_CHARACTERS_PER_ACCOUNT) {
      res.status(400).json({ error: `You can only have up to ${MAX_CHARACTERS_PER_ACCOUNT} characters.` });
      return;
    }

    const chosenClass = await prisma.classTemplate.findUnique({ where: { name: className ?? "" } });
    if (!chosenClass) {
      res.status(400).json({ error: `Unknown class "${className}".` });
      return;
    }

    const map = await prisma.gameMap.findFirst({ where: { isActive: true } });
    if (!map) {
      res.status(500).json({ error: "No active map configured." });
      return;
    }

    let character;
    try {
      character = await prisma.character.create({
        data: {
          accountId: req.account!.sub,
          name: trimmedName,
          x: map.spawnX,
          y: map.spawnY,
          classId: chosenClass.id,
        },
        include: { class: true },
      });
    } catch (err: unknown) {
      if (typeof err === "object" && err !== null && "code" in err && err.code === "P2002") {
        res.status(409).json({ error: "Character name already taken." });
        return;
      }
      throw err;
    }

    res.status(201).json(characterDTO(character));
  }),
);
