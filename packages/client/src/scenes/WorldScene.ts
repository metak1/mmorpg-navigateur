import Phaser from "phaser";
import type { Room } from "colyseus.js";
import type {
  Player,
  Monster,
  Projectile,
  RoomState,
  SpellId,
  SpellDef,
  TileGrid,
  HealEventMessage,
  GroundAoeEventMessage,
  CastFizzledMessage,
} from "shared";
import { MOVE_SPEED, resolveMovement } from "shared";
import { connectToWorld } from "../net/RoomClient.js";
import { fetchActiveMap, fetchSpells } from "../net/api.js";
import { Hud } from "../ui/Hud.js";

const REMOTE_SMOOTHING = 0.25; // lerp factor applied per frame toward server position
const HP_BAR_WIDTH = 30;
const HP_BAR_HEIGHT = 4;
const HP_BAR_OFFSET_Y = 20;
const MONSTER_COLOR = 0xff3333;
const MONSTER_SLOWED_COLOR = 0x5599ff;
const TARGET_RING_COLOR = 0xffff00;
const TARGET_RING_SIZE = 36;
const TARGET_PANEL_X = 8;
const TARGET_PANEL_Y = 40;
const TARGET_PANEL_WIDTH = 220;
const TARGET_PANEL_HP_WIDTH = 200;

type Target = { kind: "monster"; id: string } | { kind: "self" };

interface HpBarHolder {
  rect: Phaser.GameObjects.Rectangle;
  hpBarBg: Phaser.GameObjects.Rectangle;
  hpBarFill: Phaser.GameObjects.Rectangle;
}

interface PlayerEntity extends HpBarHolder {
  isLocal: boolean;
  targetX: number;
  targetY: number;
  name: string;
  hp: number;
  maxHp: number;
}

interface MonsterEntity extends HpBarHolder {
  targetX: number;
  targetY: number;
  name: string;
  hp: number;
  maxHp: number;
}

interface ProjectileEntity {
  shape: Phaser.GameObjects.Rectangle;
  targetX: number;
  targetY: number;
}

// Physical key position (layout-independent), not Phaser's named keydown-*
// events — those key off KeyboardEvent.keyCode, which on AZERTY and other
// non-US layouts reports the *shifted* character's code for the number row
// (e.g. French AZERTY needs Shift for "3"/"4"), so digits silently required
// Shift to register. event.code is unaffected by layout or Shift.
const SPELL_KEY_CODES: Partial<Record<string, SpellId>> = {
  Digit1: 1,
  Digit2: 2,
  Digit3: 3,
  Digit4: 4,
  Digit5: 5,
  Digit6: 6,
  Numpad1: 1,
  Numpad2: 2,
  Numpad3: 3,
  Numpad4: 4,
  Numpad5: 5,
  Numpad6: 6,
};

export class WorldScene extends Phaser.Scene {
  private room?: Room<RoomState>;
  private entities = new Map<string, PlayerEntity>();
  private monsters = new Map<string, MonsterEntity>();
  private projectiles = new Map<string, ProjectileEntity>();
  private cursors?: Phaser.Types.Input.Keyboard.CursorKeys;
  private wasd?: Record<"W" | "A" | "S" | "D", Phaser.Input.Keyboard.Key>;
  private lastDirection: "up" | "down" | "left" | "right" = "down";
  private lastSent = { dx: 0, dy: 0 };
  private token = "";
  private characterId = "";
  private mapGrid: TileGrid = { tileData: [[0]], tileSize: 32, cols: 1, rows: 1 };
  private spellDefsByClass = new Map<string, Map<SpellId, SpellDef>>();
  private spellDefs = new Map<SpellId, SpellDef>();
  private target: Target | null = null;
  private targetRing?: Phaser.GameObjects.Rectangle;
  private targetPanelParts: Phaser.GameObjects.GameObject[] = [];
  private targetNameText?: Phaser.GameObjects.Text;
  private targetHpFill?: Phaser.GameObjects.Rectangle;
  private hud?: Hud;
  private aimingSpell: SpellId | null = null;
  private groundAoePreviewRing?: Phaser.GameObjects.Arc;
  private groundAoeRangeRing?: Phaser.GameObjects.Arc;
  private instructionText?: Phaser.GameObjects.Text;

  constructor() {
    super("world");
  }

