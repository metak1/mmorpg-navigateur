import Phaser from "phaser";
import { GLOBAL_COOLDOWN_MS, UI_DEPTH, type SpellDef, type SpellId } from "shared";
import { SPELL_KIND_ICON_KEYS } from "../assets.js";

const HP_BAR_X = 16;
const HP_BAR_BOTTOM_MARGIN = 40; // distance from the bottom edge to the bar's vertical center
const HP_BAR_WIDTH = 220;
const HP_BAR_HEIGHT = 22;

const LEVEL_BAR_WIDTH = HP_BAR_WIDTH;
const LEVEL_BAR_HEIGHT = 8;
const LEVEL_BAR_GAP = 4; // gap between the bottom of the level text and the top of the HP bar
const LEVEL_TEXT_GAP = 2; // gap between the bottom of the level text and the top of the XP bar

const SLOT_SIZE = 48;
const SLOT_GAP = 8;
const SLOT_ICON_SIZE = SLOT_SIZE - 4;
const SLOT_BOTTOM_MARGIN = 64; // distance from the bottom edge to the slot row's vertical center

const CAST_BAR_WIDTH = 240;
const CAST_BAR_HEIGHT = 14;

type Visible = Phaser.GameObjects.Rectangle | Phaser.GameObjects.Text;

const OUT_OF_RANGE_COLOR = 0xff3333; // matches attackRangeIndicator/groundAoeRangeRing's "blocked" red
const IN_RANGE_BORDER_COLOR = 0xffffff;

interface SpellSlot {
  icon: Phaser.GameObjects.Image;
  border: Phaser.GameObjects.Rectangle;
  cooldownOverlay: Phaser.GameObjects.Rectangle;
  cooldownText: Phaser.GameObjects.Text;
  cooldownMs: number;
  castTimeMs: number;
  lastCastAt: number;
  outOfRange: boolean;
}

export class Hud {
  private hpBarFill: Phaser.GameObjects.Rectangle;
  private hpText: Phaser.GameObjects.Text;
  private levelText: Phaser.GameObjects.Text;
  private xpBarFill: Phaser.GameObjects.Rectangle;
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
      .setDepth(UI_DEPTH);
    this.hpBarFill = scene.add
      .rectangle(HP_BAR_X, hpBarY, HP_BAR_WIDTH, HP_BAR_HEIGHT, 0x33dd55)
      .setOrigin(0, 0.5)
      .setScrollFactor(0)
      .setDepth(UI_DEPTH + 1);
    this.hpText = scene.add
      .text(HP_BAR_X + HP_BAR_WIDTH / 2, hpBarY, "", { fontSize: "13px", color: "#ffffff" })
      .setOrigin(0.5)
      .setScrollFactor(0)
      .setDepth(UI_DEPTH + 2);

    const levelTextY = hpBarY - HP_BAR_HEIGHT / 2 - LEVEL_BAR_GAP - LEVEL_BAR_HEIGHT - LEVEL_TEXT_GAP;
    this.levelText = scene.add
      .text(HP_BAR_X, levelTextY, "Lvl 1", { fontSize: "12px", color: "#ffcc33" })
      .setOrigin(0, 1)
      .setScrollFactor(0)
      .setDepth(UI_DEPTH + 2);

    const xpBarY = hpBarY - HP_BAR_HEIGHT / 2 - LEVEL_BAR_GAP - LEVEL_BAR_HEIGHT / 2;
    scene.add
      .rectangle(HP_BAR_X, xpBarY, LEVEL_BAR_WIDTH, LEVEL_BAR_HEIGHT, 0x222222)
      .setOrigin(0, 0.5)
      .setScrollFactor(0)
      .setDepth(UI_DEPTH);
    this.xpBarFill = scene.add
      .rectangle(HP_BAR_X, xpBarY, 0, LEVEL_BAR_HEIGHT, 0x33aaff)
      .setOrigin(0, 0.5)
      .setScrollFactor(0)
      .setDepth(UI_DEPTH + 1);

    const totalWidth = order.length * SLOT_SIZE + (order.length - 1) * SLOT_GAP;
    const startX = scene.scale.width / 2 - totalWidth / 2;

