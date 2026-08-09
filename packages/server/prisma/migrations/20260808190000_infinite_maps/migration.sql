-- AlterTable
ALTER TABLE "GameMap" DROP COLUMN "width",
DROP COLUMN "height",
DROP COLUMN "tileData",
ADD COLUMN "ambientSpawnChance" DOUBLE PRECISION NOT NULL DEFAULT 0.3;

-- CreateTable
CREATE TABLE "MapTile" (
    "id" TEXT NOT NULL,
    "mapId" TEXT NOT NULL,
    "col" INTEGER NOT NULL,
    "row" INTEGER NOT NULL,
    "tileType" INTEGER NOT NULL,

    CONSTRAINT "MapTile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MapAmbientSpawn" (
    "id" TEXT NOT NULL,
    "mapId" TEXT NOT NULL,
    "monsterTemplateId" TEXT NOT NULL,
    "weight" DOUBLE PRECISION NOT NULL DEFAULT 1,

    CONSTRAINT "MapAmbientSpawn_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MapTile_mapId_col_row_key" ON "MapTile"("mapId", "col", "row");

-- AddForeignKey
ALTER TABLE "MapTile" ADD CONSTRAINT "MapTile_mapId_fkey" FOREIGN KEY ("mapId") REFERENCES "GameMap"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MapAmbientSpawn" ADD CONSTRAINT "MapAmbientSpawn_mapId_fkey" FOREIGN KEY ("mapId") REFERENCES "GameMap"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MapAmbientSpawn" ADD CONSTRAINT "MapAmbientSpawn_monsterTemplateId_fkey" FOREIGN KEY ("monsterTemplateId") REFERENCES "MonsterTemplate"("id") ON DELETE CASCADE ON UPDATE CASCADE;