  init(data: { token: string; characterId: string }) {
    this.token = data.token;
    this.characterId = data.characterId;
  }

  preload() {
    this.load.image("tiles", "assets/tiles.png");
  }

  async create() {
    try {
      await this.buildWorld();
    } catch (err) {
      window.dispatchEvent(
        new CustomEvent("world-error", { detail: err instanceof Error ? err.message : "Failed to load world." }),
      );
    }
  }

  private async buildWorld() {
    const [activeMap, spells] = await Promise.all([fetchActiveMap(), fetchSpells()]);

    this.mapGrid = {
      tileData: activeMap.tileData,
      tileSize: activeMap.tileSize,
      cols: activeMap.width,
      rows: activeMap.height,
    };
    for (const spell of spells) {
      let classSpells = this.spellDefsByClass.get(spell.classId);
      if (!classSpells) {
        classSpells = new Map();
        this.spellDefsByClass.set(spell.classId, classSpells);
      }
      classSpells.set(spell.keybind as SpellId, {
        name: spell.name,
        kind: spell.kind,
        cooldownMs: spell.cooldownMs,
        castTimeMs: spell.castTimeMs,
        color: spell.color,
        size: spell.size,
        damage: spell.damage ?? undefined,
        projectileSpeed: spell.projectileSpeed ?? undefined,
        maxRange: spell.maxRange ?? undefined,
        aoeRadius: spell.aoeRadius ?? undefined,
        slowMultiplier: spell.slowMultiplier ?? undefined,
        slowDurationMs: spell.slowDurationMs ?? undefined,
        healAmount: spell.healAmount ?? undefined,
      });
    }

    const map = this.make.tilemap({
      data: this.mapGrid.tileData,
      tileWidth: this.mapGrid.tileSize,
      tileHeight: this.mapGrid.tileSize,
    });
    const tileset = map.addTilesetImage("tiles", "tiles", this.mapGrid.tileSize, this.mapGrid.tileSize, 0, 0);
    if (tileset) map.createLayer(0, tileset, 0, 0);

    this.cameras.main.setBounds(0, 0, map.widthInPixels, map.heightInPixels);

    this.cursors = this.input.keyboard?.createCursorKeys();
    this.wasd = this.input.keyboard?.addKeys("W,A,S,D") as typeof this.wasd;

    this.targetRing = this.add
      .rectangle(0, 0, TARGET_RING_SIZE, TARGET_RING_SIZE)
      .setStrokeStyle(2, TARGET_RING_COLOR)
      .setVisible(false)
      .setDepth(500);

    this.createTargetPanel();

    this.input.on("pointerdown", (pointer: Phaser.Input.Pointer) => {
      if (this.aimingSpell) {
        if (pointer.leftButtonDown()) this.confirmAiming(pointer.worldX, pointer.worldY);
        else if (pointer.rightButtonDown()) this.cancelAiming();
        return;
      }
      if (!pointer.leftButtonDown()) return;
      if (this.input.hitTestPointer(pointer).length === 0) this.setTarget(null);
    });
    this.input.keyboard?.on("keydown-ESC", () => {
      this.cancelAiming();
      this.setTarget(null);
    });

    this.instructionText = this.add
      .text(
        8,
        8,
        `Arrows / WASD: move    (left-click a monster or yourself to target, Esc to clear, ground AOE casts at your cursor)`,
        {
          fontSize: "14px",
          color: "#ffffff",
          backgroundColor: "#000000aa",
          padding: { x: 6, y: 4 },
        },
      )
      .setScrollFactor(0)
      .setDepth(1000);

    const { room, $ } = await connectToWorld(this.token, this.characterId);
    this.room = room;

    room.onMessage("heal", (msg: HealEventMessage) => this.playHealEffect(msg.sessionId));
    room.onMessage("groundAoe", (msg: GroundAoeEventMessage) => this.playGroundAoeEffect(msg));
    room.onMessage("castFizzled", (msg: CastFizzledMessage) => this.hud?.cancelCast(msg.spellId));

    this.input.keyboard?.on("keydown", (event: KeyboardEvent) => {
      const spellId = SPELL_KEY_CODES[event.code];
      if (spellId) this.handleSpellActivated(spellId);
    });

    $(room.state).players.onAdd((player: Player, sessionId: string) => {
      const isLocal = sessionId === room.sessionId;
      const color = isLocal ? 0x00ff88 : 0xff8800;
      const rect = this.add.rectangle(player.x, player.y, 24, 24, color);
      const { hpBarBg, hpBarFill } = this.createHpBar(player.x, player.y);
      const entity: PlayerEntity = {
        rect,
        hpBarBg,
        hpBarFill,
        isLocal,
        targetX: player.x,
        targetY: player.y,
        name: player.name,
        hp: player.hp,
        maxHp: player.maxHp,
      };
      this.entities.set(sessionId, entity);

      if (isLocal) {
        this.cameras.main.startFollow(rect, true);
        rect.setInteractive({ useHandCursor: true });
        rect.on("pointerdown", (pointer: Phaser.Input.Pointer) => {
          if (this.aimingSpell) return; // let the scene-level handler treat this as a placement click
          if (pointer.leftButtonDown()) this.setTarget({ kind: "self" });
        });
        this.setupSpellbarForClass(player.classId, player.className);
        this.hud?.setHealth(player.hp, player.maxHp);
        window.dispatchEvent(new CustomEvent("world-ready"));
      }

      $(player).onChange(() => {
        entity.targetX = player.x;
        entity.targetY = player.y;
        entity.hp = player.hp;
        hpBarFill.width = HP_BAR_WIDTH * Math.max(0, player.hp / entity.maxHp);
        if (isLocal) this.hud?.setHealth(player.hp, player.maxHp);
      });
    });

    $(room.state).players.onRemove((_player: Player, sessionId: string) => {
      const entity = this.entities.get(sessionId);
      entity?.rect.destroy();
      entity?.hpBarBg.destroy();
      entity?.hpBarFill.destroy();
      this.entities.delete(sessionId);
    });

    $(room.state).monsters.onAdd((monster: Monster, id: string) => {
      const rect = this.add.rectangle(monster.x, monster.y, 28, 28, MONSTER_COLOR);
      rect.setInteractive({ useHandCursor: true });
      rect.on("pointerdown", (pointer: Phaser.Input.Pointer) => {
        if (this.aimingSpell) return; // let the scene-level handler treat this as a placement click
        if (pointer.leftButtonDown()) this.setTarget({ kind: "monster", id });
      });
      const { hpBarBg, hpBarFill } = this.createHpBar(monster.x, monster.y);
      const entity: MonsterEntity = {
        rect,
        hpBarBg,
        hpBarFill,
        targetX: monster.x,
        targetY: monster.y,
        name: monster.name,
        hp: monster.hp,
        maxHp: monster.maxHp,
      };
      this.monsters.set(id, entity);

      let lastHp = monster.hp;
      $(monster).onChange(() => {
        entity.targetX = monster.x;
        entity.targetY = monster.y;
        entity.hp = monster.hp;
        hpBarFill.width = HP_BAR_WIDTH * Math.max(0, monster.hp / entity.maxHp);
        rect.setFillStyle(monster.slowed ? MONSTER_SLOWED_COLOR : MONSTER_COLOR);

        if (monster.hp < lastHp) {
          this.tweens.add({ targets: rect, alpha: 0.15, duration: 60, yoyo: true, repeat: 1 });
        }
        lastHp = monster.hp;
      });
    });

    $(room.state).monsters.onRemove((_monster: Monster, id: string) => {
      const entity = this.monsters.get(id);
      entity?.rect.destroy();
      entity?.hpBarBg.destroy();
      entity?.hpBarFill.destroy();
      this.monsters.delete(id);
      if (this.target?.kind === "monster" && this.target.id === id) this.setTarget(null);
    });

    $(room.state).projectiles.onAdd((projectile: Projectile, id: string) => {
      const spell = this.spellDefsByClass.get(projectile.classId)?.get(projectile.spellId as SpellId);
      const size = spell?.size ?? 6;
      const color = spell?.color ?? 0xffffff;
      const shape = this.add.rectangle(projectile.x, projectile.y, size, size, color);
      const entity: ProjectileEntity = { shape, targetX: projectile.x, targetY: projectile.y };
      this.projectiles.set(id, entity);

      $(projectile).onChange(() => {
        entity.targetX = projectile.x;
        entity.targetY = projectile.y;
      });
    });

    $(room.state).projectiles.onRemove((_projectile: Projectile, id: string) => {
      this.projectiles.get(id)?.shape.destroy();
      this.projectiles.delete(id);
    });
  }

