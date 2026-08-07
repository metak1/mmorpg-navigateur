import type {
  ClassTemplateDTO,
  ClassTemplateInput,
  MonsterTemplateDTO,
  MonsterTemplateInput,
  SpellTemplateDTO,
  SpellTemplateInput,
  GameMapDTO,
  GameMapInput,
} from "shared";

const API_BASE = import.meta.env.VITE_API_URL ?? "http://localhost:2567";

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}) as { error?: string });
    throw new Error(body.error ?? `Request failed: ${res.status}`);
  }

  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

export const api = {
  listClasses: () => request<ClassTemplateDTO[]>("/api/classes"),
  createClass: (data: ClassTemplateInput) =>
    request<ClassTemplateDTO>("/api/classes", { method: "POST", body: JSON.stringify(data) }),
  updateClass: (id: string, data: ClassTemplateInput) =>
    request<ClassTemplateDTO>(`/api/classes/${id}`, { method: "PUT", body: JSON.stringify(data) }),
  deleteClass: (id: string) => request<void>(`/api/classes/${id}`, { method: "DELETE" }),

  listMonsters: () => request<MonsterTemplateDTO[]>("/api/monsters"),
  createMonster: (data: MonsterTemplateInput) =>
    request<MonsterTemplateDTO>("/api/monsters", { method: "POST", body: JSON.stringify(data) }),
  updateMonster: (id: string, data: MonsterTemplateInput) =>
    request<MonsterTemplateDTO>(`/api/monsters/${id}`, { method: "PUT", body: JSON.stringify(data) }),
  deleteMonster: (id: string) => request<void>(`/api/monsters/${id}`, { method: "DELETE" }),

  listSpells: () => request<SpellTemplateDTO[]>("/api/spells"),
  createSpell: (data: SpellTemplateInput) =>
    request<SpellTemplateDTO>("/api/spells", { method: "POST", body: JSON.stringify(data) }),
  updateSpell: (id: string, data: SpellTemplateInput) =>
    request<SpellTemplateDTO>(`/api/spells/${id}`, { method: "PUT", body: JSON.stringify(data) }),
  deleteSpell: (id: string) => request<void>(`/api/spells/${id}`, { method: "DELETE" }),

  listMaps: () => request<GameMapDTO[]>("/api/maps"),
  getMap: (id: string) => request<GameMapDTO>(`/api/maps/${id}`),
  createMap: (data: GameMapInput) => request<GameMapDTO>("/api/maps", { method: "POST", body: JSON.stringify(data) }),
  updateMap: (id: string, data: GameMapInput) =>
    request<GameMapDTO>(`/api/maps/${id}`, { method: "PUT", body: JSON.stringify(data) }),
  deleteMap: (id: string) => request<void>(`/api/maps/${id}`, { method: "DELETE" }),
  activateMap: (id: string) => request<void>(`/api/maps/${id}/activate`, { method: "POST" }),
};
