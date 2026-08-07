import type { ActiveMapResponse, SpellTemplateDTO, ClassTemplateDTO } from "shared";

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
