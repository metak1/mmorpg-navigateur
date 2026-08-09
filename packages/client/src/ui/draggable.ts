// Wires pointer-drag repositioning onto a fixed-position DOM panel, with
// its dragged position persisted to localStorage so it survives reloads —
// shared by every free-floating game-view overlay (PartyFrames,
// DungeonObjectives) rather than each keeping its own copy of this logic.
// The panel must already be `position: fixed`; this only ever writes its
// left/top.
export function makeDraggable(
  panel: HTMLElement,
  handle: HTMLElement,
  storageKey: string,
  defaultPosition: { x: number; y: number },
) {
  let dragging = false;
  let dragOffsetX = 0;
  let dragOffsetY = 0;

  function loadPosition(): { x: number; y: number } {
    try {
      const raw = localStorage.getItem(storageKey);
      if (raw) {
        const parsed = JSON.parse(raw) as { x?: unknown; y?: unknown };
        if (typeof parsed.x === "number" && typeof parsed.y === "number") return { x: parsed.x, y: parsed.y };
      }
    } catch {
      // Malformed/unavailable storage — fall through to the default.
    }
    return defaultPosition;
  }

  function setPosition(x: number, y: number) {
    // Clamped so a drag ending near an edge (or a smaller window than when
    // the position was saved) can't leave the panel unreachable off-screen.
    const clampedX = Math.min(Math.max(x, 0), Math.max(0, window.innerWidth - 60));
    const clampedY = Math.min(Math.max(y, 0), Math.max(0, window.innerHeight - 40));
    panel.style.left = `${clampedX}px`;
    panel.style.top = `${clampedY}px`;
  }

  const initial = loadPosition();
  setPosition(initial.x, initial.y);

  handle.addEventListener("pointerdown", (event) => {
    dragging = true;
    const rect = panel.getBoundingClientRect();
    dragOffsetX = event.clientX - rect.left;
    dragOffsetY = event.clientY - rect.top;
    event.preventDefault();
  });
  window.addEventListener("pointermove", (event) => {
    if (!dragging) return;
    setPosition(event.clientX - dragOffsetX, event.clientY - dragOffsetY);
  });
  window.addEventListener("pointerup", () => {
    if (!dragging) return;
    dragging = false;
    const rect = panel.getBoundingClientRect();
    localStorage.setItem(storageKey, JSON.stringify({ x: rect.left, y: rect.top }));
  });
}