  // Called once, when the local player's own class is known (their spell set
  // and its size aren't known until then) — builds the hotbar/HUD sized to
  // that class's kit instead of a fixed universal slot count.
  private setupSpellbarForClass(classId: string, className: string) {
    const classSpells = this.spellDefsByClass.get(classId) ?? new Map<SpellId, SpellDef>();
    this.spellDefs = classSpells;

    const spellIds = [...classSpells.keys()].sort((a, b) => a - b);

    this.hud = new Hud(
      this,
      spellIds.map((spellId) => ({ spellId, keyLabel: String(spellId) })),
      (spellId) => this.handleSpellActivated(spellId),
    );
    this.hud.setSpellDefs(this.spellDefs);

    const spellList = spellIds.map((spellId) => `${spellId} ${classSpells.get(spellId)?.name ?? "?"}`).join("   ");
    this.instructionText?.setText(
      `${className}    ${spellList}    (left-click a monster or yourself to target, Esc to clear, ground AOE casts at your cursor)`,
    );
  }

  private createHpBar(x: number, y: number) {
    const barY = y - HP_BAR_OFFSET_Y;
    const hpBarBg = this.add.rectangle(x, barY, HP_BAR_WIDTH, HP_BAR_HEIGHT, 0x222222);
    const hpBarFill = this.add.rectangle(x - HP_BAR_WIDTH / 2, barY, HP_BAR_WIDTH, HP_BAR_HEIGHT, 0x33ff55).setOrigin(0, 0.5);
    return { hpBarBg, hpBarFill };
  }

