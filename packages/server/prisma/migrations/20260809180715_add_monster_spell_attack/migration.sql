-- AlterTable
ALTER TABLE "MonsterTemplate" ADD COLUMN     "spellCastTimeMs" INTEGER,
ADD COLUMN     "spellColor" INTEGER,
ADD COLUMN     "spellCooldownMs" INTEGER,
ADD COLUMN     "spellDamage" DOUBLE PRECISION,
ADD COLUMN     "spellRange" DOUBLE PRECISION;
