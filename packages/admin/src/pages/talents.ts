import type {
  TalentTemplateDTO,
  TalentTemplateInput,
  TalentEffectDTO,
  TalentEffectInput,
  TalentEffectType,
  TalentStatKey,
  TalentSpellParam,
  TalentBonusMode,
  TalentMechanicFlag,
  SpellTemplateDTO,
} from "shared";
import { TALENT_MECHANIC_FLAGS } from "shared";
import { api } from "../api.js";
import { renderForm, renderTable, type FieldSpec } from "../ui.js";

// A talent's list of effects is faked as a small fixed number of flattened
// form slots — same "no dynamic add/remove list UI" workaround monsters.ts
// uses for drops and quests.ts uses for reward items, since ui.ts's form
// builder has no primitive for a real repeatable child list. 3 is plenty for
// how many effects one talent realistically needs.
const EFFECT_SLOT_COUNT = 3;

const STAT_KEY_OPTIONS: Array<{ value: TalentStatKey; label: string }> = [
  { value: "armor", label: "Armor" },
  { value: "strength", label: "Strength" },
  { value: "intelligence", label: "Intelligence" },
  { value: "dexterity", label: "Dexterity" },
  { value: "criticalChance", label: "Critical Chance" },
  { value: "maxHp", label: "Max HP" },
];

const SPELL_PARAM_OPTIONS: Array<{ value: TalentSpellParam; label: string }> = [
  { value: "damage", label: "Damage" },
  { value: "cooldownMs", label: "Cooldown (ms)" },
  { value: "aoeRadius", label: "AOE Radius" },
  { value: "healAmount", label: "Heal Amount" },
  { value: "maxRange", label: "Max Range" },
];

const BONUS_MODE_OPTIONS: Array<{ value: TalentBonusMode; label: string }> = [
  { value: "flat", label: "Flat" },
  { value: "percent", label: "Percent" },
];

const EFFECT_TYPE_OPTIONS: Array<{ value: TalentEffectType | ""; label: string }> = [
  { value: "", label: "-- none --" },
  { value: "statBonus", label: "Stat Bonus" },
  { value: "spellModifier", label: "Spell Modifier" },
  { value: "mechanicFlag", label: "Mechanic Flag (plumbing only)" },
];

const FLAG_NAME_OPTIONS: Array<{ value: TalentMechanicFlag; label: string }> = TALENT_MECHANIC_FLAGS.map((f) => ({
  value: f,
  label: f,
}));

const BASE_FIELDS: FieldSpec[] = [
  { name: "name", label: "Name", type: "text" },
  { name: "description", label: "Description", type: "text" },
  { name: "tier", label: "Tier", type: "number" },
  { name: "maxRank", label: "Max Rank", type: "number" },
  // Options are rebuilt dynamically per the form's currently-selected class
  // — see rebuildScopedOptions.
  { name: "prerequisiteId", label: "Prerequisite", type: "select", options: [] },
];
for (let i = 1; i <= EFFECT_SLOT_COUNT; i++) {
  BASE_FIELDS.push({ name: `effect${i}Type`, label: `Effect ${i} — Type`, type: "select", options: EFFECT_TYPE_OPTIONS });
  BASE_FIELDS.push({ name: `effect${i}StatKey`, label: `Effect ${i} — Stat`, type: "select", options: STAT_KEY_OPTIONS });
  BASE_FIELDS.push({ name: `effect${i}SpellTemplateId`, label: `Effect ${i} — Spell`, type: "select", options: [] });
  BASE_FIELDS.push({ name: `effect${i}SpellParam`, label: `Effect ${i} — Spell Param`, type: "select", options: SPELL_PARAM_OPTIONS });
  BASE_FIELDS.push({ name: `effect${i}BonusMode`, label: `Effect ${i} — Mode`, type: "select", options: BONUS_MODE_OPTIONS });
  BASE_FIELDS.push({ name: `effect${i}ValuePerRank`, label: `Effect ${i} — Value / Rank`, type: "number", step: "0.1" });
  BASE_FIELDS.push({ name: `effect${i}FlagName`, label: `Effect ${i} — Flag`, type: "select", options: FLAG_NAME_OPTIONS });
}

