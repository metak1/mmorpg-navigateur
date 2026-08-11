import type { ItemSlotType } from "shared";

// One emoji glyph per equipment slot category, shown inside each square
// bag/equipment tile. ItemTemplate has no icon/image field of its own yet
// (see shared/src/api-types.ts's ItemTemplateDTO — just a color swatch), so
// this is a category-level stand-in, the same idea as SPELL_KIND_ICON_KEYS
// (one icon per spell kind, not per spell) — every item at least gets a
// recognizable square icon instead of a bare text row.
const SLOT_TYPE_ICONS: Record<ItemSlotType, string> = {
  helmet: "🪖",
  chest: "👕",
  spalders: "🎽",
  gloves: "🧤",
  boots: "🥾",
  legs: "👖",
  amulet: "📿",
  ring: "💍",
  trinket: "🔮",
};

// Non-equippable items (quest/misc — slotType null) get a generic icon.
const MISC_ITEM_ICON = "📦";

export function iconForSlotType(slotType: ItemSlotType | null): string {
  return slotType ? SLOT_TYPE_ICONS[slotType] : MISC_ITEM_ICON;
}
