import Phaser from "phaser";
import { GLOBAL_COOLDOWN_MS, type SpellDef, type SpellId } from "shared";

const HP_BAR_X = 16;
const HP_BAR_BOTTOM_MARGIN = 40; // distance from the bottom edge to the bar's vertical center
const HP_BAR_WIDTH = 220;
const HP_BAR_HEIGHT = 22;

const SLOT_SIZE = 48;
const SLOT_GAP = 8;
const SLOT_ICON_SIZE = SLOT_SIZE - 4;
const SLOT_BOTTOM_MARGIN = 64; // distance from the bottom edge to the slot row's vertical center

const CAST_BAR_WIDTH = 240;
const CAST_BAR_HEIGHT = 14;

type Visible = Phaser.GameObjects.Rectangle | Phaser.GameObjects.Text;

interface SpellSlot {
  icon: Phaser.GameObjects.Rectangle;
  cooldownOverlay: Phaser.GameObjects.Rectangle;
  cooldownText: Phaser.GameObjects.Text;
  cooldownMs: number;
  castTimeMs: number;
  lastCastAt: number;
}

export class Hud {
  private hpBarFill: Phaser.GameObjects.Rectangle;
  private hpText: Phaser.GameObjects.Text;
  private slots = new Map<SpellId, SpellSlot>();
  private castBarFill: Phaser.GameObjects.Rectangle;
  private castBarText: Phaser.GameObjects.Text;
  private castBarParts: Visible[];
  private casting: { spellId: SpellId; startedAt: number; durationMs: number } | null = null;
  private lastGlobalCastAt = -Infinity;

  constructor(
    scene: Phaser.Scene,
    order: Array<{ spellId: SpellId; keyLabel: string }>,
    onSlotClick?: (spellId: SpellId) => void,
  ) {
    const hpBarY = scene.scale.height - HP_BAR_BOTTOM_MARGIN;
    const slotY = scene.scale.height - SLOT_BOTTOM_MARGIN;

    scene.add
      .rectangle(HP_BAR_X, hpBarY, HP_BAR_WIDTH, HP_BAR_HEIGHT, 0x222222)
      .setOrigin(0, 0.5)
      .setScrollFactor(0)
      .setDepth(1000);
    this.hpBarFill = scene.add
      .rectangle(HP_BAR_X, hpBarY, HP_BAR_WIDTH, HP_BAR_HEIGHT, 0x33dd55)
      .setOrigin(0, 0.5)
      .setScrollFactor(0)
      .setDepth(1001);
    this.hpText = scene.add
      .text(HP_BAR_X + HP_BAR_WIDTH / 2, hpBarY, "", { fontSize: "13px", color: "#ffffff" })
      .setOrigin(0.5)
      .setScrollFactor(0)
      .setDepth(1002);

    const totalWidth = order.length * SLOT_SIZE + (order.length - 1) * SLOT_GAP;
    const startX = scene.scale.width / 2 - totalWidth / 2;

    order.forEach(({ spellId, keyLabel }, i) => {
      const x = startX + i * (SLOT_SIZE + SLOT_GAP) + SLOT_SIZE / 2;
      const y = slotY + SLOT_SIZE / 2;
      const iconBottom = y + SLOT_ICON_SIZE / 2;

      const icon = scene.add.rectangle(x, y, SLOT_ICON_SIZE, SLOT_ICON_SIZE, 0x444444).setScrollFactor(0).setDepth(1000);
      if (onSlotClick) {
        icon.setInteractive({ useHandCursor: true }).on("pointerdown", (pointer: Phaser.Input.Pointer) => {
          if (pointer.leftButtonDown()) onSlotClick(spellId);
        });
      }
      scene.add
        .rectangle(x, y, SLOT_SIZE, SLOT_SIZE)
        .setStrokeStyle(2, 0xffffff, 0.6)
        .setScrollFactor(0)
        .setDepth(1001);
      const cooldownOverlay = scene.add
        .rectangle(x, iconBottom, SLOT_ICON_SIZE, 0, 0x000000, 0.7)
        .setOrigin(0.5, 1)
        .setScrollFactor(0)
        .setDepth(1002)
        .setVisible(false);
      scene.add
        .text(x - SLOT_SIZE / 2 + 4, y - SLOT_SIZE / 2 + 2, keyLabel, { fontSize: "11px", color: "#ffffff" })
        .setScrollFactor(0)
        .setDepth(1003);
      const cooldownText = scene.add
        .text(x, y, "", { fontSize: "14px", color: "#ffffff" })
        .setOrigin(0.5)
        .setScrollFactor(0)
        .setDepth(1004)
        .setVisible(false);

      this.slots.set(spellId, { icon, cooldownOverlay, cooldownText, cooldownMs: 0, castTimeMs: 0, lastCastAt: -Infinity });
    });

    const castBarY = slotY - 22;
    const castBarBg = scene.add
      .rectangle(scene.scale.width / 2, castBarY, CAST_BAR_WIDTH, CAST_BAR_HEIGHT, 0x111111, 0.8)
      .setScrollFactor(0)
      .setDepth(1000);
    this.castBarFill = scene.add
      .rectangle(scene.scale.width / 2 - CAST_BAR_WIDTH / 2, castBarY, 0, CAST_BAR_HEIGHT, 0xffcc33)
      .setOrigin(0, 0.5)
      .setScrollFactor(0)
      .setDepth(1001);
    this.castBarText = scene.add
      .text(scene.scale.width / 2, castBarY, "", { fontSize: "12px", color: "#ffffff" })
      .setOrigin(0.5)
      .setScrollFactor(0)
      .setDepth(1002);
    this.castBarParts = [castBarBg, this.castBarFill, this.castBarText];
    this.setCastBarVisible(false);
  }

