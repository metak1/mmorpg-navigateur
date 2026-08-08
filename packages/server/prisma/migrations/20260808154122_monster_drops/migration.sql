-- CreateTable
CREATE TABLE "MonsterDrop" (
    "id" TEXT NOT NULL,
    "monsterTemplateId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "dropChance" DOUBLE PRECISION NOT NULL DEFAULT 10,
    "minQuantity" INTEGER NOT NULL DEFAULT 1,
    "maxQuantity" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "MonsterDrop_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MonsterDrop_monsterTemplateId_itemId_key" ON "MonsterDrop"("monsterTemplateId", "itemId");

-- AddForeignKey
ALTER TABLE "MonsterDrop" ADD CONSTRAINT "MonsterDrop_monsterTemplateId_fkey" FOREIGN KEY ("monsterTemplateId") REFERENCES "MonsterTemplate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MonsterDrop" ADD CONSTRAINT "MonsterDrop_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "ItemTemplate"("id") ON DELETE CASCADE ON UPDATE CASCADE;