    order.forEach(({ spellId, keyLabel }, i) => {
      const x = startX + i * (SLOT_SIZE + SLOT_GAP) + SLOT_SIZE / 2;
      const y = slotY + SLOT_SIZE / 2;
      const iconBottom = y + SLOT_ICON_SIZE / 2;

      // Texture is a placeholder until setSpellDefs assigns the real
      // per-kind icon (see SPELL_KIND_ICON_KEYS) — spell defs load
      // asynchronously and aren't known yet at construction time.
      const icon = scene.add
        .image(x, y, SPELL_KIND_ICON_KEYS.single)
        .setDisplaySize(SLOT_ICON_SIZE, SLOT_ICON_SIZE)
        .setScrollFactor(0)
        .setDepth(UI_DEPTH);
      if (onSlotClick) {
        icon.setInteractive({ useHandCursor: true }).on("pointerdown", (pointer: Phaser.Input.Pointer) => {
          if (pointer.leftButtonDown()) onSlotClick(spellId);
        });
      }
      const border = scene.add
        .rectangle(x, y, SLOT_SIZE, SLOT_SIZE)
        .setStrokeStyle(2, IN_RANGE_BORDER_COLOR, 0.6)
        .setScrollFactor(0)
        .setDepth(UI_DEPTH + 1);
      const cooldownOverlay = scene.add
        .rectangle(x, iconBottom, SLOT_ICON_SIZE, 0, 0x000000, 0.7)
        .setOrigin(0.5, 1)
        .setScrollFactor(0)
        .setDepth(UI_DEPTH + 2)
        .setVisible(false);
      scene.add
        .text(x - SLOT_SIZE / 2 + 4, y - SLOT_SIZE / 2 + 2, keyLabel, { fontSize: "11px", color: "#000000" })
        .setScrollFactor(0)
        .setDepth(UI_DEPTH + 3);
      const cooldownText = scene.add
        .text(x, y, "", { fontSize: "14px", color: "#ffffff" })
        .setOrigin(0.5)
        .setScrollFactor(0)
        .setDepth(UI_DEPTH + 4)
        .setVisible(false);

      this.slots.set(spellId, {
        icon,
        border,
        cooldownOverlay,
        cooldownText,
        cooldownMs: 0,
        castTimeMs: 0,
        lastCastAt: -Infinity,
        outOfRange: false,
      });
    });

    const castBarY = slotY - 22;
    const castBarBg = scene.add
      .rectangle(scene.scale.width / 2, castBarY, CAST_BAR_WIDTH, CAST_BAR_HEIGHT, 0x111111, 0.8)
      .setScrollFactor(0)
      .setDepth(UI_DEPTH);
    this.castBarFill = scene.add
      .rectangle(scene.scale.width / 2 - CAST_BAR_WIDTH / 2, castBarY, 0, CAST_BAR_HEIGHT, 0xffcc33)
      .setOrigin(0, 0.5)
      .setScrollFactor(0)
      .setDepth(UI_DEPTH + 1);
    this.castBarText = scene.add
      .text(scene.scale.width / 2, castBarY, "", { fontSize: "12px", color: "#ffffff" })
      .setOrigin(0.5)
      .setScrollFactor(0)
      .setDepth(UI_DEPTH + 2);
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

  setLevel(level: number, experience: number, xpToNextLevel: number) {
    this.levelText.setText(`Lvl ${level}`);
    const frac = xpToNextLevel > 0 ? Math.max(0, Math.min(1, experience / xpToNextLevel)) : 0;
    this.xpBarFill.width = LEVEL_BAR_WIDTH * frac;
  }

  setSpellDefs(defs: Map<SpellId, SpellDef>) {
    for (const [spellId, slot] of this.slots) {
      const def = defs.get(spellId);
      if (!def) continue;
      slot.cooldownMs = def.cooldownMs;
      slot.castTimeMs = def.castTimeMs;
      slot.icon.setTexture(SPELL_KIND_ICON_KEYS[def.kind]);
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

  // Like cancelCast, but also rolls back the GCD — used specifically when
  // the server rejects a cast it never actually accepted (see
  // CastFailedMessage, e.g. no line of sight), as opposed to one that was
  // accepted and later fizzled/was interrupted. beginCast applies the GCD
  // optimistically the moment the client sends "cast"; if the server turns
  // around and refuses it, that GCD was never really spent, so leaving it
  // in place (like cancelCast does) would lock out casting for no reason.
  rejectCast(spellId: SpellId) {
    this.cancelCast(spellId);
    this.lastGlobalCastAt = -Infinity;
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

  // Called every frame (see WorldScene.updateSpellRangeIndicators) for each
  // targeted spell against the player's current target — purely a visual
  // hint, the actual block/fizzle happens server-side (and the client
  // pre-checks it too before sending "cast", see WorldScene.castSpell); this
  // just lets the player see it's out of range before they even click.
  setOutOfRange(spellId: SpellId, outOfRange: boolean) {
    const slot = this.slots.get(spellId);
    if (!slot || slot.outOfRange === outOfRange) return;
    slot.outOfRange = outOfRange;
    slot.border.setStrokeStyle(2, outOfRange ? OUT_OF_RANGE_COLOR : IN_RANGE_BORDER_COLOR, outOfRange ? 0.9 : 0.6);
    slot.icon.setAlpha(outOfRange ? 0.45 : 1);
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