  private setCastBarVisible(visible: boolean) {
    for (const part of this.castBarParts) part.setVisible(visible);
  }

  setHealth(hp: number, maxHp: number) {
    const frac = Math.max(0, hp / maxHp);
    this.hpBarFill.width = HP_BAR_WIDTH * frac;
    this.hpText.setText(`${Math.ceil(Math.max(0, hp))} / ${maxHp}`);
  }

  setSpellDefs(defs: Map<SpellId, SpellDef>) {
    for (const [spellId, slot] of this.slots) {
      const def = defs.get(spellId);
      if (!def) continue;
      slot.cooldownMs = def.cooldownMs;
      slot.castTimeMs = def.castTimeMs;
      slot.icon.setFillStyle(def.color);
    }
  }

  canCast(spellId: SpellId, nowMs: number): boolean {
    if (this.casting) return false;
    if (nowMs - this.lastGlobalCastAt < GLOBAL_COOLDOWN_MS) return false;
    const slot = this.slots.get(spellId);
    if (!slot) return false;
    return nowMs - slot.lastCastAt >= slot.cooldownMs;
  }

  isCasting(): boolean {
    return this.casting !== null;
  }

  getCastingSpellId(): SpellId | null {
    return this.casting?.spellId ?? null;
  }

  // Rolls a slot's cooldown-visual back as if it was never cast — used both
  // when movement interrupts a channel (mirrors the server: an interrupted
  // cast never applies its cooldown) and when the server reports a cast
  // fizzled server-side (e.g. the target died before it landed; see
  // WorldRoom.resolveCastEffect). The GCD is deliberately left untouched in
  // both cases, matching the server.
  cancelCast(spellId: SpellId) {
    const slot = this.slots.get(spellId);
    if (slot) slot.lastCastAt = -Infinity;
    if (this.casting?.spellId === spellId) {
      this.casting = null;
      this.setCastBarVisible(false);
    }
  }

  beginCast(spellId: SpellId, spellName: string, nowMs: number) {
    const slot = this.slots.get(spellId);
    if (!slot) return;
    // Unlike the per-spell cooldown, the GCD is never rolled back by
    // cancelCast — it applies the moment a cast is accepted, mirroring the
    // server (see WorldRoom.handleCast).
    this.lastGlobalCastAt = nowMs;
    if (slot.castTimeMs > 0) {
      // Cooldown is applied speculatively here for a responsive hotbar, then
      // rolled back by cancelCast if movement interrupts the channel — same
      // "cooldown only on a completed cast" rule the server enforces.
      slot.lastCastAt = nowMs;
      this.casting = { spellId, startedAt: nowMs, durationMs: slot.castTimeMs };
      this.castBarText.setText(spellName);
      this.castBarFill.width = 0;
      this.setCastBarVisible(true);
    } else {
      slot.lastCastAt = nowMs;
    }
  }

  update(nowMs: number) {
    const gcdRemaining = Math.max(0, GLOBAL_COOLDOWN_MS - (nowMs - this.lastGlobalCastAt));

    for (const slot of this.slots.values()) {
      const ownRemaining = Math.max(0, slot.cooldownMs - (nowMs - slot.lastCastAt));
      const remaining = Math.max(ownRemaining, gcdRemaining);
      // Whichever cooldown is actually the bottleneck right now sets the
      // wipe's timescale — a spell's own long cooldown shouldn't make the
      // brief shared GCD flash look like it takes just as long, or vice versa.
      const frac = ownRemaining >= gcdRemaining ? (slot.cooldownMs > 0 ? ownRemaining / slot.cooldownMs : 0) : gcdRemaining / GLOBAL_COOLDOWN_MS;
      slot.cooldownOverlay.setVisible(frac > 0);
      // setSize (not a direct .height assignment) so Phaser recomputes the
      // origin-based render offset each time — otherwise the bottom-anchor
      // origin silently goes stale and the overlay renders in the wrong place.
      slot.cooldownOverlay.setSize(SLOT_ICON_SIZE, SLOT_ICON_SIZE * frac);
      slot.cooldownText.setVisible(remaining > 50);
      slot.cooldownText.setText(remaining > 0 ? (remaining / 1000).toFixed(1) : "");
    }

    if (this.casting) {
      const elapsed = nowMs - this.casting.startedAt;
      const frac = Math.min(1, elapsed / this.casting.durationMs);
      this.castBarFill.width = CAST_BAR_WIDTH * frac;
      if (frac >= 1) {
        this.casting = null;
        this.setCastBarVisible(false);
      }
    }
  }
}
