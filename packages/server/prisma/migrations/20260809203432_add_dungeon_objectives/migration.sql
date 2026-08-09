-- CreateEnum
CREATE TYPE "DungeonObjectiveKind" AS ENUM ('killBoss', 'killAllMonsters', 'killCount');

-- CreateTable
CREATE TABLE "DungeonObjective" (
    "id" TEXT NOT NULL,
    "mapId" TEXT NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 0,
    "description" TEXT NOT NULL,
    "kind" "DungeonObjectiveKind" NOT NULL,
    "monsterTemplateId" TEXT,
    "requiredCount" INTEGER,

    CONSTRAINT "DungeonObjective_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "DungeonObjective" ADD CONSTRAINT "DungeonObjective_mapId_fkey" FOREIGN KEY ("mapId") REFERENCES "GameMap"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DungeonObjective" ADD CONSTRAINT "DungeonObjective_monsterTemplateId_fkey" FOREIGN KEY ("monsterTemplateId") REFERENCES "MonsterTemplate"("id") ON DELETE SET NULL ON UPDATE CASCADE;
