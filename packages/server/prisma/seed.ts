import { fileURLToPath } from "node:url";
import path from "node:path";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { PrismaClient } from "@prisma/client";
import {
  DEFAULT_SPELLS,
  DEFAULT_MAP_DATA,
  DEFAULT_MAP_COLS,
  DEFAULT_MAP_ROWS,
  DEFAULT_TILE_SIZE,
  DEFAULT_SPAWN_X,
  DEFAULT_SPAWN_Y,
  DEFAULT_MONSTER_MAX_HP,
  DEFAULT_WANDER_RADIUS,
  DEFAULT_WANDER_INTERVAL_MS,
  DEFAULT_WANDER_SPEED,
  DEFAULT_AGGRO_RANGE,
  DEFAULT_CHASE_SPEED,
  DEFAULT_MONSTER_ATTACK_RANGE,
  DEFAULT_MONSTER_TOUCH_DAMAGE,
  DEFAULT_MONSTER_ATTACK_COOLDOWN_MS,
  DEFAULT_MONSTER_SPAWNS,
} from "shared";

// Same path-resolution approach as src/db.ts: resolved relative to this file,
// not process.cwd(), so `npx prisma db seed` and the running server always
// agree on which dev.db they're touching.
const dbPath = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "dev.db");
const adapter = new PrismaBetterSqlite3({ url: dbPath });
const prisma = new PrismaClient({ adapter });

async function main() {
  const existingMap = await prisma.gameMap.findFirst();
  if (existingMap) {
    console.log("Seed skipped: content already exists.");
    return;
  }

  for (const [keybind, spell] of Object.entries(DEFAULT_SPELLS)) {
    await prisma.spellTemplate.create({
      data: {
        keybind: Number(keybind),
        name: spell.name,
        kind: spell.kind,
        cooldownMs: spell.cooldownMs,
        castTimeMs: spell.castTimeMs,
        color: spell.color,
        size: spell.size,
        damage: spell.damage ?? null,
        projectileSpeed: spell.projectileSpeed ?? null,
        maxRange: spell.maxRange ?? null,
        aoeRadius: spell.aoeRadius ?? null,
        slowMultiplier: spell.slowMultiplier ?? null,
        slowDurationMs: spell.slowDurationMs ?? null,
        healAmount: spell.healAmount ?? null,
      },
    });
  }

  const monsterTemplate = await prisma.monsterTemplate.create({
    data: {
      name: "Slime",
      maxHp: DEFAULT_MONSTER_MAX_HP,
      wanderRadius: DEFAULT_WANDER_RADIUS,
      wanderIntervalMs: DEFAULT_WANDER_INTERVAL_MS,
      wanderSpeed: DEFAULT_WANDER_SPEED,
      aggroRange: DEFAULT_AGGRO_RANGE,
      chaseSpeed: DEFAULT_CHASE_SPEED,
      attackRange: DEFAULT_MONSTER_ATTACK_RANGE,
      touchDamage: DEFAULT_MONSTER_TOUCH_DAMAGE,
      attackCooldownMs: DEFAULT_MONSTER_ATTACK_COOLDOWN_MS,
    },
  });

  await prisma.gameMap.create({
    data: {
      name: "Default Map",
      width: DEFAULT_MAP_COLS,
      height: DEFAULT_MAP_ROWS,
      tileSize: DEFAULT_TILE_SIZE,
      tileData: JSON.stringify(DEFAULT_MAP_DATA),
      spawnX: DEFAULT_SPAWN_X,
      spawnY: DEFAULT_SPAWN_Y,
      isActive: true,
      spawns: {
        create: DEFAULT_MONSTER_SPAWNS.map((spawn) => ({
          monsterTemplateId: monsterTemplate.id,
          x: spawn.x,
          y: spawn.y,
        })),
      },
    },
  });

  console.log("Seed complete: 5 spells, 1 monster template, 1 active map with 2 spawns.");
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
