import type { QuestDTO, QuestInput, QuestObjectiveType, NpcTemplateDTO, MonsterTemplateDTO, ItemTemplateDTO } from "shared";
import { api } from "../api.js";
import { renderForm, renderTable, type FieldSpec } from "../ui.js";

const REWARD_SLOT_COUNT = 3;

function buildFields(npcs: NpcTemplateDTO[], monsters: MonsterTemplateDTO[], items: ItemTemplateDTO[]): FieldSpec[] {
  const npcOptions = npcs.map((n) => ({ value: n.id, label: n.name }));
  const monsterOptions = monsters.map((m) => ({ value: m.id, label: m.name }));
  const itemOptions = items.map((i) => ({ value: i.id, label: i.name }));
  const itemOptionsWithNone = [{ value: "", label: "-- none --" }, ...itemOptions];

  const fields: FieldSpec[] = [
    { name: "title", label: "Title", type: "text" },
    { name: "description", label: "Description", type: "text" },
    { name: "giverNpcId", label: "Given by NPC", type: "select", options: npcOptions },
    {
      name: "objectiveType",
      label: "Objective",
      type: "select",
      options: [
        { value: "talkToNpc", label: "Talk to NPC" },
        { value: "killMonsters", label: "Kill monsters" },
        { value: "bringItems", label: "Bring item(s)" },
      ],
    },
    { name: "targetNpcId", label: "Talk to (NPC)", type: "select", options: npcOptions },
    { name: "monsterTemplateId", label: "Monster to kill", type: "select", options: monsterOptions },
    { name: "itemId", label: "Item to bring", type: "select", options: itemOptions },
    { name: "requiredCount", label: "Required count", type: "number" },
    { name: "rewardXp", label: "Reward XP", type: "number" },
  ];

  for (let i = 1; i <= REWARD_SLOT_COUNT; i++) {
    fields.push({ name: `rewardItem${i}Id`, label: `Reward item ${i}`, type: "select", options: itemOptionsWithNone });
    fields.push({ name: `rewardItem${i}Qty`, label: `Reward item ${i} qty`, type: "number" });
  }

  return fields;
}

const DEFAULT_VALUES: Record<string, string | number> = {
  title: "New Quest",
  description: "",
  giverNpcId: "",
  objectiveType: "talkToNpc",
  targetNpcId: "",
  monsterTemplateId: "",
  itemId: "",
  requiredCount: 1,
  rewardXp: 50,
  rewardItem1Id: "",
  rewardItem1Qty: 1,
  rewardItem2Id: "",
  rewardItem2Qty: 1,
  rewardItem3Id: "",
  rewardItem3Qty: 1,
};

function toInput(values: Record<string, string>): QuestInput {
  const objectiveType = values.objectiveType as QuestObjectiveType;
  const rewardItems: QuestInput["rewardItems"] = [];
  for (let i = 1; i <= REWARD_SLOT_COUNT; i++) {
    const itemId = values[`rewardItem${i}Id`];
    if (!itemId) continue;
    rewardItems.push({ itemId, quantity: Number(values[`rewardItem${i}Qty`]) || 1 });
  }

  return {
    title: values.title,
    description: values.description,
    giverNpcId: values.giverNpcId,
    objectiveType,
    targetNpcId: objectiveType === "talkToNpc" ? values.targetNpcId || null : null,
    monsterTemplateId: objectiveType === "killMonsters" ? values.monsterTemplateId || null : null,
    itemId: objectiveType === "bringItems" ? values.itemId || null : null,
    requiredCount: Number(values.requiredCount) || 1,
    rewardXp: Number(values.rewardXp) || 0,
    rewardItems,
  };
}

function questToFormValues(quest: QuestDTO): Record<string, string | number> {
  const values: Record<string, string | number> = {
    title: quest.title,
    description: quest.description,
    giverNpcId: quest.giverNpcId,
    objectiveType: quest.objectiveType,
    targetNpcId: quest.targetNpcId ?? "",
    monsterTemplateId: quest.monsterTemplateId ?? "",
    itemId: quest.itemId ?? "",
    requiredCount: quest.requiredCount,
    rewardXp: quest.rewardXp,
  };
  quest.rewardItems.forEach((r, i) => {
    if (i >= REWARD_SLOT_COUNT) return;
    values[`rewardItem${i + 1}Id`] = r.itemId;
    values[`rewardItem${i + 1}Qty`] = r.quantity;
  });
  return values;
}

function updateFieldVisibility(form: HTMLFormElement) {
  const objectiveType = form.querySelector<HTMLSelectElement>('[name="objectiveType"]')?.value;

  const setVisible = (name: string, visible: boolean) => {
    const el = form.querySelector<HTMLElement>(`[data-field="${name}"]`);
    if (el) el.style.display = visible ? "" : "none";
  };

  setVisible("targetNpcId", objectiveType === "talkToNpc");
  setVisible("monsterTemplateId", objectiveType === "killMonsters");
  setVisible("itemId", objectiveType === "bringItems");
  setVisible("requiredCount", objectiveType === "killMonsters" || objectiveType === "bringItems");
}

export async function renderQuestsPage(container: HTMLElement) {
  let editingId: string | null = null;

  const heading = document.createElement("h2");
  heading.textContent = "Quests";
  container.appendChild(heading);

  const formHeading = document.createElement("h3");
  const formSection = document.createElement("div");
  const tableSection = document.createElement("div");
  container.append(formHeading, formSection, tableSection);

  const [npcs, monsters, items] = await Promise.all([api.listNpcs(), api.listMonsters(), api.listItems()]);
  const npcNameById = new Map(npcs.map((n) => [n.id, n.name]));
  const fields = buildFields(npcs, monsters, items);

  function renderFormSection(initial: Record<string, string | number>) {
    formHeading.textContent = editingId ? "Edit Quest" : "New Quest";
    formSection.innerHTML = "";

    if (npcs.length === 0) {
      formSection.textContent = "Create at least one NPC first — quests need a giver.";
      return;
    }

    const form = renderForm(
      formSection,
      fields,
      initial,
      async (values) => {
        try {
          const input = toInput(values);
          if (editingId) {
            await api.updateQuest(editingId, input);
          } else {
            await api.createQuest(input);
          }
          editingId = null;
          await refresh();
        } catch (err) {
          alert(err instanceof Error ? err.message : String(err));
        }
      },
      editingId ? "Update" : "Create",
    );

    form.querySelector<HTMLSelectElement>('[name="objectiveType"]')?.addEventListener("change", () => updateFieldVisibility(form));
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
    const list = await api.listQuests();
    tableSection.innerHTML = "";
    renderTable<QuestDTO>(
      tableSection,
      [
        { key: "title", label: "Title" },
        { key: "giverNpcId", label: "Giver", format: (v) => npcNameById.get(v as string) ?? (v as string) },
        { key: "objectiveType", label: "Objective" },
        { key: "requiredCount", label: "Count" },
        { key: "rewardXp", label: "XP" },
      ],
      list,
      [
        {
          label: "Edit",
          onClick: (row) => {
            editingId = row.id;
            renderFormSection(questToFormValues(row));
          },
        },
        {
          label: "Delete",
          className: "danger",
          onClick: async (row) => {
            if (confirm(`Delete quest "${row.title}"?`)) {
              await api.deleteQuest(row.id);
              await refresh();
            }
          },
        },
      ],
    );
  }

  await refresh();
}
