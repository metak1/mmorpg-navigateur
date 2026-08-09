-- CreateEnum
CREATE TYPE "TalentEffectType" AS ENUM ('statBonus', 'spellModifier', 'mechanicFlag');

-- CreateEnum
CREATE TYPE "TalentBonusMode" AS ENUM ('flat', 'percent');

-- CreateTable
CREATE TABLE "TalentTemplate" (
    "id" TEXT NOT NULL,
    "classId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "tier" INTEGER NOT NULL DEFAULT 1,
    "maxRank" INTEGER NOT NULL DEFAULT 1,
    "prerequisiteId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TalentTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TalentEffect" (
    "id" TEXT NOT NULL,
    "talentTemplateId" TEXT NOT NULL,
    "effectType" "TalentEffectType" NOT NULL,
    "statKey" TEXT,
    "spellTemplateId" TEXT,
    "spellParam" TEXT,
    "bonusMode" "TalentBonusMode",
    "valuePerRank" DOUBLE PRECISION,
    "flagName" TEXT,

    CONSTRAINT "TalentEffect_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CharacterTalent" (
    "id" TEXT NOT NULL,
    "characterId" TEXT NOT NULL,
    "talentId" TEXT NOT NULL,
    "rank" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CharacterTalent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CharacterTalent_characterId_talentId_key" ON "CharacterTalent"("characterId", "talentId");

-- AddForeignKey
ALTER TABLE "TalentTemplate" ADD CONSTRAINT "TalentTemplate_classId_fkey" FOREIGN KEY ("classId") REFERENCES "ClassTemplate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TalentTemplate" ADD CONSTRAINT "TalentTemplate_prerequisiteId_fkey" FOREIGN KEY ("prerequisiteId") REFERENCES "TalentTemplate"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TalentEffect" ADD CONSTRAINT "TalentEffect_talentTemplateId_fkey" FOREIGN KEY ("talentTemplateId") REFERENCES "TalentTemplate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TalentEffect" ADD CONSTRAINT "TalentEffect_spellTemplateId_fkey" FOREIGN KEY ("spellTemplateId") REFERENCES "SpellTemplate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CharacterTalent" ADD CONSTRAINT "CharacterTalent_characterId_fkey" FOREIGN KEY ("characterId") REFERENCES "Character"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CharacterTalent" ADD CONSTRAINT "CharacterTalent_talentId_fkey" FOREIGN KEY ("talentId") REFERENCES "TalentTemplate"("id") ON DELETE CASCADE ON UPDATE CASCADE;
