import { Room, Client, type Delayed } from "@colyseus/core";
import { prisma } from "../db.js";
import type { MonsterTemplate } from "@prisma/client";
import {
  Player,
  Monster,
  Projectile,
  RoomState,
  WORLD_ROOM,
  MOVE_SPEED,
  resolveMovement,
  getTileAt,
  isWalkable,
  MONSTER_RESPAWN_MS,
  PLAYER_MAX_HP,
  PLAYER_RESPAWN_INVULNERABLE_MS,
  GLOBAL_COOLDOWN_MS,
  PROJECTILE_HIT_RADIUS,
  type TileGrid,
  type MoveInputMessage,
  type CastInputMessage,
  type HealEventMessage,
  type GroundAoeEventMessage,
  type SpellId,
  type SpellDef,
  type SpellKind,
} from "shared";

const SIMULATION_INTERVAL_MS = 1000 / 30;
const MONSTER_COLLISION_RADIUS = 14;

interface MonsterRuntime {
  homeX: number;
  homeY: number;
  wanderTargetX: number;
  wanderTargetY: number;
  nextWanderAt: number;
  slowUntil: number;
  slowMultiplier: number;
  lastAttackAt: number;
  template: MonsterTemplate;
}

interface ProjectileRuntime {
  spawnX: number;
  spawnY: number;
  dirX: number;
  dirY: number;
  spellId: SpellId;
}

export class WorldRoom extends Room<RoomState> {
  static NAME = WORLD_ROOM;
  private inputs = new Map<string, MoveInputMessage>();
  private lastCastAt = new Map<string, number>();
  private castingUntil = new Map<string, number>();
  private castTimeouts = new Map<string, Delayed>();
  private gcdUntil = new Map<string, number>();
  private invulnerableUntil = new Map<string, number>();
  private monsterRuntime = new Map<string, MonsterRuntime>();
  private projectileRuntime = new Map<string, ProjectileRuntime>();
  private projectileSeq = 0;

  private mapGrid: TileGrid = { tileData: [[0]], tileSize: 32, cols: 1, rows: 1 };
  private spawnX = 0;
  private spawnY = 0;
  private spellDefs = new Map<SpellId, SpellDef>();