function defaultEffectSlotValues(): Record<string, string | number> {
  const values: Record<string, string | number> = {};
  for (let i = 1; i <= EFFECT_SLOT_COUNT; i++) {
    values[`effect${i}Type`] = "";
    values[`effect${i}StatKey`] = "armor";
    values[`effect${i}SpellTemplateId`] = "";
    values[`effect${i}SpellParam`] = "damage";
    values[`effect${i}BonusMode`] = "flat";
    values[`effect${i}ValuePerRank`] = 1;
    values[`effect${i}FlagName`] = TALENT_MECHANIC_FLAGS[0];
  }
  return values;
}

function toInput(values: Record<string, string>): TalentTemplateInput {
  const num = (key: string): number | null => (values[key] === "" ? null : Number(values[key]));

  const effects: TalentEffectInput[] = [];
  for (let i = 1; i <= EFFECT_SLOT_COUNT; i++) {
    const effectType = values[`effect${i}Type`] as TalentEffectType | "";
    if (!effectType) continue;
    const isStatOrSpell = effectType === "statBonus" || effectType === "spellModifier";
    effects.push({
      effectType,
      statKey: effectType === "statBonus" ? (values[`effect${i}StatKey`] as TalentStatKey) : null,
      spellTemplateId: effectType === "spellModifier" ? values[`effect${i}SpellTemplateId`] || null : null,
      spellParam: effectType === "spellModifier" ? (values[`effect${i}SpellParam`] as TalentSpellParam) : null,
      bonusMode: isStatOrSpell ? (values[`effect${i}BonusMode`] as TalentBonusMode) : null,
      valuePerRank: isStatOrSpell ? num(`effect${i}ValuePerRank`) : null,
      flagName: effectType === "mechanicFlag" ? (values[`effect${i}FlagName`] as TalentMechanicFlag) : null,
    });
  }

  return {
    classId: values.classId,
    name: values.name,
    description: values.description,
    tier: Number(values.tier),
    maxRank: Number(values.maxRank),
    prerequisiteId: values.prerequisiteId || null,
    effects,
  };
}

function talentToFormValues(talent: TalentTemplateDTO): Record<string, string | number> {
  const values: Record<string, string | number> = {
    classId: talent.classId,
    name: talent.name,
    description: talent.description,
    tier: talent.tier,
    maxRank: talent.maxRank,
    prerequisiteId: talent.prerequisiteId ?? "",
    ...defaultEffectSlotValues(),
  };
  talent.effects.forEach((e, i) => {
    if (i >= EFFECT_SLOT_COUNT) return;
    values[`effect${i + 1}Type`] = e.effectType;
    values[`effect${i + 1}StatKey`] = e.statKey ?? "armor";
    values[`effect${i + 1}SpellTemplateId`] = e.spellTemplateId ?? "";
    values[`effect${i + 1}SpellParam`] = e.spellParam ?? "damage";
    values[`effect${i + 1}BonusMode`] = e.bonusMode ?? "flat";
    values[`effect${i + 1}ValuePerRank`] = e.valuePerRank ?? 1;
    values[`effect${i + 1}FlagName`] = e.flagName ?? TALENT_MECHANIC_FLAGS[0];
  });
  return values;
}

function describeEffect(effect: TalentEffectDTO): string {
  if (effect.effectType === "statBonus") {
    return `${effect.statKey} +${effect.valuePerRank}${effect.bonusMode === "percent" ? "%" : ""}/rank`;
  }
  if (effect.effectType === "spellModifier") {
    return `${effect.spellParam} ${effect.valuePerRank}${effect.bonusMode === "percent" ? "%" : ""}/rank`;
  }
  return `flag: ${effect.flagName}`;
}

