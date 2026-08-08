-- CreateEnum
CREATE TYPE "Role" AS ENUM ('player', 'admin');

-- CreateTable
CREATE TABLE "Account" (
    "id" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" "Role" NOT NULL DEFAULT 'player',
    "x" DOUBLE PRECISION NOT NULL,
    "y" DOUBLE PRECISION NOT NULL,
    "classId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Account_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClassTemplate" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "color" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ClassTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MonsterTemplate" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "maxHp" DOUBLE PRECISION NOT NULL,
    "wanderRadius" DOUBLE PRECISION NOT NULL,
    "wanderIntervalMs" INTEGER NOT NULL,
    "wanderSpeed" DOUBLE PRECISION NOT NULL,
    "aggroRange" DOUBLE PRECISION NOT NULL,
    "chaseSpeed" DOUBLE PRECISION NOT NULL,
    "attackRange" DOUBLE PRECISION NOT NULL,
    "touchDamage" DOUBLE PRECISION NOT NULL,
    "attackCooldownMs" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MonsterTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SpellTemplate" (
    "id" TEXT NOT NULL,
    "classId" TEXT NOT NULL,
    "keybind" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "cooldownMs" INTEGER NOT NULL,
    "castTimeMs" INTEGER NOT NULL DEFAULT 0,
    "color" INTEGER NOT NULL,
    "size" DOUBLE PRECISION NOT NULL,
    "damage" DOUBLE PRECISION,
    "projectileSpeed" DOUBLE PRECISION,
    "maxRange" DOUBLE PRECISION,
    "aoeRadius" DOUBLE PRECISION,
    "slowMultiplier" DOUBLE PRECISION,
    "slowDurationMs" INTEGER,
    "healAmount" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SpellTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GameMap" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "width" INTEGER NOT NULL,
    "height" INTEGER NOT NULL,
    "tileSize" INTEGER NOT NULL DEFAULT 32,
    "tileData" TEXT NOT NULL,
    "spawnX" DOUBLE PRECISION NOT NULL,
    "spawnY" DOUBLE PRECISION NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GameMap_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MonsterSpawn" (
    "id" TEXT NOT NULL,
    "mapId" TEXT NOT NULL,
    "monsterTemplateId" TEXT NOT NULL,
    "x" DOUBLE PRECISION NOT NULL,
    "y" DOUBLE PRECISION NOT NULL,

    CONSTRAINT "MonsterSpawn_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Account_username_key" ON "Account"("username");

-- CreateIndex
CREATE UNIQUE INDEX "ClassTemplate_name_key" ON "ClassTemplate"("name");

-- CreateIndex
CREATE UNIQUE INDEX "SpellTemplate_classId_keybind_key" ON "SpellTemplate"("classId", "keybind");

-- AddForeignKey
ALTER TABLE "Account" ADD CONSTRAINT "Account_classId_fkey" FOREIGN KEY ("classId") REFERENCES "ClassTemplate"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SpellTemplate" ADD CONSTRAINT "SpellTemplate_classId_fkey" FOREIGN KEY ("classId") REFERENCES "ClassTemplate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MonsterSpawn" ADD CONSTRAINT "MonsterSpawn_mapId_fkey" FOREIGN KEY ("mapId") REFERENCES "GameMap"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MonsterSpawn" ADD CONSTRAINT "MonsterSpawn_monsterTemplateId_fkey" FOREIGN KEY ("monsterTemplateId") REFERENCES "MonsterTemplate"("id") ON DELETE CASCADE ON UPDATE CASCADE;
