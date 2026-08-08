import type { NpcTemplateDTO, NpcTemplateInput } from "shared";
import { api } from "../api.js";
import { renderForm, renderTable, type FieldSpec } from "../ui.js";

const FIELDS: FieldSpec[] = [
  { name: "name", label: "Name", type: "text" },
  { name: "color", label: "Color (hex, e.g. 0xffcc66)", type: "text" },
];

const DEFAULT_VALUES: Record<string, string | number> = {
  name: "New NPC",
  color: "0xffcc66",
};

function toInput(values: Record<string, string>): NpcTemplateInput {
  return {
    name: values.name,
    color: Number(values.color),
  };
}

export async function renderNpcsPage(container: HTMLElement) {
  let editingId: string | null = null;

  const heading = document.createElement("h2");
  heading.textContent = "NPCs";
  container.appendChild(heading);

  const formHeading = document.createElement("h3");
  const formSection = document.createElement("div");
  const tableSection = document.createElement("div");
  container.append(formHeading, formSection, tableSection);

  function renderFormSection(initial: Record<string, string | number>) {
    formHeading.textContent = editingId ? "Edit NPC" : "New NPC";
    formSection.innerHTML = "";

    renderForm(
      formSection,
      FIELDS,
      initial,
      async (values) => {
        try {
          const input = toInput(values);
          if (editingId) {
            await api.updateNpc(editingId, input);
          } else {
            await api.createNpc(input);
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
    const list = await api.listNpcs();
    tableSection.innerHTML = "";
    renderTable<NpcTemplateDTO>(
      tableSection,
      [
        { key: "name", label: "Name" },
        { key: "color", label: "Color", format: (v) => `#${(v as number).toString(16).padStart(6, "0")}` },
      ],
      list,
      [
        {
          label: "Edit",
          onClick: (row) => {
            editingId = row.id;
            renderFormSection({ name: row.name, color: `0x${row.color.toString(16)}` });
          },
        },
        {
          label: "Delete",
          className: "danger",
          onClick: async (row) => {
            if (confirm(`Delete NPC "${row.name}"? Quests referencing it will also need updating.`)) {
              await api.deleteNpc(row.id);
              await refresh();
            }
          },
        },
      ],
    );
  }

  await refresh();
}
