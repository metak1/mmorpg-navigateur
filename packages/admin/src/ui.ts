export interface FieldSpec {
  name: string;
  label: string;
  type: "text" | "number" | "select";
  options?: Array<{ value: string; label: string }>;
  step?: string;
}

// Builds a simple form from a field spec list. Each field is wrapped in a
// `[data-field="name"]` div so callers can toggle visibility (e.g. spells'
// kind-conditional fields) after the form is built.
export function renderForm(
  container: HTMLElement,
  fields: FieldSpec[],
  values: Record<string, string | number>,
  onSubmit: (values: Record<string, string>) => void | Promise<void>,
  submitLabel = "Save",
): HTMLFormElement {
  const form = document.createElement("form");
  form.className = "admin-form";

  for (const field of fields) {
    const wrapper = document.createElement("div");
    wrapper.className = "field";
    wrapper.dataset.field = field.name;

    const label = document.createElement("label");
    label.textContent = field.label;

    let input: HTMLInputElement | HTMLSelectElement;
    if (field.type === "select") {
      const select = document.createElement("select");
      select.name = field.name;
      for (const opt of field.options ?? []) {
        const option = document.createElement("option");
        option.value = opt.value;
        option.textContent = opt.label;
        select.appendChild(option);
      }
      input = select;
    } else {
      const inp = document.createElement("input");
      inp.type = field.type;
      inp.name = field.name;
      if (field.step) inp.step = field.step;
      input = inp;
    }

    input.value = String(values[field.name] ?? "");
    label.appendChild(input);
    wrapper.appendChild(label);
    form.appendChild(wrapper);
  }

  const submitBtn = document.createElement("button");
  submitBtn.type = "submit";
  submitBtn.textContent = submitLabel;
  form.appendChild(submitBtn);

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const formData = new FormData(form);
    const collected: Record<string, string> = {};
    for (const [key, value] of formData.entries()) {
      collected[key] = String(value);
    }
    void onSubmit(collected);
  });

  container.appendChild(form);
  return form;
}

export interface TableColumn<T> {
  key: keyof T;
  label: string;
  format?: (value: T[keyof T], row: T) => string;
}

export interface TableAction<T> {
  label: string;
  onClick: (row: T) => void | Promise<void>;
  className?: string;
}

export function renderTable<T>(
  container: HTMLElement,
  columns: TableColumn<T>[],
  rows: T[],
  actions: TableAction<T>[],
): void {
  const table = document.createElement("table");
  table.className = "admin-table";

  const thead = document.createElement("thead");
  const headRow = document.createElement("tr");
  for (const col of columns) {
    const th = document.createElement("th");
    th.textContent = col.label;
    headRow.appendChild(th);
  }
  const actionsTh = document.createElement("th");
  actionsTh.textContent = "Actions";
  headRow.appendChild(actionsTh);
  thead.appendChild(headRow);
  table.appendChild(thead);

  const tbody = document.createElement("tbody");
  for (const row of rows) {
    const tr = document.createElement("tr");
    for (const col of columns) {
      const td = document.createElement("td");
      const raw = row[col.key];
      td.textContent = col.format ? col.format(raw, row) : String(raw ?? "");
      tr.appendChild(td);
    }

    const actionsTd = document.createElement("td");
    for (const action of actions) {
      const btn = document.createElement("button");
      btn.textContent = action.label;
      if (action.className) btn.className = action.className;
      btn.addEventListener("click", () => void action.onClick(row));
      actionsTd.appendChild(btn);
    }
    tr.appendChild(actionsTd);
    tbody.appendChild(tr);
  }
  table.appendChild(tbody);

  container.appendChild(table);
}
