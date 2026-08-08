import type { MonsterTemplateDTO, MonsterTemplateInput, ItemTemplateDTO } from "shared";
import { api } from "../api.js";
import { renderForm, renderTable, type FieldSpec } from "../ui.js";

const DROP_SLOT_COUNT = 6;

function buildFields(items: ItemTemplateDTO[]): FieldSpec[] {
  const itemOptionsWithNone = [{ value: "", label: "-- none --" }, ...items.map((i) => ({ value: i.id, label: `${i.name} (${i.rarity})` }))];

  const fields: FieldSpec[] = [
    { name: "name", label: "Name", type: "text" },
    { name: "maxHp", label: "Max HP", type: "number" },
    { name: "wanderRadius", label: "Wander Radius (px)", type: "number" },
    { name: "wanderIntervalMs", label: "Wander Interval (ms)", type: "number" },
    { name: "wanderSpeed", label: "Wander Speed (px/s)", type: "number" },
    { name: "aggroRange", label: "Aggro Range (px)", type: "number" },
    { name: "chaseSpeed", label: "Chase Speed (px/s)", type: "number" },
    { name: "attackRange", label: "Attack Range (px)", type: "number" },
    { name: "touchDamage", label: "Touch Damage", type: "number" },
    { name: "attackCooldownMs", label: "Attack Cooldown (ms)", type: "number" },
    { name: "level", label: "Level", type: "number" },
    { name: "armor", label: "Armor", type: "number" },
    { name: "xpReward", label: "XP Reward", type: "number" },
  ];

  // Equipment should drop rarely (low % chance); resources (non-equippable
  // items) are meant to be fairly common — the chance is per-entry and up to
  // whoever authors the drop table, this just labels the field as a percent.
  for (let i = 1; i <= DROP_SLOT_COUNT; i++) {
    fields.push({ name: `drop${i}ItemId`, label: `Drop ${i} — Item`, type: "select", options: itemOptionsWithNone });
    fields.push({ name: `drop${i}Chance`, label: `Drop ${i} — Chance (%)`, type: "number" });
    fields.push({ name: `drop${i}Min`, label: `Drop ${i} — Min Qty`, type: "number" });
    fields.push({ name: `drop${i}Max`, label: `Drop ${i} — Max Qty`, type: "number" });
  }

  return fields;
}

const DEFAULT_VALUES: Record<string, string | number> = {
  name: "New Monster",
  maxHp: 100,
  wanderRadius: 96,
  wanderIntervalMs: 3000,
  wanderSpeed: 40,
  aggroRange: 120,
  chaseSpeed: 90,
  attackRange: 32,
  touchDamage: 10,
  attackCooldownMs: 1000,
  level: 1,
  armor: 2,
  xpReward: 25,
};
for (let i = 1; i <= DROP_SLOT_COUNT; i++) {
  DEFAULT_VALUES[`drop${i}ItemId`] = "";
  DEFAULT_VALUES[`drop${i}Chance`] = 10;
  DEFAULT_VALUES[`drop${i}Min`] = 1;
  DEFAULT_VALUES[`drop${i}Max`] = 1;
}

function toInput(values: Record<string, string>): MonsterTemplateInput {
  const drops: MonsterTemplateInput["drops"] = [];
  for (let i = 1; i <= DROP_SLOT_COUNT; i++) {
    const itemId = values[`drop${i}ItemId`];
    if (!itemId) continue;
    const minQuantity = Number(values[`drop${i}Min`]) || 1;
    const maxQuantity = Math.max(minQuantity, Number(values[`drop${i}Max`]) || minQuantity);
    drops.push({
      itemId,
      dropChance: Number(values[`drop${i}Chance`]) || 0,
      minQuantity,
      maxQuantity,
    });
  }

  return {
    name: values.name,
    maxHp: Number(values.maxHp),
    wanderRadius: Number(values.wanderRadius),
    wanderIntervalMs: Number(values.wanderIntervalMs),
    wanderSpeed: Number(values.wanderSpeed),
    aggroRange: Number(values.aggroRange),
    chaseSpeed: Number(values.chaseSpeed),
    attackRange: Number(values.attackRange),
    touchDamage: Number(values.touchDamage),
    attackCooldownMs: Number(values.attackCooldownMs),
    level: Number(values.level),
    armor: Number(values.armor),
    xpReward: Number(values.xpReward),
    drops,
  };
}

