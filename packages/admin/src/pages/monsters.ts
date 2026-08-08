import type { MonsterTemplateDTO, MonsterTemplateInput } from "shared";
import { api } from "../api.js";
import { renderForm, renderTable, type FieldSpec } from "../ui.js";

const FIELDS: FieldSpec[] = [
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

const DEFAULT_VALUES: MonsterTemplateInput = {
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

function toInput(values: Record<string, string>): MonsterTemplateInput {
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
  };
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

  function renderFormSection(initial: Record<string, string | number>) {
    formHeading.textContent = editingId ? "Edit Monster" : "New Monster";
    formSection.innerHTML = "";

    renderForm(
      formSection,
      FIELDS,
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
      ],
      list,
      [
        {
          label: "Edit",
          onClick: (row) => {
            editingId = row.id;
            renderFormSection(row as unknown as Record<string, string | number>);
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
