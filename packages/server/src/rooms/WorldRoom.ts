import { Room, Client, type Delayed } from "@colyseus/core";
import { prisma } from "../db.js";
import { onContentChanged } from "../contentEvents.js";
import { verifyToken } from "../auth/jwt.js";
import type { MonsterTemplate, SpellTemplate, Quest, QuestRewardItem, ItemTemplate, NpcTemplate } from "@prisma/client";
import {
  Player,
  Monster,
  Projectile,
  Npc,
  QuestProgress,
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
  applyArmor,
  rollMagnitude,
  grantExperience,
  xpToNextLevel,
  HP_PER_LEVEL,
  type TileGrid,
  type JoinOptions,
  type MoveInputMessage,
  type CastInputMessage,
  type HealEventMessage,
  type GroundAoeEventMessage,
  type CastFizzledMessage,
  type TalkMessage,
  type AcceptQuestMessage,
  type TurnInQuestMessage,
  type NpcDialogueMessage,
  type NpcDialogueOption,
  type QuestActionFailedMessage,
  type QuestCompletedMessage,
  type EquipItemMessage,
  type UnequipItemMessage,
  type EquipActionFailedMessage,
  type InventoryStateMessage,
  type EquipmentSlot,
  type ItemSlotType,
  type ItemRarity,
  type SpellId,
  type SpellDef,
  type SpellKind,
  type CombatStats,
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

interface NpcRuntime {
  npcTemplateId: string;
}

interface EquipmentBonusTotals {
  armor: number;
  strength: number;
  intelligence: number;
  dexterity: number;
  criticalChance: number;
  hp: number;
}

const EMPTY_EQUIPMENT_BONUS: EquipmentBonusTotals = {
  armor: 0,
  strength: 0,
  intelligence: 0,
  dexterity: 0,
  criticalChance: 0,
  hp: 0,
};

type QuestFull = Quest & {
  targetNpc: NpcTemplate | null;
  monsterTemplate: MonsterTemplate | null;
  item: ItemTemplate | null;
  rewardItems: (QuestRewardItem & { item: ItemTemplate })[];
};

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
  // Whose stats to roll for damage scaling/crit and who to credit XP to on
  // kill — the caster who launched this projectile, not whoever it hits.
  casterSessionId: string;
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
  private characterStats = new Map<string, CombatStats>();
  private monsterRuntime = new Map<string, MonsterRuntime>();
  private npcRuntime = new Map<string, NpcRuntime>();
  private projectileRuntime = new Map<string, ProjectileRuntime>();
  private projectileSeq = 0;

  private mapGrid: TileGrid = { tileData: [[0]], tileSize: 32, cols: 1, rows: 1 };
  private spawnX = 0;
  private spawnY = 0;
  private spellDefsByClass = new Map<string, Map<SpellId, SpellDef>>();
  private questsById = new Map<string, QuestFull>();
  private questsByGiverNpc = new Map<string, QuestFull[]>();
  // Completed quest ids per session, so a finished quest is never re-offered
  // — loaded from CharacterQuest at onJoin, alongside the active ones synced
  // reactively via Player.quests.
  private completedQuestIds = new Map<string, Set<string>>();
  // Item templates aren't hot-reloaded (unlike spells/monsters/quests) — an
  // admin edit to an item's bonuses applies the next time it's equipped or a
  // character rejoins, not to a live session. Loaded once at room creation.
  private itemTemplatesById = new Map<string, ItemTemplate>();
  private equipmentBonus = new Map<string, EquipmentBonusTotals>();
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
    await this.reloadQuests();

    const itemRows = await prisma.itemTemplate.findMany();
    this.itemTemplatesById = new Map(itemRows.map((item) => [item.id, item]));

    this.unsubscribeContentEvents = onContentChanged((kind) => {
      if (kind === "spells") void this.reloadSpells();
      else if (kind === "monsters") void this.reloadMonsterTemplates();
      else if (kind === "quests") void this.reloadQuests();
    });

    const spawnRows = await prisma.monsterSpawn.findMany({
      where: { mapId: map.id },
      include: { monsterTemplate: true },
    });
    spawnRows.forEach((spawn, index) => {
      this.spawnMonster(`monster-${index}`, { x: spawn.x, y: spawn.y }, spawn.monsterTemplate);
    });

    const npcSpawnRows = await prisma.npcSpawn.findMany({
      where: { mapId: map.id },
      include: { npcTemplate: true },
    });
    npcSpawnRows.forEach((spawn, index) => {
      this.spawnNpc(`npc-${index}`, { x: spawn.x, y: spawn.y }, spawn.npcTemplate);
    });

    this.onMessage("move", (client, message: MoveInputMessage) => {
      if (!this.state.players.has(client.sessionId)) return;
      this.inputs.set(client.sessionId, message);
    });

    this.onMessage("cast", (client, message: CastInputMessage) => this.handleCast(client, message));
    this.onMessage("talk", (client, message: TalkMessage) => this.handleTalk(client, message));
    this.onMessage("acceptQuest", (client, message: AcceptQuestMessage) => void this.handleAcceptQuest(client, message));
    this.onMessage("turnInQuest", (client, message: TurnInQuestMessage) => void this.handleTurnInQuest(client, message));
    this.onMessage("equipItem", (client, message: EquipItemMessage) => void this.handleEquipItem(client, message));
    this.onMessage("unequipItem", (client, message: UnequipItemMessage) => void this.handleUnequipItem(client, message));

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
      monster.level = runtime.template.level;
    }
  }

  // Quests are cached at room creation for performance, same as spells —
  // rebuilt from scratch on every "quests" content event so create/update/
  // delete admin edits are all handled uniformly.
  private async reloadQuests() {
    const rows = await prisma.quest.findMany({
      include: { targetNpc: true, monsterTemplate: true, item: true, rewardItems: { include: { item: true } } },
    });

    this.questsById = new Map(rows.map((q) => [q.id, q]));
    this.questsByGiverNpc = new Map();
    for (const quest of rows) {
      const list = this.questsByGiverNpc.get(quest.giverNpcId) ?? [];
      list.push(quest);
      this.questsByGiverNpc.set(quest.giverNpcId, list);
    }
  }

  private objectiveSummary(quest: QuestFull, progress: number): string {
    switch (quest.objectiveType) {
      case "talkToNpc":
        return `Talk to ${quest.targetNpc?.name ?? "someone"}`;
      case "killMonsters":
        return `Kill ${quest.monsterTemplate?.name ?? "monsters"} (${progress}/${quest.requiredCount})`;
      case "bringItems":
        return `Bring ${quest.item?.name ?? "an item"} (${progress}/${quest.requiredCount})`;
    }
  }

  private spawnNpc(id: string, spawn: { x: number; y: number }, template: NpcTemplate) {
    const npc = new Npc();
    npc.id = id;
    npc.name = template.name;
    npc.x = spawn.x;
    npc.y = spawn.y;
    npc.color = template.color;
    this.state.npcs.set(id, npc);
    this.npcRuntime.set(id, { npcTemplateId: template.id });
  }

  private spawnMonster(id: string, spawn: { x: number; y: number }, template: MonsterTemplate) {
    const monster = new Monster();
    monster.id = id;
    monster.name = template.name;
    monster.x = spawn.x;
    monster.y = spawn.y;
    monster.hp = template.maxHp;
    monster.maxHp = template.maxHp;
    monster.level = template.level;
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
      const healAmount = this.rollForCaster(sessionId, player.className, spell.healAmount ?? 0);
      player.hp = Math.min(player.maxHp, player.hp + healAmount);
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
      casterSessionId: sessionId,
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
        const amount = this.rollForCaster(player.sessionId, player.className, spell.damage ?? 0);
        this.damageMonster(id, monster, amount, player.sessionId);
      }
    }

    for (const [sessionId, ally] of this.state.players) {
      if (Math.hypot(ally.x - targetX, ally.y - targetY) <= radius) {
        const healAmount = this.rollForCaster(player.sessionId, player.className, spell.healAmount ?? 0);
        ally.hp = Math.min(ally.maxHp, ally.hp + healAmount);
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

  // Rolls a caster's primary-stat bonus + crit chance for a spell's base
  // damage/heal magnitude. Falls back to the unmodified base if the caster
  // has already left (their entry in characterStats is gone) — a projectile
  // in flight can still land after its caster disconnects.
  private rollForCaster(casterSessionId: string, className: string, base: number): number {
    const stats = this.getEffectiveStats(casterSessionId);
    if (!stats) return base;
    return rollMagnitude(base, className, stats).amount;
  }

  private damagePlayer(player: Player, amount: number) {
    const now = this.clock.currentTime;
    const invulnUntil = this.invulnerableUntil.get(player.sessionId) ?? 0;
    if (now < invulnUntil) return;

    const armor = this.getEffectiveStats(player.sessionId)?.armor ?? 0;
    player.hp -= applyArmor(amount, armor);
    if (player.hp <= 0) {
      player.hp = player.maxHp;
      player.x = this.spawnX;
      player.y = this.spawnY;
      this.invulnerableUntil.set(player.sessionId, now + PLAYER_RESPAWN_INVULNERABLE_MS);
    }
  }

  private damageMonster(id: string, monster: Monster, amount: number, casterSessionId?: string) {
    const runtime = this.monsterRuntime.get(id);
    monster.hp -= applyArmor(amount, runtime?.template.armor ?? 0);
    if (monster.hp <= 0) {
      this.state.monsters.delete(id);
      if (runtime) {
        if (casterSessionId) {
          void this.grantXp(casterSessionId, runtime.template.xpReward);
          void this.trackMonsterKill(casterSessionId, runtime.template.id);
        }
        this.clock.setTimeout(
          () => this.spawnMonster(id, { x: runtime.homeX, y: runtime.homeY }, runtime.template),
          MONSTER_RESPAWN_MS,
        );
      }
    }
  }

  // Applies gained XP (handling multi-level-ups) and, only when a level-up
  // actually occurred, persists the new stat block immediately — an
  // infrequent, discrete event worth its own write rather than waiting for
  // onLeave. XP gained without a level-up still rides along with onLeave's
  // existing persistence.
  private async grantXp(sessionId: string, xpAmount: number) {
    const player = this.state.players.get(sessionId);
    const stats = this.characterStats.get(sessionId);
    const characterId = this.characterIds.get(sessionId);
    if (!player || !stats || !characterId) return;

    const { stats: updated, leveledUp } = grantExperience(player.className, stats, xpAmount);
    this.characterStats.set(sessionId, updated);

    player.level = updated.level;
    player.experience = updated.experience;
    player.xpToNextLevel = xpToNextLevel(updated.level);
    // Recomputes maxHp from the new level (plus equipment bonus) and
    // adjusts current hp by whatever that maxHp delta turns out to be —
    // same formula a level-up used to apply manually via hpGained.
    this.applyStatsToPlayer(sessionId);

    if (leveledUp) {
      console.log(`${player.name} leveled up to ${updated.level}`);
      try {
        await prisma.character.update({ where: { id: characterId }, data: { ...updated } });
      } catch (err) {
        console.error(`Failed to persist level-up for ${player.name}:`, err);
      }
    }
  }

  // Combat math (damage/heal scaling, armor mitigation) always reads through
  // here rather than characterStats directly, so equipped gear actually
  // matters in a fight — characterStats stays the "base" block that persists
  // to the Character row and grows on level-up, unaffected by what's equipped.
  private getEffectiveStats(sessionId: string): CombatStats | undefined {
    const base = this.characterStats.get(sessionId);
    if (!base) return undefined;
    const bonus = this.equipmentBonus.get(sessionId) ?? EMPTY_EQUIPMENT_BONUS;
    return {
      level: base.level,
      experience: base.experience,
      armor: base.armor + bonus.armor,
      strength: base.strength + bonus.strength,
      intelligence: base.intelligence + bonus.intelligence,
      dexterity: base.dexterity + bonus.dexterity,
      criticalChance: base.criticalChance + bonus.criticalChance,
    };
  }

  // The one place maxHp/armor/strength/intelligence/dexterity/criticalChance
  // are derived onto the synced Player fields — called on join, level-up, and
  // equip/unequip, so those three call sites can never drift out of sync.
  // maxHp changes are applied as a delta to current hp (same treatment a
  // level-up's HP gain always got), not a hard reset, so mid-fight HP isn't
  // clobbered by, say, unequipping a ring.
  private applyStatsToPlayer(sessionId: string) {
    const player = this.state.players.get(sessionId);
    const base = this.characterStats.get(sessionId);
    if (!player || !base) return;
    const bonus = this.equipmentBonus.get(sessionId) ?? EMPTY_EQUIPMENT_BONUS;

    const newMaxHp = PLAYER_MAX_HP + (base.level - 1) * HP_PER_LEVEL + bonus.hp;
    const delta = newMaxHp - player.maxHp;
    player.maxHp = newMaxHp;
    player.hp = Math.max(0, Math.min(newMaxHp, player.hp + delta));

    player.armor = base.armor + bonus.armor;
    player.strength = base.strength + bonus.strength;
    player.intelligence = base.intelligence + bonus.intelligence;
    player.dexterity = base.dexterity + bonus.dexterity;
    player.criticalChance = base.criticalChance + bonus.criticalChance;
  }

  private async loadEquipmentBonus(sessionId: string, characterId: string) {
    const rows = await prisma.characterEquipment.findMany({ where: { characterId }, include: { item: true } });
    const bonus: EquipmentBonusTotals = { ...EMPTY_EQUIPMENT_BONUS };
    for (const row of rows) {
      bonus.armor += row.item.bonusArmor;
      bonus.strength += row.item.bonusStrength;
      bonus.intelligence += row.item.bonusIntelligence;
      bonus.dexterity += row.item.bonusDexterity;
      bonus.criticalChance += row.item.bonusCriticalChance;
      bonus.hp += row.item.bonusHp;
    }
    this.equipmentBonus.set(sessionId, bonus);
  }

  // Inventory/equipment are private per-character data with no need for
  // other clients to see them, so they're pushed on demand (join, quest
  // reward, equip, unequip) rather than synced via room state.
  private async sendInventoryState(client: Client) {
    const characterId = this.characterIds.get(client.sessionId);
    if (!characterId) return;

    const [items, equipped] = await Promise.all([
      prisma.characterItem.findMany({ where: { characterId }, include: { item: true } }),
      prisma.characterEquipment.findMany({ where: { characterId }, include: { item: true } }),
    ]);

    const message: InventoryStateMessage = {
      items: items.map((row) => ({
        itemId: row.itemId,
        name: row.item.name,
        description: row.item.description,
        color: row.item.color,
        rarity: row.item.rarity as ItemRarity,
        slotType: row.item.slotType as ItemSlotType | null,
        quantity: row.quantity,
      })),
      equipped: equipped.map((row) => ({
        slot: row.slot as EquipmentSlot,
        itemId: row.itemId,
        name: row.item.name,
        color: row.item.color,
        rarity: row.item.rarity as ItemRarity,
      })),
    };
    client.send("inventoryState", message);
  }

  private slotMatchesCategory(slot: EquipmentSlot, slotType: ItemSlotType): boolean {
    if (slotType === "ring") return slot === "ring1" || slot === "ring2";
    if (slotType === "trinket") return slot === "trinket1" || slot === "trinket2";
    return slot === slotType;
  }

  private async handleEquipItem(client: Client, message: EquipItemMessage) {
    const sessionId = client.sessionId;
    const characterId = this.characterIds.get(sessionId);
    if (!characterId) return;

    const item = this.itemTemplatesById.get(message.itemId);
    if (!item || !item.slotType || !this.slotMatchesCategory(message.slot, item.slotType as ItemSlotType)) {
      client.send("equipActionFailed", { reason: "That item can't go there." } satisfies EquipActionFailedMessage);
      return;
    }

    const owned = await prisma.characterItem.findUnique({
      where: { characterId_itemId: { characterId, itemId: item.id } },
    });
    if (!owned || owned.quantity < 1) {
      client.send("equipActionFailed", { reason: "You don't have that item." } satisfies EquipActionFailedMessage);
      return;
    }

    try {
      await prisma.$transaction(async (tx) => {
        if (owned.quantity === 1) {
          await tx.characterItem.delete({ where: { id: owned.id } });
        } else {
          await tx.characterItem.update({ where: { id: owned.id }, data: { quantity: { decrement: 1 } } });
        }

        // Whatever was already in that slot goes back to the bag — equipping
        // is a swap, not a discard.
        const existing = await tx.characterEquipment.findUnique({
          where: { characterId_slot: { characterId, slot: message.slot } },
        });
        if (existing) {
          await tx.characterItem.upsert({
            where: { characterId_itemId: { characterId, itemId: existing.itemId } },
            update: { quantity: { increment: 1 } },
            create: { characterId, itemId: existing.itemId, quantity: 1 },
          });
        }

        await tx.characterEquipment.upsert({
          where: { characterId_slot: { characterId, slot: message.slot } },
          update: { itemId: item.id },
          create: { characterId, slot: message.slot, itemId: item.id },
        });
      });
    } catch (err) {
      console.error(`Failed to equip item for session ${sessionId}:`, err);
      client.send("equipActionFailed", { reason: "Could not equip item." } satisfies EquipActionFailedMessage);
      return;
    }

    await this.loadEquipmentBonus(sessionId, characterId);
    this.applyStatsToPlayer(sessionId);
    await this.sendInventoryState(client);
  }

  private async handleUnequipItem(client: Client, message: UnequipItemMessage) {
    const sessionId = client.sessionId;
    const characterId = this.characterIds.get(sessionId);
    if (!characterId) return;

    const existing = await prisma.characterEquipment.findUnique({
      where: { characterId_slot: { characterId, slot: message.slot } },
    });
    if (!existing) {
      client.send("equipActionFailed", { reason: "Nothing equipped there." } satisfies EquipActionFailedMessage);
      return;
    }

    try {
      await prisma.$transaction(async (tx) => {
        await tx.characterEquipment.delete({ where: { id: existing.id } });
        await tx.characterItem.upsert({
          where: { characterId_itemId: { characterId, itemId: existing.itemId } },
          update: { quantity: { increment: 1 } },
          create: { characterId, itemId: existing.itemId, quantity: 1 },
        });
      });
    } catch (err) {
      console.error(`Failed to unequip item for session ${sessionId}:`, err);
      client.send("equipActionFailed", { reason: "Could not unequip item." } satisfies EquipActionFailedMessage);
      return;
    }

    await this.loadEquipmentBonus(sessionId, characterId);
    this.applyStatsToPlayer(sessionId);
    await this.sendInventoryState(client);
  }

  // Increments progress on any of this character's active killMonsters
  // quests targeting the template that just died. Persisted immediately
  // (rather than batched with onLeave) so a disconnect right after the kill
  // can't lose it.
  private async trackMonsterKill(sessionId: string, monsterTemplateId: string) {
    const player = this.state.players.get(sessionId);
    const characterId = this.characterIds.get(sessionId);
    if (!player || !characterId) return;

    for (const entry of player.quests) {
      const quest = this.questsById.get(entry.questId);
      if (!quest || quest.objectiveType !== "killMonsters" || quest.monsterTemplateId !== monsterTemplateId) continue;
      if (entry.progress >= entry.requiredCount) continue;

      entry.progress += 1;
      entry.ready = entry.progress >= entry.requiredCount;
      entry.objectiveSummary = this.objectiveSummary(quest, entry.progress);

      try {
        await prisma.characterQuest.update({
          where: { characterId_questId: { characterId, questId: quest.id } },
          data: { progress: entry.progress },
        });
      } catch (err) {
        console.error(`Failed to persist quest progress for ${player.name}:`, err);
      }
    }
  }

  // bringItems readiness can only change when the character's inventory
  // changes, which (for now) only happens via quest rewards — so this is
  // called after accept (a fresh quest might already be satisfiable) and
  // after turn-in (the reward just granted might satisfy another).
  private async refreshBringItemsReadiness(sessionId: string) {
    const player = this.state.players.get(sessionId);
    const characterId = this.characterIds.get(sessionId);
    if (!player || !characterId) return;

    for (const entry of player.quests) {
      const quest = this.questsById.get(entry.questId);
      if (!quest || quest.objectiveType !== "bringItems" || !quest.itemId) continue;

      const owned = await prisma.characterItem.findUnique({
        where: { characterId_itemId: { characterId, itemId: quest.itemId } },
      });
      const quantity = owned?.quantity ?? 0;
      entry.progress = Math.min(quantity, quest.requiredCount);
      entry.ready = quantity >= quest.requiredCount;
      entry.objectiveSummary = this.objectiveSummary(quest, entry.progress);
    }
  }

  private findNpcTemplateId(npcEntityId: string): string | undefined {
    return this.npcRuntime.get(npcEntityId)?.npcTemplateId;
  }

  private handleTalk(client: Client, message: TalkMessage) {
    const sessionId = client.sessionId;
    const player = this.state.players.get(sessionId);
    const npc = this.state.npcs.get(message.npcId);
    const npcTemplateId = this.findNpcTemplateId(message.npcId);
    if (!player || !npc || !npcTemplateId) return;

    void this.buildAndSendDialogue(client, player, message.npcId, npc.name, npcTemplateId);
  }

  private async buildAndSendDialogue(
    client: Client,
    player: Player,
    npcId: string,
    npcName: string,
    npcTemplateId: string,
  ) {
    const sessionId = client.sessionId;

    // Talking to an NPC that's the *target* of an active talkToNpc quest
    // (regardless of who gave it) satisfies that objective right away.
    const characterId = this.characterIds.get(sessionId);
    for (const entry of player.quests) {
      const quest = this.questsById.get(entry.questId);
      if (!quest || quest.objectiveType !== "talkToNpc" || quest.targetNpcId !== npcTemplateId) continue;
      if (entry.ready) continue;

      entry.progress = 1;
      entry.ready = true;
      entry.objectiveSummary = this.objectiveSummary(quest, 1);

      if (!characterId) continue;
      try {
        await prisma.characterQuest.update({
          where: { characterId_questId: { characterId, questId: quest.id } },
          data: { progress: 1 },
        });
      } catch (err) {
        console.error(`Failed to persist talk-objective progress for ${player.name}:`, err);
      }
    }

    const completed = this.completedQuestIds.get(sessionId) ?? new Set<string>();
    const activeQuestIds = new Set([...player.quests].map((e) => e.questId));

    const options: NpcDialogueOption[] = [];

    for (const entry of player.quests) {
      const quest = this.questsById.get(entry.questId);
      if (!quest || quest.giverNpcId !== npcTemplateId) continue;
      options.push({
        kind: entry.ready ? "turnIn" : "inProgress",
        questId: quest.id,
        title: quest.title,
        description: quest.description,
        objectiveSummary: entry.objectiveSummary,
      });
    }

    const offerable = this.questsByGiverNpc.get(npcTemplateId) ?? [];
    for (const quest of offerable) {
      if (activeQuestIds.has(quest.id) || completed.has(quest.id)) continue;
      options.push({
        kind: "offer",
        questId: quest.id,
        title: quest.title,
        description: quest.description,
        objectiveSummary: this.objectiveSummary(quest, 0),
      });
    }

    client.send("npcDialogue", { npcId, npcName, options } satisfies NpcDialogueMessage);
  }

  private async handleAcceptQuest(client: Client, message: AcceptQuestMessage) {
    const sessionId = client.sessionId;
    const player = this.state.players.get(sessionId);
    const characterId = this.characterIds.get(sessionId);
    const quest = this.questsById.get(message.questId);
    if (!player || !characterId || !quest) return;

    const alreadyActive = [...player.quests].some((e) => e.questId === quest.id);
    const alreadyCompleted = this.completedQuestIds.get(sessionId)?.has(quest.id);
    if (alreadyActive || alreadyCompleted) {
      client.send("questActionFailed", { questId: quest.id, reason: "You already have this quest." } satisfies QuestActionFailedMessage);
      return;
    }

    try {
      await prisma.characterQuest.create({ data: { characterId, questId: quest.id, status: "active", progress: 0 } });
    } catch (err) {
      console.error(`Failed to accept quest for ${player.name}:`, err);
      client.send("questActionFailed", { questId: quest.id, reason: "Could not accept quest." } satisfies QuestActionFailedMessage);
      return;
    }

    const entry = new QuestProgress();
    entry.questId = quest.id;
    entry.title = quest.title;
    entry.requiredCount = quest.requiredCount;
    entry.progress = 0;
    entry.ready = false;
    entry.objectiveSummary = this.objectiveSummary(quest, 0);
    player.quests.push(entry);

    if (quest.objectiveType === "bringItems") await this.refreshBringItemsReadiness(sessionId);
  }

  private async handleTurnInQuest(client: Client, message: TurnInQuestMessage) {
    const sessionId = client.sessionId;
    const player = this.state.players.get(sessionId);
    const characterId = this.characterIds.get(sessionId);
    const quest = this.questsById.get(message.questId);
    if (!player || !characterId || !quest) return;

    const index = [...player.quests].findIndex((e) => e.questId === quest.id);
    if (index === -1) return;
    const entry = player.quests[index];

    if (quest.objectiveType === "bringItems") await this.refreshBringItemsReadiness(sessionId);
    if (!entry.ready) {
      client.send("questActionFailed", { questId: quest.id, reason: "This quest isn't ready to turn in yet." } satisfies QuestActionFailedMessage);
      return;
    }

    try {
      await prisma.$transaction(async (tx) => {
        if (quest.objectiveType === "bringItems" && quest.itemId) {
          const owned = await tx.characterItem.findUnique({
            where: { characterId_itemId: { characterId, itemId: quest.itemId } },
          });
          if (!owned || owned.quantity < quest.requiredCount) {
            throw new Error("insufficient-items");
          }
          if (owned.quantity === quest.requiredCount) {
            await tx.characterItem.delete({ where: { id: owned.id } });
          } else {
            await tx.characterItem.update({ where: { id: owned.id }, data: { quantity: { decrement: quest.requiredCount } } });
          }
        }

        for (const reward of quest.rewardItems) {
          await tx.characterItem.upsert({
            where: { characterId_itemId: { characterId, itemId: reward.itemId } },
            update: { quantity: { increment: reward.quantity } },
            create: { characterId, itemId: reward.itemId, quantity: reward.quantity },
          });
        }

        await tx.characterQuest.update({
          where: { characterId_questId: { characterId, questId: quest.id } },
          data: { status: "completed" },
        });
      });
    } catch (err) {
      if (err instanceof Error && err.message === "insufficient-items") {
        client.send("questActionFailed", { questId: quest.id, reason: "You don't have the required items." } satisfies QuestActionFailedMessage);
        return;
      }
      console.error(`Failed to turn in quest for ${player.name}:`, err);
      client.send("questActionFailed", { questId: quest.id, reason: "Could not turn in quest." } satisfies QuestActionFailedMessage);
      return;
    }

    player.quests.splice(index, 1);
    let completed = this.completedQuestIds.get(sessionId);
    if (!completed) {
      completed = new Set();
      this.completedQuestIds.set(sessionId, completed);
    }
    completed.add(quest.id);

    if (quest.rewardXp > 0) void this.grantXp(sessionId, quest.rewardXp);

    client.send("questCompleted", {
      questId: quest.id,
      title: quest.title,
      rewardXp: quest.rewardXp,
      rewardItems: quest.rewardItems.map((r) => ({ name: r.item.name, quantity: r.quantity })),
    } satisfies QuestCompletedMessage);

    // The reward just granted might satisfy another active bringItems quest.
    await this.refreshBringItemsReadiness(sessionId);
    await this.sendInventoryState(client);
  }

  private resolveSpellHit(
    spell: SpellDef,
    monster: Monster,
    monsterId: string,
    hitX: number,
    hitY: number,
    casterSessionId: string,
  ) {
    const casterClassName = this.state.players.get(casterSessionId)?.className ?? "";

    if (spell.kind === "aoe") {
      const radius = spell.aoeRadius ?? 0;
      for (const [id, m] of this.state.monsters) {
        const dist = Math.hypot(m.x - hitX, m.y - hitY);
        if (dist <= radius) {
          const amount = this.rollForCaster(casterSessionId, casterClassName, spell.damage ?? 0);
          this.damageMonster(id, m, amount, casterSessionId);
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

    const amount = this.rollForCaster(casterSessionId, casterClassName, spell.damage ?? 0);
    this.damageMonster(monsterId, monster, amount, casterSessionId);
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
            this.resolveSpellHit(spell, monster, monsterId, projectile.x, projectile.y, runtime.casterSessionId);
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

    const stats: CombatStats = {
      level: character.level,
      experience: character.experience,
      armor: character.armor,
      strength: character.strength,
      intelligence: character.intelligence,
      dexterity: character.dexterity,
      criticalChance: character.criticalChance,
    };
    this.characterStats.set(client.sessionId, stats);
    this.characterIds.set(client.sessionId, character.id);
    await this.loadEquipmentBonus(client.sessionId, character.id);

    const player = new Player();
    player.sessionId = client.sessionId;
    player.name = character.name;
    player.x = character.x;
    player.y = character.y;
    player.classId = character.class.id;
    player.className = character.class.name;
    player.level = character.level;
    player.experience = character.experience;
    player.xpToNextLevel = xpToNextLevel(character.level);

    this.state.players.set(client.sessionId, player);
    // Derives maxHp/hp and armor/strength/intelligence/dexterity/critChance
    // from characterStats + equipmentBonus — the one place that formula
    // lives, so join, level-up, and equip/unequip can never disagree.
    this.applyStatsToPlayer(client.sessionId);
    await this.sendInventoryState(client);

    const characterQuests = await prisma.characterQuest.findMany({ where: { characterId: character.id } });
    const completed = new Set<string>();
    for (const cq of characterQuests) {
      if (cq.status === "completed") {
        completed.add(cq.questId);
        continue;
      }
      const quest = this.questsById.get(cq.questId);
      if (!quest) continue; // quest was deleted from content since this was accepted

      const entry = new QuestProgress();
      entry.questId = quest.id;
      entry.title = quest.title;
      entry.requiredCount = quest.requiredCount;
      entry.progress = cq.progress;
      entry.ready = cq.progress >= quest.requiredCount;
      entry.objectiveSummary = this.objectiveSummary(quest, cq.progress);
      player.quests.push(entry);
    }
    this.completedQuestIds.set(client.sessionId, completed);
    if (player.quests.some((e) => this.questsById.get(e.questId)?.objectiveType === "bringItems")) {
      await this.refreshBringItemsReadiness(client.sessionId);
    }

    console.log(`${player.name} (${player.className}) joined ${this.roomId}`);
  }

  async onLeave(client: Client) {
    const player = this.state.players.get(client.sessionId);
    const characterId = this.characterIds.get(client.sessionId);
    const stats = this.characterStats.get(client.sessionId);
    this.state.players.delete(client.sessionId);
    this.characterIds.delete(client.sessionId);
    this.characterStats.delete(client.sessionId);
    this.inputs.delete(client.sessionId);
    this.invulnerableUntil.delete(client.sessionId);
    this.interruptCast(client.sessionId);
    this.gcdUntil.delete(client.sessionId);
    this.completedQuestIds.delete(client.sessionId);
    for (let spellId = 1; spellId <= 6; spellId++) {
      this.lastCastAt.delete(`${client.sessionId}:${spellId}`);
    }

    if (player && characterId) {
      try {
        await prisma.character.update({
          where: { id: characterId },
          data: {
            x: player.x,
            y: player.y,
            ...(stats && {
              level: stats.level,
              experience: stats.experience,
              armor: stats.armor,
              strength: stats.strength,
              intelligence: stats.intelligence,
              dexterity: stats.dexterity,
            }),
          },
        });
      } catch (err) {
        console.error(`Failed to save position for ${player.name}:`, err);
      }
    }

    console.log(`${player?.name ?? client.sessionId} left ${this.roomId}`);
  }
}