function monsterToFormValues(monster: MonsterTemplateDTO): Record<string, string | number> {
  const values: Record<string, string | number> = {
    name: monster.name,
    maxHp: monster.maxHp,
    wanderRadius: monster.wanderRadius,
    wanderIntervalMs: monster.wanderIntervalMs,
    wanderSpeed: monster.wanderSpeed,
    aggroRange: monster.aggroRange,
    chaseSpeed: monster.chaseSpeed,
    attackRange: monster.attackRange,
    touchDamage: monster.touchDamage,
    attackCooldownMs: monster.attackCooldownMs,
    level: monster.level,
    armor: monster.armor,
    xpReward: monster.xpReward,
  };
  for (let i = 1; i <= DROP_SLOT_COUNT; i++) {
    values[`drop${i}ItemId`] = "";
    values[`drop${i}Chance`] = 10;
    values[`drop${i}Min`] = 1;
    values[`drop${i}Max`] = 1;
  }
  monster.drops.forEach((d, i) => {
    if (i >= DROP_SLOT_COUNT) return;
    values[`drop${i + 1}ItemId`] = d.itemId;
    values[`drop${i + 1}Chance`] = d.dropChance;
    values[`drop${i + 1}Min`] = d.minQuantity;
    values[`drop${i + 1}Max`] = d.maxQuantity;
  });
  return values;
}

export async function renderMonstersPage(container: HTMLElement) {
  let editingId: string | null = null;

  const heading = document.createElement("h2");
  heading.textContent = "Monsters";
  container.appendChild(heading);

  const formHeading = document.createElement("h3");
  const formSection = document.createElement("div");
  const tableSection = document.createElement("div");
  container.append(formHeading, formSection, tableSection);

  const items = await api.listItems();
  const itemNameById = new Map(items.map((i) => [i.id, i.name]));
  const fields = buildFields(items);

  function renderFormSection(initial: Record<string, string | number>) {
    formHeading.textContent = editingId ? "Edit Monster" : "New Monster";
    formSection.innerHTML = "";

    renderForm(
      formSection,
      fields,
      initial,
      async (values) => {
        try {
          const input = toInput(values);
          if (editingId) {
            await api.updateMonster(editingId, input);
          } else {
            await api.createMonster(input);
          }
          editingId = null;
          await refresh();
        } catch (err) {
          alert(err instanceof Error ? err.message : String(err));
        }
      },
      editingId ? "Update" : "Create",
    );

    if (editingId) {
      const cancelBtn = document.createElement("button");
      cancelBtn.textContent = "Cancel";
      cancelBtn.addEventListener("click", () => {
        editingId = null;
        renderFormSection(DEFAULT_VALUES);
      });
      formSection.appendChild(cancelBtn);
    }
  }

  async function refresh() {
    renderFormSection(DEFAULT_VALUES);
    const list = await api.listMonsters();
    tableSection.innerHTML = "";
    renderTable<MonsterTemplateDTO>(
      tableSection,
      [
        { key: "name", label: "Name" },
        { key: "maxHp", label: "Max HP" },
        { key: "aggroRange", label: "Aggro Range" },
        { key: "chaseSpeed", label: "Chase Speed" },
        { key: "touchDamage", label: "Touch Dmg" },
        { key: "level", label: "Level" },
        { key: "armor", label: "Armor" },
        { key: "xpReward", label: "XP Reward" },
        {
          key: "drops",
          label: "Drops",
          format: (_v, row) =>
            row.drops.length === 0
              ? "—"
              : row.drops.map((d) => `${itemNameById.get(d.itemId) ?? d.itemId} (${d.dropChance}%)`).join(", "),
        },
      ],
      list,
      [
        {
          label: "Edit",
          onClick: (row) => {
            editingId = row.id;
            renderFormSection(monsterToFormValues(row));
          },
        },
        {
          label: "Delete",
          className: "danger",
          onClick: async (row) => {
            if (confirm(`Delete monster "${row.name}"?`)) {
              await api.deleteMonster(row.id);
              await refresh();
            }
          },
        },
      ],
    );
  }

  await refresh();
}
