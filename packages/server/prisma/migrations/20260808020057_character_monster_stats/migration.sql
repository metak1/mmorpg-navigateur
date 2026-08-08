-- AlterTable
ALTER TABLE "Character" ADD COLUMN     "level" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "experience" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "armor" DOUBLE PRECISION NOT NULL DEFAULT 0,
ADD COLUMN     "strength" DOUBLE PRECISION NOT NULL DEFAULT 0,
ADD COLUMN     "intelligence" DOUBLE PRECISION NOT NULL DEFAULT 0,
ADD COLUMN     "dexterity" DOUBLE PRECISION NOT NULL DEFAULT 0,
ADD COLUMN     "criticalChance" DOUBLE PRECISION NOT NULL DEFAULT 5;

-- AlterTable
ALTER TABLE "MonsterTemplate" ADD COLUMN     "level" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "armor" DOUBLE PRECISION NOT NULL DEFAULT 0,
ADD COLUMN     "xpReward" INTEGER NOT NULL DEFAULT 20;

-- DataMigration: backfill per-class starting armor/STR/INT/DEX for existing
-- characters — the flat column defaults above are correct as a fallback for
-- characters with no class assigned, but a Mage shouldn't sit at
-- strength=0/intelligence=0 forever, so give each class its intended split.
UPDATE "Character" SET "armor" = 8, "strength" = 10, "intelligence" = 0, "dexterity" = 0
WHERE "classId" IN (SELECT "id" FROM "ClassTemplate" WHERE "name" = 'Warrior');

UPDATE "Character" SET "armor" = 3, "strength" = 0, "intelligence" = 0, "dexterity" = 12
WHERE "classId" IN (SELECT "id" FROM "ClassTemplate" WHERE "name" = 'Rogue');

UPDATE "Character" SET "armor" = 2, "strength" = 0, "intelligence" = 12, "dexterity" = 0
WHERE "classId" IN (SELECT "id" FROM "ClassTemplate" WHERE "name" = 'Mage');

UPDATE "Character" SET "armor" = 4, "strength" = 0, "intelligence" = 10, "dexterity" = 0
WHERE "classId" IN (SELECT "id" FROM "ClassTemplate" WHERE "name" = 'Priest');
