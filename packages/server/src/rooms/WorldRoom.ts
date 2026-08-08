import { Room, Client, type Delayed } from "@colyseus/core";
import { prisma } from "../db.js";
import { onContentChanged } from "../contentEvents.js";
import { verifyToken } from "../auth/jwt.js";
import type { MonsterTemplate, SpellTemplate } from "@prisma/client";
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
  hasLineOfSight,
  MONSTER_RESPAWN_MS,
  PLAYER_MAX_HP,
  PLAYER_RESPAWN_INVULNERABLE_MS,
  GLOBAL_COOLDOWN_MS,
  PROJECTILE_HIT_RADIUS,
  type TileGrid,
  type JoinOptions,
  type MoveInputMessage,
  type CastInputMessage,
  type HealEventMessage,
  type GroundAoeEventMessage,
  type CastFizzledMessage,
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
  classId: string;
  // Present for monster-targeted casts (single/aoe/slow) — the projectile
  // re-aims at this target's current position every tick (see
  // updateProjectiles), so a moving monster can't dodge by outrunning the
  // direction the projectile was launched in.
  targetId?: string;
}

export class WorldRoom extends Room<RoomState> {
  static NAME = WORLD_ROOM;
  private inputs = new Map<string, MoveInputMessage>();
  private lastCastAt = new Map<string, number>();
  private castingUntil = new Map<string, number>();
  private castTimeouts = new Map<string, Delayed>();
  private gcdUntil = new Map<string, number>();
  private invulnerableUntil = new Map<string, number>();
  private characterIds = new Map<string, string>();
  private monsterRuntime = new Map<string, MonsterRuntime>();
  private projectileRuntime = new Map<string, ProjectileRuntime>();
  private projectileSeq = 0;

  private mapGrid: TileGrid = { tileData: [[0]], tileSize: 32, cols: 1, rows: 1 };
  private spawnX = 0;
  private spawnY = 0;
  private spellDefsByClass = new Map<string, Map<SpellId, SpellDef>>();
  private unsubscribeContentEvents?: () => void;

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

    await this.reloadSpells();

    this.unsubscribeContentEvents = onContentChanged((kind) => {
      if (kind === "spells") void this.reloadSpells();
      else if (kind === "monsters") void this.reloadMonsterTemplates();
    });

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

  onDispose() {
    this.unsubscribeContentEvents?.();
  }