  private positionHpBar(entity: HpBarHolder) {
    const barY = entity.rect.y - HP_BAR_OFFSET_Y;
    entity.hpBarBg.setPosition(entity.rect.x, barY);
    entity.hpBarFill.setPosition(entity.rect.x - HP_BAR_WIDTH / 2, barY);
  }

  // Ground-targeted spells are a two-step cast: activating the spell (hotkey
  // or hotbar click) arms it and shows the aoeRadius/maxRange rings, then a
  // left-click confirms the cast at the cursor. Right-click or Esc cancels.
  private handleSpellActivated(spellId: SpellId) {
    const spell = this.spellDefs.get(spellId);
    if (spell?.kind === "groundAoe") {
      if (this.aimingSpell === spellId) this.cancelAiming();
      else this.armSpell(spellId);
    } else {
      this.cancelAiming();
      this.castSpell(spellId);
    }
  }

  private armSpell(spellId: SpellId) {
    if (!this.hud) return;
    const spell = this.spellDefs.get(spellId);
    if (!spell || spell.kind !== "groundAoe") return;
    if (!this.hud.canCast(spellId, this.time.now)) return;

    this.aimingSpell = spellId;
    const radius = spell.aoeRadius ?? 0;
    const maxRange = spell.maxRange ?? 0;

    if (!this.groundAoePreviewRing) {
      this.groundAoePreviewRing = this.add.circle(0, 0, radius).setDepth(200);
    }
    this.groundAoePreviewRing.setRadius(radius).setStrokeStyle(1, spell.color, 0.6).setFillStyle(spell.color, 0.12).setVisible(true);

    if (!this.groundAoeRangeRing) {
      this.groundAoeRangeRing = this.add.circle(0, 0, maxRange).setDepth(199);
    }
    this.groundAoeRangeRing.setRadius(maxRange).setStrokeStyle(1, spell.color, 0.25).setVisible(true);
  }

  private cancelAiming() {
    if (!this.aimingSpell) return;
    this.aimingSpell = null;
    this.groundAoePreviewRing?.setVisible(false);
    this.groundAoeRangeRing?.setVisible(false);
  }

  private confirmAiming(worldX: number, worldY: number) {
    if (!this.aimingSpell || !this.room || !this.hud) return;
    const spellId = this.aimingSpell;
    const spell = this.spellDefs.get(spellId);
    this.cancelAiming();
    if (!spell || !this.hud.canCast(spellId, this.time.now)) return;

    this.hud.beginCast(spellId, spell.name, this.time.now);
    this.room.send("cast", { spellId, x: worldX, y: worldY });
  }