  async onCreate() {
    this.setState(new RoomState());

    const map = await prisma.gameMap.findFirst({ where: { isActive: true } });
    if (!map) {
      throw new Error("No active map found in the database. Run `npx prisma db seed` in packages/server.");
    }

    this.mapGrid = {
      tileData: JSON.parse(map.tileData) as number[][],
      tileSize: map.tileSize,
      cols: map.width,
      rows: map.height,
    };
    this.spawnX = map.spawnX;
    this.spawnY = map.spawnY;

    const spellRows = await prisma.spellTemplate.findMany();
    for (const spell of spellRows) {
      this.spellDefs.set(spell.keybind as SpellId, {
        name: spell.name,
        kind: spell.kind as SpellKind,
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

    const spawnRows = await prisma.monsterSpawn.findMany({
      where: { mapId: map.id },
      include: { monsterTemplate: true },
    });
    spawnRows.forEach((spawn, index) => {
      this.spawnMonster(`monster-${index}`, { x: spawn.x, y: spawn.y }, spawn.monsterTemplate);
    });

    this.onMessage("move", (client, message: MoveInputMessage) => {
      if (!this.state.players.has(client.sessionId)) return;
      this.inputs.set(client.sessionId, message);
    });

    this.onMessage("cast", (client, message: CastInputMessage) => this.handleCast(client, message));

    this.setSimulationInterval((deltaTime) => this.update(deltaTime), SIMULATION_INTERVAL_MS);
  }

  private spawnMonster(id: string, spawn: { x: number; y: number }, template: MonsterTemplate) {
    const monster = new Monster();
    monster.id = id;
    monster.name = template.name;
    monster.x = spawn.x;
    monster.y = spawn.y;
    monster.hp = template.maxHp;
    monster.maxHp = template.maxHp;
    this.state.monsters.set(id, monster);

    this.monsterRuntime.set(id, {
      homeX: spawn.x,
      homeY: spawn.y,
      wanderTargetX: spawn.x,
      wanderTargetY: spawn.y,
      nextWanderAt: 0,
      slowUntil: 0,
      slowMultiplier: 1,
      lastAttackAt: 0,
      template,
    });
  }

  private handleCast(client: Client, message: CastInputMessage) {
    const sessionId = client.sessionId;
    const player = this.state.players.get(sessionId);
    const spell = this.spellDefs.get(message.spellId);
    if (!player || !spell) return;

    const now = this.clock.currentTime;
    if ((this.castingUntil.get(sessionId) ?? 0) > now) return; // already mid-cast
    if ((this.gcdUntil.get(sessionId) ?? 0) > now) return; // global cooldown

    const key = `${sessionId}:${message.spellId}`;
    const last = this.lastCastAt.get(key) ?? 0;
    if (now - last < spell.cooldownMs) return;

    // The global cooldown always applies the moment a cast is accepted,
    // regardless of this specific spell's own cooldown/cast-time outcome —
    // unlike the per-spell cooldown, it is not waived if the cast is later
    // interrupted (see interruptCast).
    this.gcdUntil.set(sessionId, now + GLOBAL_COOLDOWN_MS);

    if (spell.castTimeMs > 0) {
      this.castingUntil.set(sessionId, now + spell.castTimeMs);
      const timeout = this.clock.setTimeout(() => {
        this.castingUntil.delete(sessionId);
        this.castTimeouts.delete(sessionId);
        // Cooldown only starts once the channel actually completes — an
        // interrupted cast (see interruptCast) never reaches this line, so
        // it doesn't cost anything.
        this.lastCastAt.set(key, this.clock.currentTime);
        this.resolveCastEffect(sessionId, spell, message);
      }, spell.castTimeMs);
      this.castTimeouts.set(sessionId, timeout);
    } else {
      this.lastCastAt.set(key, now);
      this.resolveCastEffect(sessionId, spell, message);
    }
  }

  // Moving during a channeled cast interrupts it before the cooldown is ever
  // applied, so an interrupted cast is free to retry immediately.
  private interruptCast(sessionId: string) {
    this.castTimeouts.get(sessionId)?.clear();
    this.castTimeouts.delete(sessionId);
    this.castingUntil.delete(sessionId);
  }

  // Runs immediately for instant spells, or after the cast-time delay elapses
  // for channeled ones. Re-reads player/target state at call time so a
  // channeled cast reflects wherever things have moved to by the time it
  // resolves, and quietly no-ops if the caster left or the target died.
  private resolveCastEffect(sessionId: string, spell: SpellDef, message: CastInputMessage) {
    const player = this.state.players.get(sessionId);
    if (!player) return;

    if (spell.kind === "heal") {
      player.hp = Math.min(player.maxHp, player.hp + (spell.healAmount ?? 0));
      this.broadcast("heal", { sessionId } satisfies HealEventMessage);
      return;
    }

    if (spell.kind === "groundAoe") {
      this.resolveGroundAoe(player, spell, message);
      return;
    }

    const target = message.targetId ? this.state.monsters.get(message.targetId) : undefined;
    if (!target) return;

    const dirX = target.x - player.x;
    const dirY = target.y - player.y;
    const len = Math.hypot(dirX, dirY);
    if (len === 0) return;

    const id = `projectile-${this.projectileSeq++}`;
    const projectile = new Projectile();
    projectile.id = id;
    projectile.x = player.x;
    projectile.y = player.y;
    projectile.spellId = message.spellId;
    this.state.projectiles.set(id, projectile);

    this.projectileRuntime.set(id, {
      spawnX: player.x,
      spawnY: player.y,
      dirX: dirX / len,
      dirY: dirY / len,
      spellId: message.spellId,
    });
  }

  // Ground-targeted burst: damages every monster and heals every player
  // within aoeRadius of the cast point, clamped to maxRange from the caster.
  private resolveGroundAoe(player: Player, spell: SpellDef, message: CastInputMessage) {
    if (message.x === undefined || message.y === undefined) return;

    let targetX = message.x;
    let targetY = message.y;
    const dx = targetX - player.x;
    const dy = targetY - player.y;
    const dist = Math.hypot(dx, dy);
    const maxRange = spell.maxRange ?? Infinity;
    if (dist > maxRange && dist > 0) {
      const scale = maxRange / dist;
      targetX = player.x + dx * scale;
      targetY = player.y + dy * scale;
    }

    const radius = spell.aoeRadius ?? 0;

    for (const [id, monster] of this.state.monsters) {
      if (Math.hypot(monster.x - targetX, monster.y - targetY) <= radius) {
        this.damageMonster(id, monster, spell.damage ?? 0);
      }
    }

    for (const [sessionId, ally] of this.state.players) {
      if (Math.hypot(ally.x - targetX, ally.y - targetY) <= radius) {
        ally.hp = Math.min(ally.maxHp, ally.hp + (spell.healAmount ?? 0));
        this.broadcast("heal", { sessionId } satisfies HealEventMessage);
      }
    }

    this.broadcast("groundAoe", { x: targetX, y: targetY, radius, color: spell.color } satisfies GroundAoeEventMessage);
  }

  private update(deltaTime: number) {
    const dt = deltaTime / 1000;
    this.updatePlayers(dt);
    this.updateMonsters(dt);
    this.updateProjectiles(dt);
  }

  private updatePlayers(dt: number) {
    const now = this.clock.currentTime;
    for (const [sessionId, input] of this.inputs) {
      const player = this.state.players.get(sessionId);
      if (!player) {
        this.inputs.delete(sessionId);
        continue;
      }
      if ((input.dx !== 0 || input.dy !== 0) && (this.castingUntil.get(sessionId) ?? 0) > now) {
        this.interruptCast(sessionId);
      }

      const resolved = resolveMovement(
        this.mapGrid,
        player.x,
        player.y,
        input.dx * MOVE_SPEED * dt,
        input.dy * MOVE_SPEED * dt,
      );
      player.x = resolved.x;
      player.y = resolved.y;
      player.direction = input.direction;
    }
  }

  private updateMonsters(dt: number) {
    const now = this.clock.currentTime;

    for (const [id, monster] of this.state.monsters) {
      const runtime = this.monsterRuntime.get(id);
      if (!runtime) continue;
      const template = runtime.template;

      let target: Player | null = null;
      let targetDist = Infinity;
      for (const player of this.state.players.values()) {
        const dist = Math.hypot(player.x - monster.x, player.y - monster.y);
        if (dist <= template.aggroRange && dist < targetDist) {
          target = player;
          targetDist = dist;
        }
      }

      const isSlowed = runtime.slowUntil > now;
      monster.slowed = isSlowed;
      const speedMultiplier = isSlowed ? runtime.slowMultiplier : 1;

      if (target) {
        if (targetDist > template.attackRange) {
          const dirX = (target.x - monster.x) / targetDist;
          const dirY = (target.y - monster.y) / targetDist;
          const speed = template.chaseSpeed * speedMultiplier;
          const resolved = resolveMovement(this.mapGrid, monster.x, monster.y, dirX * speed * dt, dirY * speed * dt);
          monster.x = resolved.x;
          monster.y = resolved.y;
        } else if (now - runtime.lastAttackAt >= template.attackCooldownMs) {
          runtime.lastAttackAt = now;
          this.damagePlayer(target, template.touchDamage);
        }
        continue;
      }

      if (now >= runtime.nextWanderAt) {
        const angle = Math.random() * Math.PI * 2;
        const radius = Math.random() * template.wanderRadius;
        runtime.wanderTargetX = runtime.homeX + Math.cos(angle) * radius;
        runtime.wanderTargetY = runtime.homeY + Math.sin(angle) * radius;
        runtime.nextWanderAt = now + template.wanderIntervalMs;
      }

      const dx = runtime.wanderTargetX - monster.x;
      const dy = runtime.wanderTargetY - monster.y;
      const dist = Math.hypot(dx, dy);
      if (dist > 4) {
        const speed = template.wanderSpeed * speedMultiplier;
        const resolved = resolveMovement(
          this.mapGrid,
          monster.x,
          monster.y,
          (dx / dist) * speed * dt,
          (dy / dist) * speed * dt,
        );
        monster.x = resolved.x;
        monster.y = resolved.y;
      }
    }
  }

  private damagePlayer(player: Player, amount: number) {
    const now = this.clock.currentTime;
    const invulnUntil = this.invulnerableUntil.get(player.sessionId) ?? 0;
    if (now < invulnUntil) return;

    player.hp -= amount;
    if (player.hp <= 0) {
      player.hp = player.maxHp;
      player.x = this.spawnX;
      player.y = this.spawnY;
      this.invulnerableUntil.set(player.sessionId, now + PLAYER_RESPAWN_INVULNERABLE_MS);
    }
  }

  private damageMonster(id: string, monster: Monster, amount: number) {
    monster.hp -= amount;
    if (monster.hp <= 0) {
      const runtime = this.monsterRuntime.get(id);
      this.state.monsters.delete(id);
      if (runtime) {
        this.clock.setTimeout(
          () => this.spawnMonster(id, { x: runtime.homeX, y: runtime.homeY }, runtime.template),
          MONSTER_RESPAWN_MS,
        );
      }
    }
  }

  private resolveSpellHit(spell: SpellDef, monster: Monster, monsterId: string, hitX: number, hitY: number) {
    if (spell.kind === "aoe") {
      const radius = spell.aoeRadius ?? 0;
      for (const [id, m] of this.state.monsters) {
        const dist = Math.hypot(m.x - hitX, m.y - hitY);
        if (dist <= radius) {
          this.damageMonster(id, m, spell.damage ?? 0);
        }
      }
      return;
    }

    if (spell.kind === "slow") {
      const runtime = this.monsterRuntime.get(monsterId);
      if (runtime) {
        runtime.slowUntil = this.clock.currentTime + (spell.slowDurationMs ?? 0);
        runtime.slowMultiplier = spell.slowMultiplier ?? 1;
      }
    }

    this.damageMonster(monsterId, monster, spell.damage ?? 0);
  }

  private updateProjectiles(dt: number) {
    for (const [id, projectile] of this.state.projectiles) {
      const runtime = this.projectileRuntime.get(id);
      if (!runtime) {
        this.state.projectiles.delete(id);
        continue;
      }

      const spell = this.spellDefs.get(runtime.spellId);
      if (!spell) {
        this.state.projectiles.delete(id);
        this.projectileRuntime.delete(id);
        continue;
      }

      const speed = spell.projectileSpeed ?? 0;
      projectile.x += runtime.dirX * speed * dt;
      projectile.y += runtime.dirY * speed * dt;

      const traveled = Math.hypot(projectile.x - runtime.spawnX, projectile.y - runtime.spawnY);
      let hit = false;

      if (!isWalkable(getTileAt(this.mapGrid, projectile.x, projectile.y))) {
        hit = true;
      } else {
        for (const [monsterId, monster] of this.state.monsters) {
          const dist = Math.hypot(monster.x - projectile.x, monster.y - projectile.y);
          if (dist <= PROJECTILE_HIT_RADIUS + MONSTER_COLLISION_RADIUS) {
            this.resolveSpellHit(spell, monster, monsterId, projectile.x, projectile.y);
            hit = true;
            break;
          }
        }
      }

      if (hit || traveled >= (spell.maxRange ?? 0)) {
        this.state.projectiles.delete(id);
        this.projectileRuntime.delete(id);
      }
    }
  }

  async onJoin(client: Client, options: { name?: string }) {
    const username = options.name ?? `Player-${client.sessionId.slice(0, 4)}`;

    const account = await prisma.account.upsert({
      where: { username },
      update: {},
      create: { username, x: this.spawnX, y: this.spawnY },
    });

    const player = new Player();
    player.sessionId = client.sessionId;
    player.name = username;
    player.x = account.x;
    player.y = account.y;
    player.hp = PLAYER_MAX_HP;
    player.maxHp = PLAYER_MAX_HP;

    this.state.players.set(client.sessionId, player);
    console.log(`${player.name} joined ${this.roomId}`);
  }

  async onLeave(client: Client) {
    const player = this.state.players.get(client.sessionId);
    this.state.players.delete(client.sessionId);
    this.inputs.delete(client.sessionId);
    this.invulnerableUntil.delete(client.sessionId);
    this.interruptCast(client.sessionId);
    this.gcdUntil.delete(client.sessionId);
    for (let spellId = 1; spellId <= 6; spellId++) {
      this.lastCastAt.delete(`${client.sessionId}:${spellId}`);
    }

    if (player) {
      try {
        await prisma.account.update({
          where: { username: player.name },
          data: { x: player.x, y: player.y },
        });
      } catch (err) {
        console.error(`Failed to save position for ${player.name}:`, err);
      }
    }

    console.log(`${player?.name ?? client.sessionId} left ${this.roomId}`);
  }
}