  // Spells are cached at room creation for performance, so an admin edit
  // wouldn't take effect until the next room otherwise. Rebuilding the whole
  // map from scratch (rather than patching one row) means create/update/
  // delete are all handled uniformly by the same reload.
  private buildSpellDefsByClass(spellRows: SpellTemplate[]): Map<string, Map<SpellId, SpellDef>> {
    const byClass = new Map<string, Map<SpellId, SpellDef>>();
    for (const spell of spellRows) {
      let classSpells = byClass.get(spell.classId);
      if (!classSpells) {
        classSpells = new Map();
        byClass.set(spell.classId, classSpells);
      }
      classSpells.set(spell.keybind as SpellId, {
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
    return byClass;
  }

  private async reloadSpells() {
    const spellRows = await prisma.spellTemplate.findMany();
    this.spellDefsByClass = this.buildSpellDefsByClass(spellRows);
  }

  // Monster templates are also cached (on each spawned monster's runtime
  // entry). Mutating the existing template objects in place — rather than
  // replacing them — means every already-spawned monster referencing one
  // picks up the new stats immediately with no extra bookkeeping. Newly
  // added/removed spawn points on the active map still require a room
  // restart; this only refreshes stats on monsters that already exist.
  private async reloadMonsterTemplates() {
    const templates = await prisma.monsterTemplate.findMany();
    const byId = new Map(templates.map((t) => [t.id, t]));

    for (const runtime of this.monsterRuntime.values()) {
      const fresh = byId.get(runtime.template.id);
      if (fresh) Object.assign(runtime.template, fresh);
    }

    for (const [id, monster] of this.state.monsters) {
      const runtime = this.monsterRuntime.get(id);
      if (!runtime) continue;
      monster.maxHp = runtime.template.maxHp;
      monster.hp = Math.min(monster.hp, monster.maxHp);
    }
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
    if (!player) return;
    const spell = this.spellDefsByClass.get(player.classId)?.get(message.spellId);
    if (!spell) return;

    const now = this.clock.currentTime;
    if ((this.castingUntil.get(sessionId) ?? 0) > now) return; // already mid-cast
    if ((this.gcdUntil.get(sessionId) ?? 0) > now) return; // global cooldown

    const key = `${sessionId}:${message.spellId}`;
    const last = this.lastCastAt.get(key) ?? 0;
    if (now - last < spell.cooldownMs) return;

    // The global cooldown always applies the moment a cast is accepted,
    // regardless of this specific spell's own cooldown/cast-time outcome —
    // unlike the per-spell cooldown (applied in resolveCastEffect, only once
    // an effect actually lands), the GCD is not waived if the cast is later
    // interrupted (see interruptCast) or fizzles (see resolveCastEffect).
    this.gcdUntil.set(sessionId, now + GLOBAL_COOLDOWN_MS);

    if (spell.castTimeMs > 0) {
      this.castingUntil.set(sessionId, now + spell.castTimeMs);
      const timeout = this.clock.setTimeout(() => {
        this.castingUntil.delete(sessionId);
        this.castTimeouts.delete(sessionId);
        this.resolveCastEffect(client, key, spell, message);
      }, spell.castTimeMs);
      this.castTimeouts.set(sessionId, timeout);
    } else {
      this.resolveCastEffect(client, key, spell, message);
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
  // resolves. The per-spell cooldown (`cooldownKey`) is only applied once an
  // effect actually lands — a targeted cast whose target died in the
  // meantime fizzles instead of silently doing nothing: no cooldown is spent,
  // and the caster is told so their hotbar can roll back instead of showing
  // a cast that never happened.
  private resolveCastEffect(client: Client, cooldownKey: string, spell: SpellDef, message: CastInputMessage) {
    const sessionId = client.sessionId;
    const player = this.state.players.get(sessionId);
    if (!player) return;

    if (spell.kind === "heal") {
      this.lastCastAt.set(cooldownKey, this.clock.currentTime);
      player.hp = Math.min(player.maxHp, player.hp + (spell.healAmount ?? 0));
      this.broadcast("heal", { sessionId } satisfies HealEventMessage);
      return;
    }

    if (spell.kind === "groundAoe") {
      if (this.resolveGroundAoe(player, spell, message)) {
        this.lastCastAt.set(cooldownKey, this.clock.currentTime);
      } else {
        client.send("castFizzled", { spellId: message.spellId } satisfies CastFizzledMessage);
      }
      return;
    }

    const target = message.targetId ? this.state.monsters.get(message.targetId) : undefined;
    if (!target || !hasLineOfSight(this.mapGrid, player.x, player.y, target.x, target.y)) {
      client.send("castFizzled", { spellId: message.spellId } satisfies CastFizzledMessage);
      return;
    }

    this.lastCastAt.set(cooldownKey, this.clock.currentTime);

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
    projectile.classId = player.classId;
    this.state.projectiles.set(id, projectile);

    this.projectileRuntime.set(id, {
      spawnX: player.x,
      spawnY: player.y,
      dirX: dirX / len,
      dirY: dirY / len,
      spellId: message.spellId,
      classId: player.classId,
      targetId: message.targetId,
    });
  }

  // Ground-targeted burst: damages every monster and heals every player
  // within aoeRadius of the cast point, clamped to maxRange from the caster.
  // Returns false (and applies nothing) if a wall blocks line-of-sight to
  // the landing point, so the caller can fizzle the cast instead of letting
  // it land through cover.
  private resolveGroundAoe(player: Player, spell: SpellDef, message: CastInputMessage): boolean {
    if (message.x === undefined || message.y === undefined) return false;

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

    if (!hasLineOfSight(this.mapGrid, player.x, player.y, targetX, targetY)) return false;

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
    return true;
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

      const spell = this.spellDefsByClass.get(runtime.classId)?.get(runtime.spellId);
      if (!spell) {
        this.state.projectiles.delete(id);
        this.projectileRuntime.delete(id);
        continue;
      }

      // Homing: a targeted cast re-aims at its target's current position
      // every tick, so a monster can't dodge a targeted spell just by moving
      // — it always closes the distance, regardless of where the target
      // has wandered to since the cast.
      if (runtime.targetId) {
        const target = this.state.monsters.get(runtime.targetId);
        if (target) {
          const dx = target.x - projectile.x;
          const dy = target.y - projectile.y;
          const dist = Math.hypot(dx, dy);
          if (dist > 0) {
            runtime.dirX = dx / dist;
            runtime.dirY = dy / dist;
          }
        }
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

  async onJoin(client: Client, options: JoinOptions) {
    const payload = verifyToken(options.token);
    if (!payload) {
      throw new Error("Invalid or expired session. Please log in again.");
    }

    // Ownership check: the character must belong to the account the token
    // was issued to — a client can't join as a character it doesn't own by
    // passing an arbitrary characterId alongside a valid token.
    const character = await prisma.character.findFirst({
      where: { id: options.characterId, accountId: payload.sub },
      include: { class: true },
    });
    if (!character) {
      throw new Error("Character not found.");
    }
    if (!character.class) {
      throw new Error(`Character "${character.name}" has no class assigned.`);
    }

    const player = new Player();
    player.sessionId = client.sessionId;
    player.name = character.name;
    player.x = character.x;
    player.y = character.y;
    player.hp = PLAYER_MAX_HP;
    player.maxHp = PLAYER_MAX_HP;
    player.classId = character.class.id;
    player.className = character.class.name;

    this.state.players.set(client.sessionId, player);
    this.characterIds.set(client.sessionId, character.id);
    console.log(`${player.name} (${player.className}) joined ${this.roomId}`);
  }

  async onLeave(client: Client) {
    const player = this.state.players.get(client.sessionId);
    const characterId = this.characterIds.get(client.sessionId);
    this.state.players.delete(client.sessionId);
    this.characterIds.delete(client.sessionId);
    this.inputs.delete(client.sessionId);
    this.invulnerableUntil.delete(client.sessionId);
    this.interruptCast(client.sessionId);
    this.gcdUntil.delete(client.sessionId);
    for (let spellId = 1; spellId <= 6; spellId++) {
      this.lastCastAt.delete(`${client.sessionId}:${spellId}`);
    }

    if (player && characterId) {
      try {
        await prisma.character.update({
          where: { id: characterId },
          data: { x: player.x, y: player.y },
        });
      } catch (err) {
        console.error(`Failed to save position for ${player.name}:`, err);
      }
    }

    console.log(`${player?.name ?? client.sessionId} left ${this.roomId}`);
  }
}