  private playGroundAoeEffect(msg: GroundAoeEventMessage) {
    const fill = this.add.circle(msg.x, msg.y, msg.radius, msg.color, 0.25).setDepth(300);
    const outline = this.add.circle(msg.x, msg.y, msg.radius).setStrokeStyle(2, msg.color, 0.9).setDepth(301);
    this.tweens.add({
      targets: [fill, outline],
      alpha: 0,
      duration: 350,
      onComplete: () => {
        fill.destroy();
        outline.destroy();
      },
    });
  }

  private playHealEffect(sessionId: string) {
    const entity = this.entities.get(sessionId);
    if (!entity) return;
    const ring = this.add
      .rectangle(entity.rect.x, entity.rect.y, 24, 24)
      .setStrokeStyle(2, 0x55ff88)
      .setDepth(400);
    this.tweens.add({
      targets: ring,
      scale: 2.2,
      alpha: 0,
      duration: 400,
      onComplete: () => ring.destroy(),
    });
  }

  private createTargetPanel() {
    const bg = this.add.rectangle(TARGET_PANEL_X, TARGET_PANEL_Y, TARGET_PANEL_WIDTH, 54, 0x000000, 0.6).setOrigin(0, 0);
    const nameText = this.add.text(TARGET_PANEL_X + 10, TARGET_PANEL_Y + 8, "", {
      fontSize: "14px",
      color: "#ffffff",
    });
    const hpBarBg = this.add
      .rectangle(TARGET_PANEL_X + 10, TARGET_PANEL_Y + 36, TARGET_PANEL_HP_WIDTH, 10, 0x222222)
      .setOrigin(0, 0.5);
    const hpBarFill = this.add
      .rectangle(TARGET_PANEL_X + 10, TARGET_PANEL_Y + 36, TARGET_PANEL_HP_WIDTH, 10, 0x33ff55)
      .setOrigin(0, 0.5);
    const hint = this.add.text(TARGET_PANEL_X + TARGET_PANEL_WIDTH - 66, TARGET_PANEL_Y + 8, "[Esc] clear", {
      fontSize: "11px",
      color: "#aaaaaa",
    });

    this.targetPanelParts = [bg, nameText, hpBarBg, hpBarFill, hint];
    for (const part of this.targetPanelParts) {
      (part as Phaser.GameObjects.Rectangle | Phaser.GameObjects.Text).setScrollFactor(0).setDepth(1000);
    }
    this.targetNameText = nameText;
    this.targetHpFill = hpBarFill;
    this.setTargetPanelVisible(false);
  }

  private setTargetPanelVisible(visible: boolean) {
    for (const part of this.targetPanelParts) {
      (part as Phaser.GameObjects.Rectangle | Phaser.GameObjects.Text).setVisible(visible);
    }
  }

  private setTarget(target: Target | null) {
    this.target = target;
    this.targetRing?.setVisible(target !== null);
    this.setTargetPanelVisible(target !== null);
  }

  private refreshTargetPanel() {
    if (!this.target || !this.room) return;

    let name: string;
    let hp: number;
    let maxHp: number;

    if (this.target.kind === "self") {
      const local = this.entities.get(this.room.sessionId);
      if (!local) return;
      name = "You";
      hp = local.hp;
      maxHp = local.maxHp;
    } else {
      const monster = this.monsters.get(this.target.id);
      if (!monster) return;
      name = monster.name;
      hp = monster.hp;
      maxHp = monster.maxHp;
    }

    this.targetNameText?.setText(name);
    if (this.targetHpFill) this.targetHpFill.width = TARGET_PANEL_HP_WIDTH * Math.max(0, hp / maxHp);
  }

  private castSpell(spellId: SpellId) {
    if (!this.room || !this.hud) return;
    const spell = this.spellDefs.get(spellId);
    if (!spell) return;

    const now = this.time.now;
    if (!this.hud.canCast(spellId, now)) return;

    if (spell.kind === "heal") {
      this.hud.beginCast(spellId, spell.name, now);
      this.room.send("cast", { spellId });
      return;
    }

    if (!this.target || this.target.kind !== "monster") return;
    this.hud.beginCast(spellId, spell.name, now);
    this.room.send("cast", { spellId, targetId: this.target.id });
  }

