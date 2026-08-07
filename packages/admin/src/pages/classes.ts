import type { ClassTemplateDTO, ClassTemplateInput } from "shared";
import { api } from "../api.js";
import { renderForm, renderTable, type FieldSpec } from "../ui.js";

const FIELDS: FieldSpec[] = [
  { name: "name", label: "Name", type: "text" },
  { name: "color", label: "Color (hex, e.g. 0xdd4444)", type: "text" },
];

const DEFAULT_VALUES: Record<string, string | number> = {
  name: "New Class",
  color: "0xffffff",
};

function toInput(values: Record<string, string>): ClassTemplateInput {
  return {
    name: values.name,
    color: Number(values.color),
  };
}

export async function renderClassesPage(container: HTMLElement) {
  let editingId: string | null = null;

  const heading = document.createElement("h2");
  heading.textContent = "Classes";
  container.appendChild(heading);

  const formHeading = document.createElement("h3");
  const formSection = document.createElement("div");
  const tableSection = document.createElement("div");
  container.append(formHeading, formSection, tableSection);

  function renderFormSection(initial: Record<string, string | number>) {
    formHeading.textContent = editingId ? "Edit Class" : "New Class";
    formSection.innerHTML = "";

    renderForm(
      formSection,
      FIELDS,
      initial,
      async (values) => {
        try {
          const input = toInput(values);
          if (editingId) {
            await api.updateClass(editingId, input);
          } else {
            await api.createClass(input);
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
    const list = await api.listClasses();
    tableSection.innerHTML = "";
    renderTable<ClassTemplateDTO>(
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
            if (confirm(`Delete class "${row.name}"? This also deletes its spells.`)) {
              await api.deleteClass(row.id);
              await refresh();
            }
          },
        },
      ],
    );
  }

  await refresh();
}
