-- CreateTable
CREATE TABLE "Character" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "x" DOUBLE PRECISION NOT NULL,
    "y" DOUBLE PRECISION NOT NULL,
    "classId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Character_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Character_name_key" ON "Character"("name");

-- DataMigration: carry each existing Account's character (name/position/class)
-- over into its own Character row before the columns are dropped below. Only
-- accounts that had already picked a class had a character to preserve.
INSERT INTO "Character" ("id", "accountId", "name", "x", "y", "classId", "createdAt", "updatedAt")
SELECT "id" || '_char', "id", "username", "x", "y", "classId", "createdAt", "updatedAt"
FROM "Account"
WHERE "classId" IS NOT NULL;

-- DropForeignKey
ALTER TABLE "Account" DROP CONSTRAINT "Account_classId_fkey";

-- AlterTable
ALTER TABLE "Account" DROP COLUMN "classId",
DROP COLUMN "x",
DROP COLUMN "y";

-- AddForeignKey
ALTER TABLE "Character" ADD CONSTRAINT "Character_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Character" ADD CONSTRAINT "Character_classId_fkey" FOREIGN KEY ("classId") REFERENCES "ClassTemplate"("id") ON DELETE SET NULL ON UPDATE CASCADE;
