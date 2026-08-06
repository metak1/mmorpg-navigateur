import Phaser from "phaser";
import type { Room } from "colyseus.js";
import type { Player, Monster, Projectile, RoomState, SpellId, SpellDef, TileGrid } from "shared";
import { MOVE_SPEED, resolveMovement } from "shared";
import { connectToWorld } from "../net/RoomClient.js";
import { fetchActiveMap, fetchSpells } from "../net/api.js";

const REMOTE_SMOOTHING = 0.25; // lerp factor applied per frame toward server position
const HP_BAR_WIDTH = 30;
const HP_BAR_HEIGHT = 4;
const HP_BAR_OFFSET_Y = 20;
const MONSTER_COLOR = 0xff3333;
const MONSTER_SLOWED_COLOR = 0x5599ff;

interface HpBarHolder {
  rect: Phaser.GameObjects.Rectangle;
  hpBarBg: Phaser.GameObjects.Rectangle;
  hpBarFill: Phaser.GameObjects.Rectangle;
}

interface PlayerEntity extends HpBarHolder {
  isLocal: boolean;
  targetX: number;
  targetY: number;
  maxHp: number;
}

interface MonsterEntity extends HpBarHolder {
  targetX: number;
  targetY: number;
  maxHp: number;
}

interface ProjectileEntity {
  shape: Phaser.GameObjects.Rectangle;
  targetX: number;
  targetY: number;
}

const SPELL_KEYS: Array<{ spellId: SpellId; keyName: string }> = [
  { spellId: 1, keyName: "ONE" },
  { spellId: 2, keyName: "TWO" },
  { spellId: 3, keyName: "THREE" },
  { spellId: 4, keyName: "FOUR" },
  { spellId: 5, keyName: "FIVE" },
];

export class WorldScene extends Phaser.Scene {
  private room?: Room<RoomState>;
  private entities = new Map<string, PlayerEntity>();
  private monsters = new Map<string, MonsterEntity>();
  private projectiles = new Map<string, ProjectileEntity>();
  private cursors?: Phaser.Types.Input.Keyboard.CursorKeys;
  private wasd?: Record<"W" | "A" | "S" | "D", Phaser.Input.Keyboard.Key>;
  private lastDirection: "up" | "down" | "left" | "right" = "down";
  private lastSent = { dx: 0, dy: 0 };
  private username = "Player";
  private mapGrid: TileGrid = { tileData: [[0]], tileSize: 32, cols: 1, rows: 1 };
  private spellDefs = new Map<SpellId, SpellDef>();

  constructor() {
    super("world");
  }

  init(data: { username: string }) {
    this.username = data.username;
  }

  preload() {
    this.load.image("tiles", "assets/tiles.png");
  }

  async create() {
    const [activeMap, spells] = await Promise.all([fetchActiveMap(), fetchSpells()]);

    this.mapGrid = {
      tileData: activeMap.tileData,
      tileSize: activeMap.tileSize,
      cols: activeMap.width,
      rows: activeMap.height,
    };
    for (const spell of spells) {
      this.spellDefs.set(spell.keybind as SpellId, {
        name: spell.name,
        kind: spell.kind,
        cooldownMs: spell.cooldownMs,
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

    const spellList = SPELL_KEYS.map(({ spellId }) => `${spellId} ${this.spellDefs.get(spellId)?.name ?? "?"}`).join(
      "   ",
    );
    this.add
      .text(8, 8, `Arrows / WASD: move    ${spellList}    (aim with mouse)`, {
        fontSize: "14px",
        color: "#ffffff",
        backgroundColor: "#000000aa",
        padding: { x: 6, y: 4 },
      })
      .setScrollFactor(0)
      .setDepth(1000);

    const { room, $ } = await connectToWorld(this.username);
    this.room = room;

    for (const { spellId, keyName } of SPELL_KEYS) {
      this.input.keyboard?.on(`keydown-${keyName}`, () => this.castSpell(spellId));
    }

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
        maxHp: player.maxHp,
      };
      this.entities.set(sessionId, entity);

      if (isLocal) {
        this.cameras.main.startFollow(rect, true);
      }

      $(player).onChange(() => {
        entity.targetX = player.x;
        entity.targetY = player.y;
        hpBarFill.width = HP_BAR_WIDTH * Math.max(0, player.hp / entity.maxHp);
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
      const { hpBarBg, hpBarFill } = this.createHpBar(monster.x, monster.y);
      const entity: MonsterEntity = {
        rect,
        hpBarBg,
        hpBarFill,
        targetX: monster.x,
        targetY: monster.y,
        maxHp: monster.maxHp,
      };
      this.monsters.set(id, entity);

      let lastHp = monster.hp;
      $(monster).onChange(() => {
        entity.targetX = monster.x;
        entity.targetY = monster.y;
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
    });

    $(room.state).projectiles.onAdd((projectile: Projectile, id: string) => {
      const spell = this.spellDefs.get(projectile.spellId as SpellId);
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

  private castSpell(spellId: SpellId) {
    if (!this.room) return;
    const local = this.entities.get(this.room.sessionId);
    if (!local) return;

    const pointer = this.input.activePointer;
    const dirX = pointer.worldX - local.rect.x;
    const dirY = pointer.worldY - local.rect.y;
    this.room.send("cast", { spellId, dirX, dirY });
  }

  update(_time: number, deltaMs: number) {
    const dt = deltaMs / 1000;
    this.updateInput(dt);
    this.updateRemoteEntities();
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
  }
}