function updateFieldVisibility(form: HTMLFormElement) {
  const setVisible = (name: string, visible: boolean) => {
    const el = form.querySelector<HTMLElement>(`[data-field="${name}"]`);
    if (el) el.style.display = visible ? "" : "none";
  };
  for (let i = 1; i <= EFFECT_SLOT_COUNT; i++) {
    const effectType = form.querySelector<HTMLSelectElement>(`[name="effect${i}Type"]`)?.value;
    const isStatOrSpell = effectType === "statBonus" || effectType === "spellModifier";
    setVisible(`effect${i}StatKey`, effectType === "statBonus");
    setVisible(`effect${i}SpellTemplateId`, effectType === "spellModifier");
    setVisible(`effect${i}SpellParam`, effectType === "spellModifier");
    setVisible(`effect${i}BonusMode`, isStatOrSpell);
    setVisible(`effect${i}ValuePerRank`, isStatOrSpell);
    setVisible(`effect${i}FlagName`, effectType === "mechanicFlag");
  }
}

// prerequisiteId and each effect slot's spellTemplateId must only offer
// options from the form's currently-selected class — a talent can't
// prerequisite a talent from another class, and a spell-modifier effect
// only makes sense against that class's own spells. ui.ts's renderForm bakes
// <option> lists in once at build time, so this clears and repopulates just
// those selects, called on initial render and whenever classId changes.
function rebuildScopedOptions(
  form: HTMLFormElement,
  classId: string,
  talents: TalentTemplateDTO[],
  spells: SpellTemplateDTO[],
  editingId: string | null,
) {
  const prereqSelect = form.querySelector<HTMLSelectElement>('[name="prerequisiteId"]');
  if (prereqSelect) {
    const current = prereqSelect.value;
    prereqSelect.innerHTML = "";
    const noneOpt = document.createElement("option");
    noneOpt.value = "";
    noneOpt.textContent = "-- none --";
    prereqSelect.appendChild(noneOpt);
    for (const t of talents) {
      if (t.classId !== classId || t.id === editingId) continue;
      const opt = document.createElement("option");
      opt.value = t.id;
      opt.textContent = `Tier ${t.tier} — ${t.name}`;
      prereqSelect.appendChild(opt);
    }
    prereqSelect.value = current;
  }

  for (let i = 1; i <= EFFECT_SLOT_COUNT; i++) {
    const select = form.querySelector<HTMLSelectElement>(`[name="effect${i}SpellTemplateId"]`);
    if (!select) continue;
    const current = select.value;
    select.innerHTML = "";
    const noneOpt = document.createElement("option");
    noneOpt.value = "";
    noneOpt.textContent = "-- none --";
    select.appendChild(noneOpt);
    for (const s of spells) {
      if (s.classId !== classId) continue;
      const opt = document.createElement("option");
      opt.value = s.id;
      opt.textContent = `${s.keybind} ${s.name}`;
      select.appendChild(opt);
    }
    select.value = current;
  }
}

