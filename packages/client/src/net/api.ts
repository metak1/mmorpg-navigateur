import type { ActiveMapResponse, SpellTemplateDTO, ClassTemplateDTO, AccountDTO, AuthResponse, CharacterDTO } from "shared";

const SERVER_URL = import.meta.env.VITE_SERVER_URL ?? "ws://localhost:2567";
const API_BASE_URL = SERVER_URL.replace(/^ws/, "http");

export async function fetchActiveMap(): Promise<ActiveMapResponse> {
  const response = await fetch(`${API_BASE_URL}/api/maps/active`);
  if (!response.ok) {
    throw new Error(`Failed to fetch active map: ${response.status}`);
  }
  return response.json() as Promise<ActiveMapResponse>;
}

export async function fetchSpells(): Promise<SpellTemplateDTO[]> {
  const response = await fetch(`${API_BASE_URL}/api/spells`);
  if (!response.ok) {
    throw new Error(`Failed to fetch spells: ${response.status}`);
  }
  return response.json() as Promise<SpellTemplateDTO[]>;
}

export async function fetchClasses(): Promise<ClassTemplateDTO[]> {
  const response = await fetch(`${API_BASE_URL}/api/classes`);
  if (!response.ok) {
    throw new Error(`Failed to fetch classes: ${response.status}`);
  }
  return response.json() as Promise<ClassTemplateDTO[]>;
}

async function authRequest(path: string, body: unknown): Promise<AuthResponse> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = (await response.json().catch(() => ({}))) as AuthResponse & { error?: string };
  if (!response.ok) {
    throw new Error(data.error ?? `Request failed: ${response.status}`);
  }
  return data;
}

export const login = (username: string, password: string) =>
  authRequest("/api/auth/login", { username, password });

export const register = (username: string, password: string) =>
  authRequest("/api/auth/register", { username, password });

export async function fetchMe(token: string): Promise<AccountDTO | null> {
  const response = await fetch(`${API_BASE_URL}/api/auth/me`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!response.ok) return null;
  return response.json() as Promise<AccountDTO>;
}

export async function fetchCharacters(token: string): Promise<CharacterDTO[]> {
  const response = await fetch(`${API_BASE_URL}/api/characters`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!response.ok) {
    throw new Error(`Failed to fetch characters: ${response.status}`);
  }
  return response.json() as Promise<CharacterDTO[]>;
}

export async function createCharacter(token: string, name: string, className: string): Promise<CharacterDTO> {
  const response = await fetch(`${API_BASE_URL}/api/characters`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ name, className }),
  });
  const data = (await response.json().catch(() => ({}))) as CharacterDTO & { error?: string };
  if (!response.ok) {
    throw new Error(data.error ?? `Request failed: ${response.status}`);
  }
  return data;
}
