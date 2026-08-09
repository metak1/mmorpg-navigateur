import type {
  ClassTemplateDTO,
  ClassTemplateInput,
  MonsterTemplateDTO,
  MonsterTemplateInput,
  SpellTemplateDTO,
  SpellTemplateInput,
  GameMapDTO,
  GameMapInput,
  MapTileDTO,
  AccountDTO,
  AuthResponse,
  NpcTemplateDTO,
  NpcTemplateInput,
  ItemTemplateDTO,
  ItemTemplateInput,
  QuestDTO,
  QuestInput,
  TalentTemplateDTO,
  TalentTemplateInput,
} from "shared";
import { getToken, clearToken } from "./auth.js";

const API_BASE = import.meta.env.VITE_API_URL ?? "http://localhost:2567";

// Deliberately not routed through request() below — that helper's 401
// handling assumes an already-authenticated session that just expired,
// which is the wrong semantic for a fresh login attempt that never had a
// token to begin with.
export async function login(username: string, password: string): Promise<AuthResponse> {
  const res = await fetch(`${API_BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
  const body = (await res.json().catch(() => ({}))) as AuthResponse & { error?: string };
  if (!res.ok) {
    throw new Error(body.error ?? `Request failed: ${res.status}`);
  }
  return body;
}

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const token = getToken();
  const res = await fetch(`${API_BASE}${path}`, {
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...options,
  });

  if (res.status === 401) {
    clearToken();
    window.dispatchEvent(new Event("admin-unauthorized"));
    throw new Error("Session expired — please log in again.");
  }

  if (!res.ok) {
    const body = await res.json().catch(() => ({}) as { error?: string });
    throw new Error(body.error ?? `Request failed: ${res.status}`);
  }

  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

export const api = {
  me: () => request<AccountDTO>("/api/auth/me"),

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
  getMapTiles: (mapId: string, minCol: number, minRow: number, maxCol: number, maxRow: number) =>
    request<MapTileDTO[]>(`/api/maps/${mapId}/tiles?minCol=${minCol}&minRow=${minRow}&maxCol=${maxCol}&maxRow=${maxRow}`),
  putMapTiles: (mapId: string, tiles: MapTileDTO[]) =>
    request<void>(`/api/maps/${mapId}/tiles`, { method: "PUT", body: JSON.stringify({ tiles }) }),

  listNpcs: () => request<NpcTemplateDTO[]>("/api/npcs"),
  createNpc: (data: NpcTemplateInput) => request<NpcTemplateDTO>("/api/npcs", { method: "POST", body: JSON.stringify(data) }),
  updateNpc: (id: string, data: NpcTemplateInput) =>
    request<NpcTemplateDTO>(`/api/npcs/${id}`, { method: "PUT", body: JSON.stringify(data) }),
  deleteNpc: (id: string) => request<void>(`/api/npcs/${id}`, { method: "DELETE" }),

  listItems: () => request<ItemTemplateDTO[]>("/api/items"),
  createItem: (data: ItemTemplateInput) =>
    request<ItemTemplateDTO>("/api/items", { method: "POST", body: JSON.stringify(data) }),
  updateItem: (id: string, data: ItemTemplateInput) =>
    request<ItemTemplateDTO>(`/api/items/${id}`, { method: "PUT", body: JSON.stringify(data) }),
  deleteItem: (id: string) => request<void>(`/api/items/${id}`, { method: "DELETE" }),

  listQuests: () => request<QuestDTO[]>("/api/quests"),
  createQuest: (data: QuestInput) => request<QuestDTO>("/api/quests", { method: "POST", body: JSON.stringify(data) }),
  updateQuest: (id: string, data: QuestInput) =>
    request<QuestDTO>(`/api/quests/${id}`, { method: "PUT", body: JSON.stringify(data) }),
  deleteQuest: (id: string) => request<void>(`/api/quests/${id}`, { method: "DELETE" }),

  listTalents: () => request<TalentTemplateDTO[]>("/api/talents"),
  createTalent: (data: TalentTemplateInput) =>
    request<TalentTemplateDTO>("/api/talents", { method: "POST", body: JSON.stringify(data) }),
  updateTalent: (id: string, data: TalentTemplateInput) =>
    request<TalentTemplateDTO>(`/api/talents/${id}`, { method: "PUT", body: JSON.stringify(data) }),
  deleteTalent: (id: string) => request<void>(`/api/talents/${id}`, { method: "DELETE" }),
};
