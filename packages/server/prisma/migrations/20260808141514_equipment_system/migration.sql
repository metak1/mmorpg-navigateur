-- CreateEnum
CREATE TYPE "ItemSlotType" AS ENUM ('helmet', 'gloves', 'chest', 'spalders', 'boots', 'legs', 'amulet', 'ring', 'trinket');

-- CreateEnum
CREATE TYPE "ItemRarity" AS ENUM ('common', 'rare', 'epic', 'legendary');

-- CreateEnum
CREATE TYPE "EquipmentSlot" AS ENUM ('helmet', 'gloves', 'chest', 'spalders', 'boots', 'legs', 'amulet', 'ring1', 'ring2', 'trinket1', 'trinket2');

-- AlterTable
ALTER TABLE "ItemTemplate" ADD COLUMN     "bonusArmor" DOUBLE PRECISION NOT NULL DEFAULT 0,
ADD COLUMN     "bonusCriticalChance" DOUBLE PRECISION NOT NULL DEFAULT 0,
ADD COLUMN     "bonusDexterity" DOUBLE PRECISION NOT NULL DEFAULT 0,
ADD COLUMN     "bonusHp" DOUBLE PRECISION NOT NULL DEFAULT 0,
ADD COLUMN     "bonusIntelligence" DOUBLE PRECISION NOT NULL DEFAULT 0,
ADD COLUMN     "bonusStrength" DOUBLE PRECISION NOT NULL DEFAULT 0,
ADD COLUMN     "rarity" "ItemRarity" NOT NULL DEFAULT 'common',
ADD COLUMN     "slotType" "ItemSlotType";

-- CreateTable
CREATE TABLE "CharacterEquipment" (
    "id" TEXT NOT NULL,
    "characterId" TEXT NOT NULL,
    "slot" "EquipmentSlot" NOT NULL,
    "itemId" TEXT NOT NULL,

    CONSTRAINT "CharacterEquipment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CharacterEquipment_characterId_slot_key" ON "CharacterEquipment"("characterId", "slot");

-- AddForeignKey
ALTER TABLE "CharacterEquipment" ADD CONSTRAINT "CharacterEquipment_characterId_fkey" FOREIGN KEY ("characterId") REFERENCES "Character"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CharacterEquipment" ADD CONSTRAINT "CharacterEquipment_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "ItemTemplate"("id") ON DELETE CASCADE ON UPDATE CASCADE;
