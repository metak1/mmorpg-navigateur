import type { ItemTemplateDTO, ItemTemplateInput } from "shared";
import { api } from "../api.js";
import { renderForm, renderTable, type FieldSpec } from "../ui.js";

const FIELDS: FieldSpec[] = [
  { name: "name", label: "Name", type: "text" },
  { name: "description", label: "Description", type: "text" },
  { name: "color", label: "Color (hex, e.g. 0x66ccff)", type: "text" },
];

const DEFAULT_VALUES: Record<string, string | number> = {
  name: "New Item",
  description: "",
  color: "0x66ccff",
};

function toInput(values: Record<string, string>): ItemTemplateInput {
  return {
    name: values.name,
    description: values.description,
    color: Number(values.color),
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
        { key: "description", label: "Description" },
        { key: "color", label: "Color", format: (v) => `#${(v as number).toString(16).padStart(6, "0")}` },
      ],
      list,
      [
        {
          label: "Edit",
          onClick: (row) => {
            editingId = row.id;
            renderFormSection({ name: row.name, description: row.description, color: `0x${row.color.toString(16)}` });
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