export async function renderTalentsPage(container: HTMLElement) {
  const classes = await api.listClasses();
  const classNameById = new Map(classes.map((c) => [c.id, c.name]));

  const heading = document.createElement("h2");
  heading.textContent = "Talents";
  container.appendChild(heading);

  if (classes.length === 0) {
    const warning = document.createElement("p");
    warning.textContent = "Create a class first (Classes tab) before adding talents.";
    container.appendChild(warning);
    return;
  }

  const fields: FieldSpec[] = [
    { name: "classId", label: "Class", type: "select", options: classes.map((c) => ({ value: c.id, label: c.name })) },
    ...BASE_FIELDS,
  ];

  const defaultValues: Record<string, string | number> = {
    classId: classes[0]?.id ?? "",
    name: "New Talent",
    description: "",
    tier: 1,
    maxRank: 1,
    prerequisiteId: "",
    ...defaultEffectSlotValues(),
  };

  let editingId: string | null = null;
  let classFilter = "";
  let talents: TalentTemplateDTO[] = [];
  const spells = await api.listSpells();

  const formHeading = document.createElement("h3");
  const formSection = document.createElement("div");
  const filterSection = document.createElement("div");
  const tableSection = document.createElement("div");
  container.append(formHeading, formSection, filterSection, tableSection);

  const filterLabel = document.createElement("label");
  filterLabel.textContent = "Filter by class: ";
  const filterSelect = document.createElement("select");
  const allOption = document.createElement("option");
  allOption.value = "";
  allOption.textContent = "All classes";
  filterSelect.appendChild(allOption);
  for (const cls of classes) {
    const opt = document.createElement("option");
    opt.value = cls.id;
    opt.textContent = cls.name;
    filterSelect.appendChild(opt);
  }
  filterSelect.addEventListener("change", () => {
    classFilter = filterSelect.value;
    void renderTableSection();
  });
  filterLabel.appendChild(filterSelect);
  filterSection.appendChild(filterLabel);

  function renderFormSection(initial: Record<string, string | number>) {
    formHeading.textContent = editingId ? "Edit Talent" : "New Talent";
    formSection.innerHTML = "";

    const form = renderForm(
      formSection,
      fields,
      initial,
      async (values) => {
        try {
          const input = toInput(values);
          if (editingId) {
            await api.updateTalent(editingId, input);
          } else {
            await api.createTalent(input);
          }
          editingId = null;
          renderFormSection(defaultValues);
          await renderTableSection();
        } catch (err) {
          alert(err instanceof Error ? err.message : String(err));
        }
      },
      editingId ? "Update" : "Create",
    );

    const classSelect = form.querySelector<HTMLSelectElement>('[name="classId"]');
    const refreshScoped = () => {
      rebuildScopedOptions(form, classSelect?.value ?? "", talents, spells, editingId);
      updateFieldVisibility(form);
    };
    classSelect?.addEventListener("change", refreshScoped);
    for (let i = 1; i <= EFFECT_SLOT_COUNT; i++) {
      form.querySelector<HTMLSelectElement>(`[name="effect${i}Type"]`)?.addEventListener("change", () => updateFieldVisibility(form));
    }
    refreshScoped();

    if (editingId) {
      const cancelBtn = document.createElement("button");
      cancelBtn.textContent = "Cancel";
      cancelBtn.addEventListener("click", () => {
        editingId = null;
        renderFormSection(defaultValues);
      });
      formSection.appendChild(cancelBtn);
    }
  }

  async function renderTableSection() {
    talents = await api.listTalents();
    const filtered = classFilter ? talents.filter((t) => t.classId === classFilter) : talents;
    tableSection.innerHTML = "";
    renderTable<TalentTemplateDTO>(
      tableSection,
      [
        { key: "classId", label: "Class", format: (v) => classNameById.get(v as string) ?? "?" },
        { key: "tier", label: "Tier" },
        { key: "name", label: "Name" },
        { key: "maxRank", label: "Max Rank" },
        {
          key: "prerequisiteId",
          label: "Prerequisite",
          format: (v) => (v ? (talents.find((t) => t.id === v)?.name ?? "?") : "—"),
        },
        {
          key: "effects",
          label: "Effects",
          format: (_v, row) => (row.effects.length === 0 ? "—" : row.effects.map(describeEffect).join(", ")),
        },
      ],
      filtered,
      [
        {
          label: "Edit",
          onClick: (row) => {
            editingId = row.id;
            renderFormSection(talentToFormValues(row));
          },
        },
        {
          label: "Delete",
          className: "danger",
          onClick: async (row) => {
            if (confirm(`Delete talent "${row.name}"?`)) {
              await api.deleteTalent(row.id);
              await renderTableSection();
            }
          },
        },
      ],
    );
  }

  await renderTableSection();
  renderFormSection(defaultValues);
}
