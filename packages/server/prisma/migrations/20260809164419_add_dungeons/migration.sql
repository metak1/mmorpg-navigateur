-- AlterTable
ALTER TABLE "GameMap" ADD COLUMN     "isDungeon" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "minLevel" INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "MonsterSpawn" ADD COLUMN     "isBoss" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "MapPortal" (
    "id" TEXT NOT NULL,
    "mapId" TEXT NOT NULL,
    "x" DOUBLE PRECISION NOT NULL,
    "y" DOUBLE PRECISION NOT NULL,
    "targetMapId" TEXT NOT NULL,

    CONSTRAINT "MapPortal_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "MapPortal" ADD CONSTRAINT "MapPortal_mapId_fkey" FOREIGN KEY ("mapId") REFERENCES "GameMap"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MapPortal" ADD CONSTRAINT "MapPortal_targetMapId_fkey" FOREIGN KEY ("targetMapId") REFERENCES "GameMap"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
