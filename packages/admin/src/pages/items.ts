import type { ItemTemplateDTO, ItemTemplateInput, ItemSlotType, ItemRarity } from "shared";
import { api } from "../api.js";
import { renderForm, renderTable, type FieldSpec } from "../ui.js";

const SLOT_TYPE_OPTIONS: Array<{ value: string; label: string }> = [
  { value: "", label: "-- not equippable (quest/misc item) --" },
  { value: "helmet", label: "Helmet" },
  { value: "gloves", label: "Gloves" },
  { value: "chest", label: "Chest" },
  { value: "spalders", label: "Spalders" },
  { value: "boots", label: "Boots" },
  { value: "legs", label: "Legs" },
  { value: "amulet", label: "Amulet" },
  { value: "ring", label: "Ring (either ring slot)" },
  { value: "trinket", label: "Trinket (either trinket slot)" },
];

const FIELDS: FieldSpec[] = [
  { name: "name", label: "Name", type: "text" },
  { name: "description", label: "Description", type: "text" },
  { name: "color", label: "Color (hex, e.g. 0x66ccff)", type: "text" },
  { name: "slotType", label: "Equipment Slot", type: "select", options: SLOT_TYPE_OPTIONS },
  {
    name: "rarity",
    label: "Rarity",
    type: "select",
    options: [
      { value: "common", label: "Common" },
      { value: "rare", label: "Rare" },
      { value: "epic", label: "Epic" },
      { value: "legendary", label: "Legendary" },
    ],
  },
  { name: "bonusArmor", label: "Bonus Armor", type: "number" },
  { name: "bonusStrength", label: "Bonus Strength", type: "number" },
  { name: "bonusIntelligence", label: "Bonus Intelligence", type: "number" },
  { name: "bonusDexterity", label: "Bonus Dexterity", type: "number" },
  { name: "bonusCriticalChance", label: "Bonus Crit Chance (%)", type: "number" },
  { name: "bonusHp", label: "Bonus HP", type: "number" },
];

const DEFAULT_VALUES: Record<string, string | number> = {
  name: "New Item",
  description: "",
  color: "0x66ccff",
  slotType: "",
  rarity: "common",
  bonusArmor: 0,
  bonusStrength: 0,
  bonusIntelligence: 0,
  bonusDexterity: 0,
  bonusCriticalChance: 0,
  bonusHp: 0,
};

function toInput(values: Record<string, string>): ItemTemplateInput {
  return {
    name: values.name,
    description: values.description,
    color: Number(values.color),
    slotType: (values.slotType || null) as ItemSlotType | null,
    rarity: values.rarity as ItemRarity,
    bonusArmor: Number(values.bonusArmor) || 0,
    bonusStrength: Number(values.bonusStrength) || 0,
    bonusIntelligence: Number(values.bonusIntelligence) || 0,
    bonusDexterity: Number(values.bonusDexterity) || 0,
    bonusCriticalChance: Number(values.bonusCriticalChance) || 0,
    bonusHp: Number(values.bonusHp) || 0,
  };
}

export async function renderItemsPage(container: HTMLElement) {
  let editingId: string | null = null;

  const heading = document.createElement("h2");
  heading.textContent = "Items";
  container.appendChild(heading);

  const formHeading = document.createElement("h3");
  const formSection = document.createElement("div");
  const tableSection = document.createElement("div");
  container.append(formHeading, formSection, tableSection);

  function renderFormSection(initial: Record<string, string | number>) {
    formHeading.textContent = editingId ? "Edit Item" : "New Item";
    formSection.innerHTML = "";

    renderForm(
      formSection,
      FIELDS,
      initial,
      async (values) => {
        try {
          const input = toInput(values);
          if (editingId) {
            await api.updateItem(editingId, input);
          } else {
            await api.createItem(input);
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
    const list = await api.listItems();
    tableSection.innerHTML = "";
    renderTable<ItemTemplateDTO>(
      tableSection,
      [
        { key: "name", label: "Name" },
        { key: "rarity", label: "Rarity", format: (v) => (v as ItemRarity).toUpperCase() },
        { key: "slotType", label: "Slot", format: (v) => (v as string | null) ?? "—" },
        { key: "color", label: "Color", format: (v) => `#${(v as number).toString(16).padStart(6, "0")}` },
        {
          key: "bonusArmor",
          label: "Bonuses",
          format: (_v, row) => {
            const parts: string[] = [];
            if (row.bonusArmor) parts.push(`${row.bonusArmor} armor`);
            if (row.bonusStrength) parts.push(`${row.bonusStrength} str`);
            if (row.bonusIntelligence) parts.push(`${row.bonusIntelligence} int`);
            if (row.bonusDexterity) parts.push(`${row.bonusDexterity} dex`);
            if (row.bonusCriticalChance) parts.push(`${row.bonusCriticalChance}% crit`);
            if (row.bonusHp) parts.push(`${row.bonusHp} hp`);
            return parts.join(", ") || "—";
          },
        },
      ],
      list,
      [
        {
          label: "Edit",
          onClick: (row) => {
            editingId = row.id;
            renderFormSection({
              name: row.name,
              description: row.description,
              color: `0x${row.color.toString(16)}`,
              slotType: row.slotType ?? "",
              rarity: row.rarity,
              bonusArmor: row.bonusArmor,
              bonusStrength: row.bonusStrength,
              bonusIntelligence: row.bonusIntelligence,
              bonusDexterity: row.bonusDexterity,
              bonusCriticalChance: row.bonusCriticalChance,
              bonusHp: row.bonusHp,
            });
          },
        },
        {
          label: "Delete",
          className: "danger",
          onClick: async (row) => {
            if (confirm(`Delete item "${row.name}"?`)) {
              await api.deleteItem(row.id);
              await refresh();
            }
          },
        },
      ],
    );
  }

  await refresh();
}