  update(time: number, deltaMs: number) {
    const dt = deltaMs / 1000;
    this.updateInput(dt);
    this.updateRemoteEntities();
    this.hud?.update(time);
  }

  private updateInput(dt: number) {
    if (!this.room || !this.cursors) return;

    let dx = 0;
    let dy = 0;
    if (this.cursors.left.isDown || this.wasd?.A.isDown) dx = -1;
    else if (this.cursors.right.isDown || this.wasd?.D.isDown) dx = 1;
    if (this.cursors.up.isDown || this.wasd?.W.isDown) dy = -1;
    else if (this.cursors.down.isDown || this.wasd?.S.isDown) dy = 1;

    if (dx === -1) this.lastDirection = "left";
    else if (dx === 1) this.lastDirection = "right";
    else if (dy === -1) this.lastDirection = "up";
    else if (dy === 1) this.lastDirection = "down";

    // Moving cancels a channeled cast rather than being blocked outright —
    // mirrors the server, which interrupts the cast the moment movement
    // input arrives instead of rooting the player in place.
    if (dx !== 0 || dy !== 0) {
      const castingSpellId = this.hud?.getCastingSpellId();
      if (castingSpellId != null) this.hud?.cancelCast(castingSpellId);
    }

    if (dx !== this.lastSent.dx || dy !== this.lastSent.dy) {
      this.lastSent = { dx, dy };
      this.room.send("move", { dx, dy, direction: this.lastDirection });
    }

    // Predict the local player's movement immediately instead of waiting on
    // the network round-trip; resolveMovement is the same collision function
    // the server uses, so prediction can't walk through a wall the server
    // would also block.
    if (dx !== 0 || dy !== 0) {
      const local = this.entities.get(this.room.sessionId);
      if (local?.isLocal) {
        const resolved = resolveMovement(
          this.mapGrid,
          local.rect.x,
          local.rect.y,
          dx * MOVE_SPEED * dt,
          dy * MOVE_SPEED * dt,
        );
        local.rect.x = resolved.x;
        local.rect.y = resolved.y;
        local.targetX = resolved.x;
        local.targetY = resolved.y;
        this.positionHpBar(local);
      }
    }
  }

  private updateRemoteEntities() {
    for (const entity of this.entities.values()) {
      if (entity.isLocal) continue;
      entity.rect.x = Phaser.Math.Linear(entity.rect.x, entity.targetX, REMOTE_SMOOTHING);
      entity.rect.y = Phaser.Math.Linear(entity.rect.y, entity.targetY, REMOTE_SMOOTHING);
      this.positionHpBar(entity);
    }

    for (const entity of this.monsters.values()) {
      entity.rect.x = Phaser.Math.Linear(entity.rect.x, entity.targetX, REMOTE_SMOOTHING);
      entity.rect.y = Phaser.Math.Linear(entity.rect.y, entity.targetY, REMOTE_SMOOTHING);
      this.positionHpBar(entity);
    }

    for (const entity of this.projectiles.values()) {
      entity.shape.x = Phaser.Math.Linear(entity.shape.x, entity.targetX, REMOTE_SMOOTHING);
      entity.shape.y = Phaser.Math.Linear(entity.shape.y, entity.targetY, REMOTE_SMOOTHING);
    }

    if (this.target) {
      const entity = this.target.kind === "self" ? this.entities.get(this.room?.sessionId ?? "") : this.monsters.get(this.target.id);
      if (entity) this.targetRing?.setPosition(entity.rect.x, entity.rect.y);
      this.refreshTargetPanel();
    }

    if (this.aimingSpell && this.room) {
      const local = this.entities.get(this.room.sessionId);
      const spell = this.spellDefs.get(this.aimingSpell);
      const pointer = this.input.activePointer;
      this.groundAoePreviewRing?.setPosition(pointer.worldX, pointer.worldY);
      if (local) {
        this.groundAoeRangeRing?.setPosition(local.rect.x, local.rect.y);
        const maxRange = spell?.maxRange ?? Infinity;
        const inRange = Phaser.Math.Distance.Between(local.rect.x, local.rect.y, pointer.worldX, pointer.worldY) <= maxRange;
        const color = inRange ? (spell?.color ?? 0xffffff) : 0xff3333;
        this.groundAoePreviewRing?.setStrokeStyle(1, color, 0.6).setFillStyle(color, 0.12);
      }
    }
  }
}
