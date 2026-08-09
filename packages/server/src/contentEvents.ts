// In-process pub/sub so admin API mutations (Express routes) can tell any
// running Colyseus rooms to refresh their cached content — spells/monster
// templates are loaded once at room creation for performance, so without
// this an admin edit would only take effect for the *next* room, i.e. after
// a server restart.
export type ContentKind = "spells" | "monsters" | "quests" | "maps" | "talents";
type Listener = (kind: ContentKind) => void;

const listeners = new Set<Listener>();

export function onContentChanged(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function notifyContentChanged(kind: ContentKind) {
  for (const listener of listeners) listener(kind);
}
