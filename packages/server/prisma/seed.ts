import "dotenv/config";
import pg from "pg";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import {
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

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

interface SeedSpell {
  keybind: number;
  name: string;
  kind: string;
  cooldownMs: number;
  castTimeMs: number;
  color: number;
  size: number;
  damage?: number;
  projectileSpeed?: number;
  maxRange?: number;
  aoeRadius?: number;
  slowMultiplier?: number;
  slowDurationMs?: number;
  healAmount?: number;
}

interface SeedClass {
  name: string;
  color: number;
  spells: SeedSpell[];
}

const CLASSES: SeedClass[] = [
  {
    name: "Warrior",
    color: 0xdd4444,
    spells: [
      {
        keybind: 1,
        name: "Slash",
        kind: "single",
        cooldownMs: 500,
        castTimeMs: 0,
        color: 0xdd4444,
        size: 6,
        damage: 20,
        projectileSpeed: 550,
        maxRange: 250,
      },
      {
        keybind: 2,
        name: "Cleave",
        kind: "aoe",
        cooldownMs: 3000,
        castTimeMs: 400,
        color: 0xff8844,
        size: 10,
        damage: 18,
        projectileSpeed: 400,
        maxRange: 200,
        aoeRadius: 60,
      },
    ],
  },
  {
    name: "Rogue",
    color: 0x888899,
    spells: [
      {
        keybind: 1,
        name: "Backstab",
        kind: "single",
        cooldownMs: 700,
        castTimeMs: 0,
        color: 0x888899,
        size: 5,
        damage: 30,
        projectileSpeed: 600,
        maxRange: 300,
      },
      {
        keybind: 2,
        name: "Poison Dart",
        kind: "slow",
        cooldownMs: 2000,
        castTimeMs: 0,
        color: 0x66aa44,
        size: 6,
        damage: 8,
        projectileSpeed: 450,
        maxRange: 350,
        slowMultiplier: 0.3,
        slowDurationMs: 2500,
      },
    ],
  },
  {
    name: "Priest",
    color: 0xffee99,
    spells: [
      {
        keybind: 1,
        name: "Smite",
        kind: "single",
        cooldownMs: 500,
        castTimeMs: 0,
        color: 0xffee99,
        size: 6,
        damage: 18,
        projectileSpeed: 500,
        maxRange: 400,
      },
      {
        keybind: 2,
        name: "Heal",
        kind: "heal",
        cooldownMs: 4000,
        castTimeMs: 1000,
        color: 0x55ff88,
        size: 0,
        healAmount: 40,
      },
    ],
  },
  {
    name: "Mage",
    color: 0x6699ff,
    spells: [
      {
        keybind: 1,
        name: "Fireball",
        kind: "single",
        cooldownMs: 2200,
        castTimeMs: 700,
        color: 0xff5522,
        size: 12,
        damage: 55,
        projectileSpeed: 260,
        maxRange: 500,
      },
      {
        keybind: 2,
        name: "Frost Nova",
        kind: "groundAoe",
        cooldownMs: 4500,
        castTimeMs: 500,
        color: 0x33ccff,
        size: 0,
        damage: 25,
        healAmount: 0,
        aoeRadius: 80,
        maxRange: 300,
      },
    ],
  },
];

async function seedClassesAndSpells() {
  const existing = await prisma.classTemplate.findFirst();
  if (existing) {
    console.log("Classes/spells seed skipped: content already exists.");
    return;
  }

  for (const cls of CLASSES) {
    const classTemplate = await prisma.classTemplate.create({
      data: { name: cls.name, color: cls.color },
    });

    for (const spell of cls.spells) {
      await prisma.spellTemplate.create({
        data: {
          classId: classTemplate.id,
          keybind: spell.keybind,
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
  }

  console.log(`Seeded ${CLASSES.length} classes with ${CLASSES.reduce((n, c) => n + c.spells.length, 0)} spells.`);
}

async function seedMapAndMonsters() {
  const existingMap = await prisma.gameMap.findFirst();
  if (existingMap) {
    console.log("Map/monster seed skipped: content already exists.");
    return;
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

  console.log("Seeded 1 monster template, 1 active map with 2 spawns.");
}

async function main() {
  await seedClassesAndSpells();
  await seedMapAndMonsters();
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
