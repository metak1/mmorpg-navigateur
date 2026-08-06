import type { SpellTemplateDTO, SpellTemplateInput, SpellKind } from "shared";
import { api } from "../api.js";
import { renderForm, renderTable, type FieldSpec } from "../ui.js";

const FIELDS: FieldSpec[] = [
  {
    name: "keybind",
    label: "Keybind",
    type: "select",
    options: [1, 2, 3, 4, 5].map((n) => ({ value: String(n), label: String(n) })),
  },
  { name: "name", label: "Name", type: "text" },
  {
    name: "kind",
    label: "Kind",
    type: "select",
    options: [
      { value: "single", label: "Single-target" },
      { value: "aoe", label: "AOE" },
      { value: "heal", label: "Heal (self)" },
      { value: "slow", label: "Slow/Root" },
    ],
  },
  { name: "cooldownMs", label: "Cooldown (ms)", type: "number" },
  { name: "color", label: "Color (hex, e.g. 0xffee55)", type: "text" },
  { name: "size", label: "Projectile Size (px)", type: "number" },
  { name: "damage", label: "Damage", type: "number" },
  { name: "projectileSpeed", label: "Projectile Speed (px/s)", type: "number" },
  { name: "maxRange", label: "Max Range (px)", type: "number" },
  { name: "aoeRadius", label: "AOE Radius (px)", type: "number" },
  { name: "slowMultiplier", label: "Slow Multiplier (0-1)", type: "number", step: "0.05" },
  { name: "slowDurationMs", label: "Slow Duration (ms)", type: "number" },
  { name: "healAmount", label: "Heal Amount", type: "number" },
];

const DEFAULT_VALUES: Record<string, string | number> = {
  keybind: 1,
  name: "New Spell",
  kind: "single",
  cooldownMs: 500,
  color: "0xffee55",
  size: 6,
  damage: 15,
  projectileSpeed: 400,
  maxRange: 400,
  aoeRadius: 0,
  slowMultiplier: 0.2,
  slowDurationMs: 3000,
  healAmount: 0,
};

function toInput(values: Record<string, string>): SpellTemplateInput {
  const kind = values.kind as SpellKind;
  const num = (key: string): number | null => (values[key] === "" ? null : Number(values[key]));

  return {
    keybind: Number(values.keybind),
    name: values.name,
    kind,
    cooldownMs: Number(values.cooldownMs),
    color: Number(values.color),
    size: Number(values.size),
    damage: kind === "heal" ? null : num("damage"),
    projectileSpeed: kind === "heal" ? null : num("projectileSpeed"),
    maxRange: kind === "heal" ? null : num("maxRange"),
    aoeRadius: kind === "aoe" ? num("aoeRadius") : null,
    slowMultiplier: kind === "slow" ? num("slowMultiplier") : null,
    slowDurationMs: kind === "slow" ? num("slowDurationMs") : null,
    healAmount: kind === "heal" ? num("healAmount") : null,
  };
}

function updateFieldVisibility(form: HTMLFormElement) {
  const kindSelect = form.querySelector<HTMLSelectElement>('[name="kind"]');
  const kind = kindSelect?.value;

  const setVisible = (name: string, visible: boolean) => {
    const el = form.querySelector<HTMLElement>(`[data-field="${name}"]`);
    if (el) el.style.display = visible ? "" : "none";
  };

  setVisible("damage", kind !== "heal");
  setVisible("projectileSpeed", kind !== "heal");
  setVisible("maxRange", kind !== "heal");
  setVisible("aoeRadius", kind === "aoe");
  setVisible("slowMultiplier", kind === "slow");
  setVisible("slowDurationMs", kind === "slow");
  setVisible("healAmount", kind === "heal");
}

export async function renderSpellsPage(container: HTMLElement) {
  let editingId: string | null = null;

  const heading = document.createElement("h2");
  heading.textContent = "Spells";
  container.appendChild(heading);

  const formHeading = document.createElement("h3");
  const formSection = document.createElement("div");
  const tableSection = document.createElement("div");
  container.append(formHeading, formSection, tableSection);

  function renderFormSection(initial: Record<string, string | number>) {
    formHeading.textContent = editingId ? "Edit Spell" : "New Spell";
    formSection.innerHTML = "";

    const form = renderForm(
      formSection,
      FIELDS,
      initial,
      async (values) => {
        try {
          const input = toInput(values);
          if (editingId) {
            await api.updateSpell(editingId, input);
          } else {
            await api.createSpell(input);
          }
          editingId = null;
          await refresh();
        } catch (err) {
          alert(err instanceof Error ? err.message : String(err));
        }
      },
      editingId ? "Update" : "Create",
    );

    form.querySelector<HTMLSelectElement>('[name="kind"]')?.addEventListener("change", () => updateFieldVisibility(form));
    updateFieldVisibility(form);

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
    const list = await api.listSpells();
    tableSection.innerHTML = "";
    renderTable<SpellTemplateDTO>(
      tableSection,
      [
        { key: "keybind", label: "Key" },
        { key: "name", label: "Name" },
        { key: "kind", label: "Kind" },
        { key: "cooldownMs", label: "Cooldown (ms)" },
        { key: "damage", label: "Damage" },
      ],
      list,
      [
        {
          label: "Edit",
          onClick: (row) => {
            editingId = row.id;
            renderFormSection({
              keybind: row.keybind,
              name: row.name,
              kind: row.kind,
              cooldownMs: row.cooldownMs,
              color: `0x${row.color.toString(16)}`,
              size: row.size,
              damage: row.damage ?? "",
              projectileSpeed: row.projectileSpeed ?? "",
              maxRange: row.maxRange ?? "",
              aoeRadius: row.aoeRadius ?? "",
              slowMultiplier: row.slowMultiplier ?? "",
              slowDurationMs: row.slowDurationMs ?? "",
              healAmount: row.healAmount ?? "",
            });
          },
        },
        {
          label: "Delete",
          className: "danger",
          onClick: async (row) => {
            if (confirm(`Delete spell "${row.name}"?`)) {
              await api.deleteSpell(row.id);
              await refresh();
            }
          },
        },
      ],
    );
  }

  await refresh();
}
