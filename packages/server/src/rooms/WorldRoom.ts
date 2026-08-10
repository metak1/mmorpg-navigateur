import { Room, Client, matchMaker, type Delayed } from "@colyseus/core";
import { prisma } from "../db.js";
import { onContentChanged } from "../contentEvents.js";
import { verifyToken } from "../auth/jwt.js";
import type {
  MonsterTemplate,
  MonsterDrop,
  MapAmbientSpawn,
  SpellTemplate,
  Quest,
  QuestRewardItem,
  ItemTemplate,
  NpcTemplate,
  TalentTemplate,
  TalentEffect,
} from "@prisma/client";
import {
  Player,
  Monster,
  Projectile,
  Npc,
  Portal,
  QuestProgress,
  DungeonObjectiveState,
  RoomState,
  WORLD_ROOM,
  DUNGEON_ROOM,
  MAX_PARTY_SIZE,
  MOVE_SPEED,
  resolveMovement,
  isWalkableCell,
  isWalkableAt,
  isBlockedByBarrier,
  hasLineOfSight,
  ChunkTileCache,
  CHUNK_SIZE,
  chunkKeyFor,
  chunkOriginFromKey,
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
  talentPointsForLevel,
  canLearnTalent,
  type JoinOptions,
  type MoveInputMessage,
  type ZoneBlockedMessage,
  type CastInputMessage,
  type HealEventMessage,
  type GroundAoeEventMessage,
  type CastFizzledMessage,
  type CastFailedMessage,
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
  type LootDroppedMessage,
  type XpGainedMessage,
  type CompletedQuestsStateMessage,
  type LearnTalentMessage,
  type TalentActionFailedMessage,
  type TalentStateMessage,
  type AdminSetLevelMessage,
  type TalentSpellParam,
  type TalentMechanicFlag,
  type CreatePartyMessage,
  type InvitePartyMessage,
  type RespondPartyInviteMessage,
  type LeavePartyMessage,
  type PartyActionFailedMessage,
  type PartyInviteReceivedMessage,
  type PartyMemberView,
  type PartyStateMessage,
  type SetPartyOpenMessage,
  type ApplyToPartyMessage,
  type WithdrawPartyApplicationMessage,
  type RespondPartyApplicationMessage,
  type PartyApplicantView,
  type PartyApplicationsStateMessage,
  type PartyApplicationDeclinedMessage,
  type OpenPartyView,
  type OpenPartiesStateMessage,
  type UsePortalMessage,
  type PortalFailedMessage,
  type PortalGrantedMessage,
  type DungeonClearedMessage,
  type DungeonPromptMessage,
  type EnterDungeonMessage,
  type DungeonObjectiveKind,
  PORTAL_INTERACT_RANGE,
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
// Chunks of terrain are preloaded in a radius around each player this many
// chunks wide/tall, on a throttled interval — see preloadChunksAroundPlayers.
const CHUNK_PRELOAD_RADIUS = 3;
const CHUNK_PRELOAD_INTERVAL_MS = 500;
// Hard ceiling on procedurally-spawned (not hand-placed) monsters that can
// ever exist in one room's lifetime — there's no interest management in
// this codebase (every client is sent every entity regardless of distance),
// so this bounds worst-case sync/simulation cost at a fixed number rather
// than letting it grow forever as players explore. Gates new ambient spawn
// rolls only; once created, an ambient monster still respawns forever at
// its rolled position via the same timer hand-placed spawns use.
const MAX_AMBIENT_MONSTERS = 150;
// Re-notification cooldown for ZoneBlockedMessage — holding a direction into
// a barrier cell re-shows the notice at most this often, rather than once
// per simulation tick.
const ZONE_BLOCKED_NOTICE_INTERVAL_MS = 4000;
const ZONE_BLOCKED_MESSAGE = "This zone hasn't been implemented yet.";

type MonsterTemplateWithDrops = MonsterTemplate & { drops: MonsterDrop[] };

interface MonsterRuntime {
  homeX: number;
  homeY: number;
  wanderTargetX: number;
  wanderTargetY: number;
  nextWanderAt: number;
  slowUntil: number;
  slowMultiplier: number;
  lastAttackAt: number;
  // Independent of lastAttackAt (melee) — a monster with a ranged spell
  // configured (see MonsterTemplate.spellDamage etc.) has the two on
  // separate cooldowns, same as a player's per-spell cooldown vs GCD.
  lastSpellCastAt: number;
  template: MonsterTemplateWithDrops;
  // Marks this specific placement (not the template) as a dungeon's boss —
  // see MonsterSpawn.isBoss. Killing it broadcasts DungeonClearedMessage
  // (see damageMonster). Preserved across respawns (though respawn is
  // itself disabled for the whole duration of a dungeon instance — see
  // isDungeonInstance).
  isBoss: boolean;
}

// Room-creation options (see WorldRoom.handleUsePortal, which is the only
// caller of matchMaker.createRoom(DUNGEON_ROOM, {...})). Left both
// undefined for the plain overworld case (WORLD_ROOM, joined via ordinary
// joinOrCreate) — mapId then falls back to querying the active map, and no
// character-allowlist check applies.
interface WorldRoomOptions {
  mapId?: string;
  allowedCharacterIds?: string[];
  // The map a dungeon instance's exit portal should lead back to — the map
  // whose portal was used to create this instance (see handleUsePortal),
  // not necessarily "the" overworld map, since nothing rules out a dungeon
  // being entered from another dungeon. Undefined for the plain overworld
  // room, where no exit portal is ever spawned.
  returnMapId?: string;
}

interface PortalRuntime {
  targetMapId: string;
}

// One in-flight monster ranged-spell cast, keyed by monster id — mirrors
// the player-side castTimeouts/castingUntil pair, just scoped per-monster
// instead of per-session since several monsters can be casting at once.
interface MonsterCastRuntime {
  timeout: Delayed;
  targetSessionId: string;
}

interface Party {
  leaderSessionId: string;
  memberSessionIds: string[];
  // Leader-controlled — see SetPartyOpenMessage. Gates both visibility in
  // the browsable open-parties list (computeOpenParties) and whether
  // applyToParty accepts new applications at all.
  open: boolean;
  // Pending join requests from players who applied via an open listing,
  // awaiting the leader's accept/decline — see handleApplyToParty /
  // handleRespondPartyApplication. Private to the leader (sendPartyApplications).
  applicantSessionIds: string[];
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

function applyPercent(value: number, percent: number): number {
  return value * (1 + percent / 100);
}

type TalentTemplateFull = TalentTemplate & { effects: TalentEffect[] };

// A statBonus talent's flat and percent contributions are kept separate
// (not pre-merged into one number) because percent has to be applied on top
// of base+equipment+flat *every time those change* (level-up growing a base
// stat, gear swapping) — see getEffectiveStats/applyStatsToPlayer, the only
// two places this is ever read.
interface StatBonusSplit {
  flat: EquipmentBonusTotals;
  percent: EquipmentBonusTotals;
}

const EMPTY_TALENT_BONUS: StatBonusSplit = { flat: EMPTY_EQUIPMENT_BONUS, percent: EMPTY_EQUIPMENT_BONUS };

function sumTalentRanks(learned: Map<string, number> | undefined): number {
  if (!learned) return 0;
  let total = 0;
  for (const rank of learned.values()) total += rank;
  return total;
}

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
  // Throttle for ZoneBlockedMessage — see updatePlayers's barrier check.
  private lastZoneBlockedNoticeAt = new Map<string, number>();
  private lastCastAt = new Map<string, number>();
  private castingUntil = new Map<string, number>();
  private castTimeouts = new Map<string, Delayed>();
  private gcdUntil = new Map<string, number>();
  private invulnerableUntil = new Map<string, number>();
  private characterIds = new Map<string, string>();
  private characterStats = new Map<string, CombatStats>();
  // Whether the account behind this session is an admin — set once at
  // onJoin from the JWT payload (already carries the account's role, no
  // extra DB query needed), read by handleAdminSetLevel to gate debug
  // commands. Not itself sent to any client.
  private isAdmin = new Map<string, boolean>();
  private monsterRuntime = new Map<string, MonsterRuntime>();
  private monsterCastRuntime = new Map<string, MonsterCastRuntime>();
  private npcRuntime = new Map<string, NpcRuntime>();
  private portalRuntime = new Map<string, PortalRuntime>();
  private projectileRuntime = new Map<string, ProjectileRuntime>();
  private projectileSeq = 0;

  // True for a dungeon instance (created via matchMaker.createRoom with
  // allowedCharacterIds — see handleUsePortal), false for the plain
  // overworld room. Gates: which characters may onJoin, whether a player
  // spawns at their persisted overworld position vs the map's spawn point,
  // whether onLeave persists x/y back to Character, whether ambient
  // spawning runs at all, and whether a dead monster respawns.
  private isDungeonInstance = false;
  private allowedCharacterIds?: Set<string>;
  // See WorldRoomOptions.returnMapId — where a dungeon's dynamically-spawned
  // exit portal (see clearDungeon) leads.
  private returnMapId?: string;
  // Guards clearDungeon against firing more than once — e.g. a dungeon with
  // no authored objectives can still have more than one boss-flagged
  // monster, and one with objectives could satisfy its last one on a kill
  // that also completes an unrelated killAllMonsters objective in the same
  // pass (see updateDungeonObjectives).
  private dungeonAlreadyCleared = false;
  // Server-only per-objective data backing this.state.dungeonObjectives
  // (synced schema only carries what the client needs to render a
  // checklist — see DungeonObjectiveState) — populated once at onCreate,
  // keyed by DungeonObjectiveState.id.
  private dungeonObjectiveMeta = new Map<string, { kind: DungeonObjectiveKind; monsterTemplateId?: string }>();
  // In-memory only — parties are session-scoped, not persisted, and every
  // overworld player already shares this one room instance, so no cross-
  // room presence infrastructure is needed for them to find each other.
  private parties = new Map<string, Party>();
  private partyIdBySession = new Map<string, string>();
  private partySeq = 0;

  // Built once in onCreate (map.id isn't known before then) — every
  // collision/LoS/prediction call site below reads through this rather than
  // a bounded grid, since the world has no edges.
  private chunkCache!: ChunkTileCache;
  private mapId = "";
  private spawnX = 0;
  private spawnY = 0;
  // Ambient (procedural) monster spawning config for the active map, plus
  // the bookkeeping that keeps each chunk from rolling more than once per
  // room lifetime and keeps the total population bounded.
  private ambientSpawnChance = 0;
  private ambientSpawnRules: MapAmbientSpawn[] = [];
  private rolledAmbientChunks = new Set<string>();
  private playerLastChunk = new Map<string, string>();
  private ambientMonsterSeq = 0;
  private ambientMonsterCount = 0;
  // Kept alongside each monster's own cached template (on its runtime entry)
  // so ambient spawns — which don't go through a MonsterSpawn row — have
  // somewhere to look up a MonsterTemplateWithDrops by id.
  private monsterTemplatesById = new Map<string, MonsterTemplateWithDrops>();
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
  // Populated by reloadSpells (keyed by SpellTemplate.id, the cuid a
  // TalentEffect.spellTemplateId FK points at) — needed to resolve that FK
  // back to the (classId, keybind) pair SpellId actually keys off, since
  // getSpellValue is called with a SpellId, not a SpellTemplate row id.
  private spellTemplatesById = new Map<string, SpellTemplate>();
  private talentTemplatesById = new Map<string, TalentTemplateFull>();
  // Per-session: which talents this character has learned and at what rank.
  // Private per-character data, not schema-synced — see sendTalentState.
  private learnedTalents = new Map<string, Map<string, number>>();
  private talentBonus = new Map<string, StatBonusSplit>();
  private unsubscribeContentEvents?: () => void;

  async onCreate(options: WorldRoomOptions = {}) {
    this.setState(new RoomState());

    // The plain overworld room (WORLD_ROOM, joined via ordinary
    // joinOrCreate) always loads whichever map is flagged active; a dungeon
    // instance (DUNGEON_ROOM, only ever created explicitly by
    // handleUsePortal's matchMaker.createRoom call) loads a specific map by
    // id instead and restricts who may onJoin.
    const map = options.mapId
      ? await prisma.gameMap.findUnique({ where: { id: options.mapId } })
      : await prisma.gameMap.findFirst({ where: { isActive: true } });
    if (!map) {
      throw new Error("No active map found in the database. Run `npx prisma db seed` in packages/server.");
    }

    this.isDungeonInstance = options.allowedCharacterIds !== undefined;
    this.allowedCharacterIds = options.allowedCharacterIds ? new Set(options.allowedCharacterIds) : undefined;
    this.returnMapId = options.returnMapId;

    this.mapId = map.id;
    this.spawnX = map.spawnX;
    this.spawnY = map.spawnY;
    this.chunkCache = new ChunkTileCache(map.tileSize, async (minCol, minRow, maxCol, maxRow) => {
      const rows = await prisma.mapTile.findMany({
        where: { mapId: map.id, col: { gte: minCol, lte: maxCol }, row: { gte: minRow, lte: maxRow } },
      });
      return rows.map((r) => ({ col: r.col, row: r.row, tileType: r.tileType, elevation: r.elevation, blocksMovement: r.blocksMovement }));
    });

    await this.reloadSpells();
    await this.reloadQuests();
    await this.reloadTalents();

    const itemRows = await prisma.itemTemplate.findMany();
    this.itemTemplatesById = new Map(itemRows.map((item) => [item.id, item]));

    const templateRows = await prisma.monsterTemplate.findMany({ include: { drops: true } });
    this.monsterTemplatesById = new Map(templateRows.map((t) => [t.id, t]));

    // No procedural spawning inside a dungeon instance — ambientSpawnChance
    // stays 0 and ambientSpawnRules stays empty (its field default).
    if (!this.isDungeonInstance) {
      this.ambientSpawnChance = map.ambientSpawnChance;
      this.ambientSpawnRules = await prisma.mapAmbientSpawn.findMany({ where: { mapId: map.id } });
    }

    this.unsubscribeContentEvents = onContentChanged((kind) => {
      if (kind === "spells") void this.reloadSpells();
      else if (kind === "monsters") void this.reloadMonsterTemplates();
      else if (kind === "quests") void this.reloadQuests();
      else if (kind === "maps") void this.reloadMapContent();
      else if (kind === "talents") void this.reloadTalents();
    });

    this.clock.setInterval(() => this.preloadChunksAroundPlayers(), CHUNK_PRELOAD_INTERVAL_MS);

    const spawnRows = await prisma.monsterSpawn.findMany({
      where: { mapId: map.id },
      include: { monsterTemplate: { include: { drops: true } } },
    });
    spawnRows.forEach((spawn, index) => {
      this.spawnMonster(`monster-${index}`, { x: spawn.x, y: spawn.y }, spawn.monsterTemplate, spawn.isBoss);
    });

    // Only meaningful for a dungeon instance — the plain overworld room has
    // no "cleared" concept. A map with no DungeonObjective rows leaves
    // state.dungeonObjectives empty, which is exactly what
    // updateDungeonObjectives treats as "fall back to the old hardcoded
    // any-boss-kill-clears-it rule."
    if (this.isDungeonInstance) {
      const objectiveRows = await prisma.dungeonObjective.findMany({ where: { mapId: map.id }, orderBy: { order: "asc" } });
      for (const row of objectiveRows) {
        const objective = new DungeonObjectiveState();
        objective.id = row.id;
        objective.description = row.description;
        objective.progress = 0;
        objective.completed = false;
        // killBoss always needs exactly one boss kill; killAllMonsters'
        // target is this instance's own hand-placed monster count (there's
        // no ambient spawning inside a dungeon instance, so spawnRows.length
        // is the total that will ever exist); killCount uses whatever the
        // admin set.
        objective.requiredCount =
          row.kind === "killBoss" ? 1 : row.kind === "killAllMonsters" ? spawnRows.length : (row.requiredCount ?? 1);
        this.state.dungeonObjectives.push(objective);
        this.dungeonObjectiveMeta.set(row.id, {
          kind: row.kind as DungeonObjectiveKind,
          monsterTemplateId: row.monsterTemplateId ?? undefined,
        });
      }
    }

    const npcSpawnRows = await prisma.npcSpawn.findMany({
      where: { mapId: map.id },
      include: { npcTemplate: true },
    });
    npcSpawnRows.forEach((spawn, index) => {
      this.spawnNpc(`npc-${index}`, { x: spawn.x, y: spawn.y }, spawn.npcTemplate);
    });

    const portalRows = await prisma.mapPortal.findMany({ where: { mapId: map.id } });
    portalRows.forEach((row, index) => {
      const id = `portal-${index}`;
      const portal = new Portal();
      portal.id = id;
      portal.x = row.x;
      portal.y = row.y;
      this.state.portals.set(id, portal);
      this.portalRuntime.set(id, { targetMapId: row.targetMapId });
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
    this.onMessage("learnTalent", (client, message: LearnTalentMessage) => void this.handleLearnTalent(client, message));
    this.onMessage("adminSetLevel", (client, message: AdminSetLevelMessage) => void this.handleAdminSetLevel(client, message));
    this.onMessage("createParty", (client, _message: CreatePartyMessage) => this.handleCreateParty(client));
    this.onMessage("inviteParty", (client, message: InvitePartyMessage) => this.handleInviteParty(client, message));
    this.onMessage("respondPartyInvite", (client, message: RespondPartyInviteMessage) =>
      this.handleRespondPartyInvite(client, message),
    );
    this.onMessage("leaveParty", (client: Client, _message: LeavePartyMessage) => this.handleLeaveParty(client));
    this.onMessage("setPartyOpen", (client, message: SetPartyOpenMessage) => this.handleSetPartyOpen(client, message));
    this.onMessage("applyToParty", (client, message: ApplyToPartyMessage) => this.handleApplyToParty(client, message));
    this.onMessage("withdrawPartyApplication", (client, message: WithdrawPartyApplicationMessage) =>
      this.handleWithdrawPartyApplication(client, message),
    );
    this.onMessage("respondPartyApplication", (client, message: RespondPartyApplicationMessage) =>
      this.handleRespondPartyApplication(client, message),
    );
    this.onMessage("usePortal", (client, message: UsePortalMessage) => void this.handleUsePortal(client, message));
    this.onMessage("enterDungeon", (client, message: EnterDungeonMessage) => void this.handleEnterDungeon(client, message));

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
    this.spellTemplatesById = new Map(spellRows.map((s) => [s.id, s]));
  }

  // Talent templates are cached at room creation for the same reason spells
  // are — rebuilding the whole map handles create/update/delete uniformly.
  private async reloadTalents() {
    const talentRows = await prisma.talentTemplate.findMany({ include: { effects: true } });
    this.talentTemplatesById = new Map(talentRows.map((t) => [t.id, t]));
  }

  // Monster templates are also cached (on each spawned monster's runtime
  // entry). Mutating the existing template objects in place — rather than
  // replacing them — means every already-spawned monster referencing one
  // picks up the new stats immediately with no extra bookkeeping. Newly
  // added/removed spawn points on the active map still require a room
  // restart; this only refreshes stats on monsters that already exist.
  private async reloadMonsterTemplates() {
    const templates = await prisma.monsterTemplate.findMany({ include: { drops: true } });
    const byId = new Map(templates.map((t) => [t.id, t]));
    this.monsterTemplatesById = byId;

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
      monster.attackRange = runtime.template.attackRange;
    }
  }

  // Terrain (via chunkCache) and ambient-spawn config are both keyed off the
  // active GameMap row — an admin tile edit or ambient-spawn-rule change
  // rebuilds both from scratch here. Deliberately does NOT touch
  // rolledAmbientChunks/ambientMonsterCount: those must survive an unrelated
  // tile edit, otherwise re-painting one tile would re-roll ambient spawns
  // across the whole already-explored world and duplicate monsters.
  private async reloadMapContent() {
    this.chunkCache.clear();
    if (this.isDungeonInstance) return; // no ambient spawning to reload; terrain re-fetches lazily either way
    const [map, ambientRows] = await Promise.all([
      prisma.gameMap.findUnique({ where: { id: this.mapId } }),
      prisma.mapAmbientSpawn.findMany({ where: { mapId: this.mapId } }),
    ]);
    if (map) this.ambientSpawnChance = map.ambientSpawnChance;
    this.ambientSpawnRules = ambientRows;
  }

  // Keeps terrain resident in memory a little ahead of where players
  // actually are, so the "returns Grass synchronously while a chunk is
  // mid-fetch" fallback in ChunkTileCache is rarely visible in practice.
  // One warm() call per player (not one per chunk) — see ChunkTileCache.warm.
  private preloadChunksAroundPlayers() {
    const tileSize = this.chunkCache.tileSize;
    for (const player of this.state.players.values()) {
      const chunkCol = Math.floor(player.x / tileSize / CHUNK_SIZE);
      const chunkRow = Math.floor(player.y / tileSize / CHUNK_SIZE);
      const minCol = (chunkCol - CHUNK_PRELOAD_RADIUS) * CHUNK_SIZE;
      const minRow = (chunkRow - CHUNK_PRELOAD_RADIUS) * CHUNK_SIZE;
      const maxCol = (chunkCol + CHUNK_PRELOAD_RADIUS + 1) * CHUNK_SIZE - 1;
      const maxRow = (chunkRow + CHUNK_PRELOAD_RADIUS + 1) * CHUNK_SIZE - 1;
      void this.chunkCache.warm(minCol, minRow, maxCol, maxRow);
    }
  }

  // Rolls ambient (procedural) monster spawns as players cross into chunks
  // they haven't been in before, this room's lifetime — see the class-level
  // rolledAmbientChunks/playerLastChunk doc comments for why.
  private checkAmbientSpawns() {
    if (this.ambientSpawnRules.length === 0) return;
    const tileSize = this.chunkCache.tileSize;

    for (const [sessionId, player] of this.state.players) {
      const col = Math.floor(player.x / tileSize);
      const row = Math.floor(player.y / tileSize);
      const key = chunkKeyFor(col, row);
      if (this.playerLastChunk.get(sessionId) === key) continue;
      this.playerLastChunk.set(sessionId, key);

      if (this.rolledAmbientChunks.has(key)) continue;
      this.rolledAmbientChunks.add(key);
      this.rollAmbientSpawn(key);
    }
  }

  private rollAmbientSpawn(chunkKey: string) {
    if (this.ambientMonsterCount >= MAX_AMBIENT_MONSTERS) return;
    if (Math.random() >= this.ambientSpawnChance) return;

    const totalWeight = this.ambientSpawnRules.reduce((sum, rule) => sum + rule.weight, 0);
    if (totalWeight <= 0) return;
    let roll = Math.random() * totalWeight;
    let chosen = this.ambientSpawnRules[this.ambientSpawnRules.length - 1];
    for (const rule of this.ambientSpawnRules) {
      roll -= rule.weight;
      if (roll <= 0) {
        chosen = rule;
        break;
      }
    }

    const template = this.monsterTemplatesById.get(chosen.monsterTemplateId);
    if (!template) return;

    const { chunkCol, chunkRow } = chunkOriginFromKey(chunkKey);
    const tileSize = this.chunkCache.tileSize;
    let spawnCol: number | undefined;
    let spawnRow: number | undefined;
    for (let attempt = 0; attempt < 5; attempt++) {
      const col = chunkCol * CHUNK_SIZE + Math.floor(Math.random() * CHUNK_SIZE);
      const row = chunkRow * CHUNK_SIZE + Math.floor(Math.random() * CHUNK_SIZE);
      if (isWalkableCell(this.chunkCache, col, row)) {
        spawnCol = col;
        spawnRow = row;
        break;
      }
    }
    if (spawnCol === undefined || spawnRow === undefined) return; // no walkable sample found — skip this chunk

    const id = `ambient-${this.ambientMonsterSeq++}`;
    this.spawnMonster(id, { x: spawnCol * tileSize + tileSize / 2, y: spawnRow * tileSize + tileSize / 2 }, template);
    this.ambientMonsterCount++;
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

  // Quests deleted from content since being completed are silently dropped
  // here, same as the active list already does for quests it can't resolve.
  private buildCompletedQuestsView(sessionId: string): CompletedQuestsStateMessage {
    const completed = this.completedQuestIds.get(sessionId) ?? new Set<string>();
    const quests = [...completed]
      .map((questId) => this.questsById.get(questId))
      .filter((quest): quest is QuestFull => quest !== undefined)
      .map((quest) => ({ questId: quest.id, title: quest.title }));
    return { quests };
  }

  private sendCompletedQuestsState(client: Client) {
    client.send("completedQuestsState", this.buildCompletedQuestsView(client.sessionId));
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

  private spawnMonster(id: string, spawn: { x: number; y: number }, template: MonsterTemplateWithDrops, isBoss = false) {
    const monster = new Monster();
    monster.id = id;
    monster.name = template.name;
    monster.x = spawn.x;
    monster.y = spawn.y;
    monster.hp = template.maxHp;
    monster.maxHp = template.maxHp;
    monster.level = template.level;
    monster.attackRange = template.attackRange;
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
      lastSpellCastAt: 0,
      isBoss,
      template,
    });
  }

  // null means the cast is allowed to start. "heal" is always self-targeted
  // so there's no sightline to check; "groundAoe" checks the cast point,
  // everything else checks the targeted monster.
  private castRejectionReason(player: Player, spell: SpellDef, message: CastInputMessage): string | null {
    if (spell.kind === "heal") return null;

    if (spell.kind === "groundAoe") {
      if (message.x === undefined || message.y === undefined) return "Invalid cast target";
      return hasLineOfSight(this.chunkCache, player.x, player.y, message.x, message.y) ? null : "No line of sight";
    }

    const target = message.targetId ? this.state.monsters.get(message.targetId) : undefined;
    if (!target) return "Invalid cast target";
    return hasLineOfSight(this.chunkCache, player.x, player.y, target.x, target.y) ? null : "No line of sight";
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
    const cooldownMs = this.getSpellValue(sessionId, player.classId, message.spellId, "cooldownMs", spell.cooldownMs);
    if (now - last < cooldownMs) return;

    // Checked before the cast is accepted (GCD/cooldown untouched on
    // rejection) so a blocked shot is refused immediately instead of only
    // discovered after the full cast-time delay elapses — see
    // resolveCastEffect/resolveGroundAoe, which re-check at resolution time
    // in case the target moved/died meanwhile.
    const rejectionReason = this.castRejectionReason(player, spell, message);
    if (rejectionReason) {
      client.send("castFailed", { spellId: message.spellId, reason: rejectionReason } satisfies CastFailedMessage);
      return;
    }

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
      const healBase = this.getSpellValue(sessionId, player.classId, message.spellId, "healAmount", spell.healAmount ?? 0);
      const healAmount = this.rollForCaster(sessionId, player.className, healBase);
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

    if (spell.kind === "interrupt") {
      const interruptTarget = message.targetId ? this.state.monsters.get(message.targetId) : undefined;
      if (!interruptTarget || !hasLineOfSight(this.chunkCache, player.x, player.y, interruptTarget.x, interruptTarget.y)) {
        client.send("castFizzled", { spellId: message.spellId } satisfies CastFizzledMessage);
        return;
      }
      // Cooldown is spent whether or not the monster was actually casting —
      // a "whiffed" interrupt still costs its cooldown, same as every real
      // MMO interrupt ability. No dedicated success/failure message: the
      // monster's cast bar disappearing (or never having appeared) is the
      // feedback, matching how other LOS/range rejections this session
      // avoided adding a new toast where an existing visual already says it.
      this.lastCastAt.set(cooldownKey, this.clock.currentTime);
      if (message.targetId && this.monsterCastRuntime.has(message.targetId)) {
        this.interruptMonsterCast(message.targetId);
      }
      return;
    }

    const target = message.targetId ? this.state.monsters.get(message.targetId) : undefined;
    if (!target || !hasLineOfSight(this.chunkCache, player.x, player.y, target.x, target.y)) {
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
    projectile.casterSessionId = sessionId;
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
    const maxRange = this.getSpellValue(player.sessionId, player.classId, message.spellId, "maxRange", spell.maxRange ?? Infinity);
    if (dist > maxRange && dist > 0) {
      const scale = maxRange / dist;
      targetX = player.x + dx * scale;
      targetY = player.y + dy * scale;
    }

    if (!hasLineOfSight(this.chunkCache, player.x, player.y, targetX, targetY)) return false;

    const radius = this.getSpellValue(player.sessionId, player.classId, message.spellId, "aoeRadius", spell.aoeRadius ?? 0);

    // A groundAoe spell is configured as either a damage burst or a heal
    // burst, never both — only the effect this spell actually has an amount
    // for runs. Without this guard, a heal-only spell (damage left at its
    // default 0) would still "hit" every monster in radius for 0 and a
    // damage-only spell would still flash the heal VFX on every ally in
    // radius for 0, in addition to any spell genuinely configured with a
    // stray nonzero value in the field it doesn't use.
    const damageBase = this.getSpellValue(player.sessionId, player.classId, message.spellId, "damage", spell.damage ?? 0);
    if (damageBase > 0) {
      for (const [id, monster] of this.state.monsters) {
        if (Math.hypot(monster.x - targetX, monster.y - targetY) <= radius) {
          const amount = this.rollForCaster(player.sessionId, player.className, damageBase);
          this.damageMonster(id, monster, amount, player.sessionId);
        }
      }
    }

    const healBase = this.getSpellValue(player.sessionId, player.classId, message.spellId, "healAmount", spell.healAmount ?? 0);
    if (healBase > 0) {
      for (const [sessionId, ally] of this.state.players) {
        if (Math.hypot(ally.x - targetX, ally.y - targetY) <= radius) {
          const healAmount = this.rollForCaster(player.sessionId, player.className, healBase);
          ally.hp = Math.min(ally.maxHp, ally.hp + healAmount);
          this.broadcast("heal", { sessionId } satisfies HealEventMessage);
        }
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
    this.checkAmbientSpawns();
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

      const dx = input.dx * MOVE_SPEED * dt;
      const dy = input.dy * MOVE_SPEED * dt;
      const resolved = resolveMovement(this.chunkCache, player.x, player.y, dx, dy);

      // resolveMovement doesn't say *why* it clamped a move short — a real
      // Wall/Water tile needs no extra feedback (the player can see it), but
      // a barrier cell is invisible by design, so a bump against one gets an
      // explicit notice instead of just silently refusing to move.
      if (dx !== 0 || dy !== 0) {
        if (isBlockedByBarrier(this.chunkCache, player.x + dx, player.y + dy)) {
          const lastNotice = this.lastZoneBlockedNoticeAt.get(sessionId) ?? 0;
          if (now - lastNotice > ZONE_BLOCKED_NOTICE_INTERVAL_MS) {
            this.lastZoneBlockedNoticeAt.set(sessionId, now);
            this.clients.getById(sessionId)?.send("zoneBlocked", { message: ZONE_BLOCKED_MESSAGE } satisfies ZoneBlockedMessage);
          }
        }
      }

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
      // Standing still, channeling — resolution (resolveMonsterCast) or an
      // interrupt (interruptMonsterCast) is what ends this, not this loop.
      if (this.monsterCastRuntime.has(id)) continue;
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
        // A monster with a ranged spell configured (see MonsterTemplate.
        // spellDamage etc. — all five are set together or not at all)
        // prefers it over melee whenever it's off cooldown and the target
        // is in range/LOS, same gating the melee attack below already uses.
        // Starting a cast doesn't land damage immediately — see
        // resolveMonsterCast, scheduled for spellCastTimeMs from now, which
        // is exactly the window the new per-class interrupt spell can act in.
        const hasSpell =
          template.spellDamage != null &&
          template.spellRange != null &&
          template.spellCastTimeMs != null &&
          template.spellCooldownMs != null;
        const canCastSpell =
          hasSpell &&
          targetDist <= template.spellRange! &&
          now - runtime.lastSpellCastAt >= template.spellCooldownMs! &&
          hasLineOfSight(this.chunkCache, monster.x, monster.y, target.x, target.y);

        if (canCastSpell) {
          runtime.lastSpellCastAt = now;
          monster.casting = true;
          monster.castDurationMs = template.spellCastTimeMs!;
          const timeout = this.clock.setTimeout(() => this.resolveMonsterCast(id), template.spellCastTimeMs!);
          this.monsterCastRuntime.set(id, { timeout, targetSessionId: target.sessionId });
          continue;
        }

        // In-range alone isn't enough to land a hit — attackRange is a flat
        // XY distance, so without also requiring line-of-sight a monster
        // stuck at the base of a cliff or behind a wall could keep hitting
        // a player it can't actually reach, the same way a spell cast
        // through cover shouldn't land (see castRejectionReason). Blocked
        // means keep chasing instead of idling in place — approaching
        // (even along this simple straight-line AI, not real pathfinding)
        // is the only way it might ever get a clear shot.
        const inRange = targetDist <= template.attackRange;
        const canSeeTarget = inRange && hasLineOfSight(this.chunkCache, monster.x, monster.y, target.x, target.y);

        if (!canSeeTarget) {
          const dirX = (target.x - monster.x) / targetDist;
          const dirY = (target.y - monster.y) / targetDist;
          const speed = template.chaseSpeed * speedMultiplier;
          const resolved = resolveMovement(this.chunkCache, monster.x, monster.y, dirX * speed * dt, dirY * speed * dt);
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
          this.chunkCache,
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

  // Runs after a monster's ranged-spell channel finishes uninterrupted.
  // Re-reads monster/target state at resolution time (the same "things may
  // have moved since the cast started" re-check resolveCastEffect does for
  // players) — a target that died, disconnected, or wandered out of range/
  // LOS makes the cast fizzle silently rather than landing an unfair hit.
  private resolveMonsterCast(id: string) {
    const runtime = this.monsterRuntime.get(id);
    const castRuntime = this.monsterCastRuntime.get(id);
    const monster = this.state.monsters.get(id);
    this.monsterCastRuntime.delete(id);
    if (monster) {
      monster.casting = false;
      monster.castDurationMs = 0;
    }
    if (!runtime || !castRuntime || !monster) return;

    const target = this.state.players.get(castRuntime.targetSessionId);
    if (!target) return;
    const dist = Math.hypot(target.x - monster.x, target.y - monster.y);
    const template = runtime.template;
    if (dist > (template.spellRange ?? 0) || !hasLineOfSight(this.chunkCache, monster.x, monster.y, target.x, target.y)) return;

    this.damagePlayer(target, template.spellDamage ?? 0);
  }

  // The counterpart to a player's interrupt spell (see resolveCastEffect's
  // "interrupt" branch) — cancels an in-progress monster cast with no bonus
  // lockout beyond the spell's own cooldown (already spent the moment the
  // cast started, at lastSpellCastAt, same as a player's GCD being spent on
  // accept rather than on success).
  private interruptMonsterCast(id: string) {
    const castRuntime = this.monsterCastRuntime.get(id);
    if (!castRuntime) return;
    castRuntime.timeout.clear();
    this.monsterCastRuntime.delete(id);
    const monster = this.state.monsters.get(id);
    if (monster) {
      monster.casting = false;
      monster.castDurationMs = 0;
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
      // A dead monster can't still be mid-cast — without this, a stray
      // scheduled resolveMonsterCast(id) could fire later against a
      // respawned monster reusing the same id (only possible if
      // spellCastTimeMs ever exceeded MONSTER_RESPAWN_MS, but cheap to rule
      // out entirely rather than rely on that never happening).
      this.interruptMonsterCast(id);
      if (runtime) {
        if (casterSessionId) {
          void this.grantXp(casterSessionId, runtime.template.xpReward);
          void this.trackMonsterKill(casterSessionId, runtime.template.id);
          void this.grantDrops(casterSessionId, runtime.template);
          this.clients
            .getById(casterSessionId)
            ?.send("xpGained", { amount: runtime.template.xpReward } satisfies XpGainedMessage);
        }
        this.updateDungeonObjectives(runtime, monster);
        // No respawn for the lifetime of a dungeon instance — a fresh
        // instance (with fresh monsters) is created the next time a party
        // enters, rather than trash mobs ever coming back mid-run.
        if (!this.isDungeonInstance) {
          this.clock.setTimeout(
            () => this.spawnMonster(id, { x: runtime.homeX, y: runtime.homeY }, runtime.template, runtime.isBoss),
            MONSTER_RESPAWN_MS,
          );
        }
      }
    }
  }

  // Called once per monster kill, from damageMonster. A dungeon whose map
  // defines no DungeonObjective rows keeps the old, simpler rule (any boss
  // kill clears it); one that does define at least one only clears once
  // every objective on it is completed, checked fresh after every kill
  // since a single kill can advance more than one objective at once (e.g.
  // the boss itself also counting toward a killAllMonsters tally).
  private updateDungeonObjectives(runtime: MonsterRuntime, monster: Monster) {
    if (!this.isDungeonInstance || this.dungeonAlreadyCleared) return;

    if (this.state.dungeonObjectives.length === 0) {
      if (runtime.isBoss) this.clearDungeon(monster.x, monster.y);
      return;
    }

    for (const objective of this.state.dungeonObjectives) {
      if (objective.completed) continue;
      const meta = this.dungeonObjectiveMeta.get(objective.id);
      if (!meta) continue;

      if (meta.kind === "killBoss") {
        if (!runtime.isBoss) continue;
        objective.progress = 1;
        objective.completed = true;
      } else if (meta.kind === "killAllMonsters") {
        objective.progress = Math.min(objective.progress + 1, objective.requiredCount);
        if (objective.progress >= objective.requiredCount) objective.completed = true;
      } else if (meta.kind === "killCount") {
        if (meta.monsterTemplateId !== runtime.template.id) continue;
        objective.progress = Math.min(objective.progress + 1, objective.requiredCount);
        if (objective.progress >= objective.requiredCount) objective.completed = true;
      }
    }

    if (this.state.dungeonObjectives.every((o) => o.completed)) this.clearDungeon(monster.x, monster.y);
  }

  private clearDungeon(x: number, y: number) {
    if (this.dungeonAlreadyCleared) return;
    this.dungeonAlreadyCleared = true;
    this.broadcast("dungeonCleared", {} satisfies DungeonClearedMessage);
    this.spawnExitPortal(x, y);
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

  // Silently ignored for non-admins (no failure message — this is a debug
  // command, not a player-facing action). Reuses grantXp/grantExperience
  // rather than poking `level` directly, so the jump to the target level
  // still applies the normal per-level stat/HP growth instead of leaving
  // the character nominally "level 10" with level-1 stats.
  private async handleAdminSetLevel(client: Client, message: AdminSetLevelMessage) {
    if (!this.isAdmin.get(client.sessionId)) return;

    const sessionId = client.sessionId;
    const stats = this.characterStats.get(sessionId);
    if (!stats) return;

    const targetLevel = Math.max(1, Math.floor(message.level));
    if (stats.level >= targetLevel) return;

    let neededXp = 0;
    let level = stats.level;
    let experience = stats.experience;
    while (level < targetLevel) {
      neededXp += xpToNextLevel(level) - experience;
      experience = 0;
      level += 1;
    }

    await this.grantXp(sessionId, neededXp);
    this.sendTalentState(client);
  }

  // --- Party system ---
  // In-memory only (see the `parties`/`partyIdBySession` field comments) —
  // no DB persistence, a party dissolves when the room does or when
  // everyone leaves it.

  // Explicit counterpart to the implicit party creation that already
  // happens in handleRespondPartyInvite (an accepted invite forms a party
  // on the spot if the inviter didn't have one yet) — this just lets a
  // player commit to "I'm forming a group" and see themselves listed as its
  // sole member/leader before inviting anyone, rather than only ever seeing
  // a party once someone else has accepted.
  private handleCreateParty(client: Client) {
    const sessionId = client.sessionId;
    if (this.partyIdBySession.has(sessionId)) return;

    const partyId = `party-${this.partySeq++}`;
    this.parties.set(partyId, { leaderSessionId: sessionId, memberSessionIds: [sessionId], open: false, applicantSessionIds: [] });
    this.partyIdBySession.set(sessionId, partyId);
    this.broadcastPartyState(partyId);
  }

  private handleInviteParty(client: Client, message: InvitePartyMessage) {
    const sessionId = client.sessionId;
    const inviter = this.state.players.get(sessionId);
    const target = this.state.players.get(message.targetSessionId);
    if (!inviter || !target || sessionId === message.targetSessionId) return;

    const myPartyId = this.partyIdBySession.get(sessionId);
    const myParty = myPartyId ? this.parties.get(myPartyId) : undefined;
    if (myParty && myParty.memberSessionIds.length >= MAX_PARTY_SIZE) {
      client.send("partyActionFailed", { reason: "Your party is full." } satisfies PartyActionFailedMessage);
      return;
    }
    // Only the leader invites once a party already exists — otherwise any
    // member inviting past the cap would need the same capacity re-check
    // the leader already has to do, for no real benefit at this scope.
    if (myParty && myParty.leaderSessionId !== sessionId) {
      client.send("partyActionFailed", { reason: "Only the party leader can invite." } satisfies PartyActionFailedMessage);
      return;
    }
    if (this.partyIdBySession.has(message.targetSessionId)) {
      client.send("partyActionFailed", { reason: `${target.name} is already in a party.` } satisfies PartyActionFailedMessage);
      return;
    }

    this.clients.getById(message.targetSessionId)?.send("partyInviteReceived", {
      fromSessionId: sessionId,
      fromName: inviter.name,
    } satisfies PartyInviteReceivedMessage);
  }

  private handleRespondPartyInvite(client: Client, message: RespondPartyInviteMessage) {
    const sessionId = client.sessionId;
    if (!message.accept) return;
    if (this.partyIdBySession.has(sessionId)) return; // already in a party since the invite was sent

    const inviter = this.state.players.get(message.fromSessionId);
    const responder = this.state.players.get(sessionId);
    if (!inviter || !responder) return;

    let partyId = this.partyIdBySession.get(message.fromSessionId);
    if (!partyId) {
      // Inviter wasn't in a party yet either — this invite forms a brand
      // new one with them as leader.
      partyId = `party-${this.partySeq++}`;
      this.parties.set(partyId, {
        leaderSessionId: message.fromSessionId,
        memberSessionIds: [message.fromSessionId],
        open: false,
        applicantSessionIds: [],
      });
      this.partyIdBySession.set(message.fromSessionId, partyId);
    }
    const party = this.parties.get(partyId);
    if (!party) return;
    if (party.memberSessionIds.length >= MAX_PARTY_SIZE) {
      client.send("partyActionFailed", { reason: "That party is full." } satisfies PartyActionFailedMessage);
      return;
    }

    party.memberSessionIds.push(sessionId);
    this.partyIdBySession.set(sessionId, partyId);
    this.broadcastPartyState(partyId);
  }

  private handleLeaveParty(client: Client) {
    const partyId = this.partyIdBySession.get(client.sessionId);
    if (partyId) this.removeFromParty(client.sessionId, partyId);
  }

  // Also the disconnect-cleanup path (see onLeave) — a departing member
  // both leaves their party AND (if anyone's left) promotes a new leader
  // and notifies the rest, same as an explicit leaveParty.
  private removeFromParty(sessionId: string, partyId: string) {
    const party = this.parties.get(partyId);
    if (!party) return;
    party.memberSessionIds = party.memberSessionIds.filter((id) => id !== sessionId);
    this.partyIdBySession.delete(sessionId);
    this.clients
      .getById(sessionId)
      ?.send("partyState", { leaderSessionId: null, members: [], open: false } satisfies PartyStateMessage);

    if (party.memberSessionIds.length === 0) {
      this.parties.delete(partyId);
      this.broadcastOpenParties();
      return;
    }
    if (party.leaderSessionId === sessionId) {
      party.leaderSessionId = party.memberSessionIds[0];
      // Applications were only ever visible to the old leader — the new one
      // needs the current pending list pushed too, not just the roster.
      this.sendPartyApplications(partyId);
    }
    this.broadcastPartyState(partyId);
    this.broadcastOpenParties();
  }

  private broadcastPartyState(partyId: string) {
    const party = this.parties.get(partyId);
    if (!party) return;
    const members: PartyMemberView[] = party.memberSessionIds.map((sessionId) => {
      const player = this.state.players.get(sessionId);
      return { sessionId, name: player?.name ?? "?", level: player?.level ?? 1, className: player?.className ?? "?" };
    });
    const message: PartyStateMessage = { leaderSessionId: party.leaderSessionId, members, open: party.open };
    for (const memberSessionId of party.memberSessionIds) {
      this.clients.getById(memberSessionId)?.send("partyState", message);
    }
  }

  // --- Party applications (open/browse/apply, alongside direct invites) ---

  private handleSetPartyOpen(client: Client, message: SetPartyOpenMessage) {
    const sessionId = client.sessionId;
    const partyId = this.partyIdBySession.get(sessionId);
    if (!partyId) return;
    const party = this.parties.get(partyId);
    if (!party || party.leaderSessionId !== sessionId) return;

    party.open = message.open;
    this.broadcastPartyState(partyId);
    this.broadcastOpenParties();
  }

  private handleApplyToParty(client: Client, message: ApplyToPartyMessage) {
    const sessionId = client.sessionId;
    if (this.partyIdBySession.has(sessionId)) {
      client.send("partyActionFailed", { reason: "Leave your current group first." } satisfies PartyActionFailedMessage);
      return;
    }
    const party = this.parties.get(message.partyId);
    if (!party || !party.open || party.memberSessionIds.length >= MAX_PARTY_SIZE) {
      client.send("partyActionFailed", { reason: "That group isn't accepting applications." } satisfies PartyActionFailedMessage);
      return;
    }
    if (!party.applicantSessionIds.includes(sessionId)) {
      party.applicantSessionIds.push(sessionId);
      this.sendPartyApplications(message.partyId);
    }
  }

  private handleWithdrawPartyApplication(client: Client, message: WithdrawPartyApplicationMessage) {
    const party = this.parties.get(message.partyId);
    if (!party) return;
    const index = party.applicantSessionIds.indexOf(client.sessionId);
    if (index === -1) return;
    party.applicantSessionIds.splice(index, 1);
    this.sendPartyApplications(message.partyId);
  }

  private handleRespondPartyApplication(client: Client, message: RespondPartyApplicationMessage) {
    const sessionId = client.sessionId;
    const partyId = this.partyIdBySession.get(sessionId);
    if (!partyId) return;
    const party = this.parties.get(partyId);
    if (!party || party.leaderSessionId !== sessionId) return;

    const index = party.applicantSessionIds.indexOf(message.sessionId);
    if (index === -1) return;
    party.applicantSessionIds.splice(index, 1);

    if (message.accept) {
      if (party.memberSessionIds.length >= MAX_PARTY_SIZE) {
        client.send("partyActionFailed", { reason: "Your group is full." } satisfies PartyActionFailedMessage);
      } else {
        party.memberSessionIds.push(message.sessionId);
        this.partyIdBySession.set(message.sessionId, partyId);
        this.broadcastPartyState(partyId);
        this.broadcastOpenParties();
      }
    } else {
      this.clients
        .getById(message.sessionId)
        ?.send("partyApplicationDeclined", { partyId } satisfies PartyApplicationDeclinedMessage);
    }
    this.sendPartyApplications(partyId);
  }

  // Applications are private to the leader (unlike the roster, which every
  // member sees) — pushed wholesale rather than diffed, same "small and
  // infrequent enough to just resend" call as PartyStateMessage.
  private sendPartyApplications(partyId: string) {
    const party = this.parties.get(partyId);
    if (!party) return;
    const applicants: PartyApplicantView[] = party.applicantSessionIds
      .map((applicantSessionId): PartyApplicantView | undefined => {
        const player = this.state.players.get(applicantSessionId);
        return player ? { sessionId: applicantSessionId, name: player.name } : undefined;
      })
      .filter((applicant): applicant is PartyApplicantView => applicant !== undefined);
    this.clients
      .getById(party.leaderSessionId)
      ?.send("partyApplicationsState", { applicants } satisfies PartyApplicationsStateMessage);
  }

  // A party disconnecting/reconnecting mid-application isn't tracked across
  // sessions (parties are session-scoped, not persisted — see the party
  // system's own scope notes) — this just makes sure a departing applicant
  // doesn't linger in some other leader's pending list forever.
  private removeApplicantFromAllParties(sessionId: string) {
    for (const [partyId, party] of this.parties) {
      const index = party.applicantSessionIds.indexOf(sessionId);
      if (index === -1) continue;
      party.applicantSessionIds.splice(index, 1);
      this.sendPartyApplications(partyId);
    }
  }

  private computeOpenParties(): OpenPartyView[] {
    const parties: OpenPartyView[] = [];
    for (const [partyId, party] of this.parties) {
      if (!party.open || party.memberSessionIds.length >= MAX_PARTY_SIZE) continue;
      const leader = this.state.players.get(party.leaderSessionId);
      parties.push({ partyId, leaderName: leader?.name ?? "?", memberCount: party.memberSessionIds.length });
    }
    return parties;
  }

  private broadcastOpenParties() {
    this.broadcast("openPartiesState", { parties: this.computeOpenParties() } satisfies OpenPartiesStateMessage);
  }

  // --- Portals / dungeons ---

  // Resolves the portal, the sender's party (solo = a "party" of just
  // themselves — no party required to use a portal), and the target map's
  // level gate, then explicitly creates a fresh dungeon room instance
  // (rather than letting each member matchmake independently) so the whole
  // group lands in the same one. Every member's client gets the resulting
  // roomId, not just whoever clicked the portal.
  // Called once, right where the dungeon's boss died, so players don't have
  // to retrace their steps back to a hand-placed entry portal (and dungeons
  // don't strictly need one authored on their map at all — see
  // WorldRoomOptions.returnMapId). Reuses the exact same portalRuntime /
  // usePortal plumbing a map-authored portal goes through, so leaving via it
  // works identically to entering: handleUsePortal already treats "target
  // map isn't a dungeon" as "just rejoin the plain overworld room."
  private spawnExitPortal(x: number, y: number) {
    if (!this.returnMapId) return;

    const id = "exit-portal";
    const portal = new Portal();
    portal.id = id;
    portal.x = x;
    portal.y = y;
    this.state.portals.set(id, portal);
    this.portalRuntime.set(id, { targetMapId: this.returnMapId });
  }

  // Shared by handleUsePortal and handleEnterDungeon: looks up the portal
  // and its target map, rejecting (with a portalFailed reason sent to the
  // client) if the player is out of range or the portal is misconfigured.
  // Both callers need this — a dungeon portal is validated once when the
  // prompt is requested and again when entry is actually confirmed, since
  // the client can't be trusted to only ever send EnterDungeonMessage after
  // a genuine DungeonPromptMessage.
  private async resolvePortalTarget(client: Client, portalId: string) {
    const sessionId = client.sessionId;
    const player = this.state.players.get(sessionId);
    const portal = this.state.portals.get(portalId);
    const portalRuntime = this.portalRuntime.get(portalId);
    if (!player || !portal || !portalRuntime) return undefined;

    if (Math.hypot(player.x - portal.x, player.y - portal.y) > PORTAL_INTERACT_RANGE) {
      client.send("portalFailed", { reason: "You need to be closer to the portal." } satisfies PortalFailedMessage);
      return undefined;
    }

    const targetMap = await prisma.gameMap.findUnique({ where: { id: portalRuntime.targetMapId } });
    if (!targetMap) {
      client.send("portalFailed", { reason: "That portal leads nowhere." } satisfies PortalFailedMessage);
      return undefined;
    }

    return { player, targetMap };
  }

  private async handleUsePortal(client: Client, message: UsePortalMessage) {
    const resolved = await this.resolvePortalTarget(client, message.portalId);
    if (!resolved) return;
    const { targetMap } = resolved;

    // A portal leading to a non-dungeon map (the overworld, or a return
    // portal on a dungeon map pointing back to it) doesn't create a new
    // restricted instance at all, and there's nothing to confirm about
    // leaving — the client just rejoins the plain overworld room via
    // ordinary matchmaking (see joinRoomById vs connectToWorld), landing
    // back in the one shared instance everyone else uses. No roomId means
    // exactly that.
    if (!targetMap.isDungeon) {
      const sessionId = client.sessionId;
      const partyId = this.partyIdBySession.get(sessionId);
      const memberSessionIds = partyId ? (this.parties.get(partyId)?.memberSessionIds ?? [sessionId]) : [sessionId];
      const granted: PortalGrantedMessage = { mapId: targetMap.id };
      for (const memberSessionId of memberSessionIds) {
        this.clients.getById(memberSessionId)?.send("portalGranted", granted);
      }
      return;
    }

    // A dungeon target isn't entered immediately — the client shows a
    // confirmation screen (description, level requirement, party roster/
    // invite) first, only actually creating/joining the instance once the
    // player confirms via EnterDungeonMessage (handleEnterDungeon).
    client.send("dungeonPrompt", {
      portalId: message.portalId,
      mapId: targetMap.id,
      name: targetMap.name,
      description: targetMap.description,
      minLevel: targetMap.minLevel,
    } satisfies DungeonPromptMessage);
  }

  private async handleEnterDungeon(client: Client, message: EnterDungeonMessage) {
    const resolved = await this.resolvePortalTarget(client, message.portalId);
    if (!resolved) return;
    const { targetMap } = resolved;
    if (!targetMap.isDungeon) return; // only a dungeonPrompt ever offers this action

    const sessionId = client.sessionId;
    const partyId = this.partyIdBySession.get(sessionId);
    const memberSessionIds = partyId ? (this.parties.get(partyId)?.memberSessionIds ?? [sessionId]) : [sessionId];

    for (const memberSessionId of memberSessionIds) {
      const memberLevel = this.characterStats.get(memberSessionId)?.level ?? 0;
      if (memberLevel < targetMap.minLevel) {
        const memberName = this.state.players.get(memberSessionId)?.name ?? "A party member";
        client.send("portalFailed", {
          reason: `${memberName} must be at least level ${targetMap.minLevel} to enter.`,
        } satisfies PortalFailedMessage);
        return;
      }
    }

    const allowedCharacterIds = memberSessionIds
      .map((memberSessionId) => this.characterIds.get(memberSessionId))
      .filter((characterId): characterId is string => characterId !== undefined);

    let roomId: string;
    try {
      const room = await matchMaker.createRoom(DUNGEON_ROOM, {
        mapId: targetMap.id,
        allowedCharacterIds,
        returnMapId: this.mapId,
      } satisfies WorldRoomOptions);
      roomId = room.roomId;
    } catch (err) {
      console.error("Failed to create dungeon instance:", err);
      client.send("portalFailed", { reason: "Could not open that instance right now." } satisfies PortalFailedMessage);
      return;
    }

    const granted: PortalGrantedMessage = { roomId, mapId: targetMap.id };
    for (const memberSessionId of memberSessionIds) {
      this.clients.getById(memberSessionId)?.send("portalGranted", granted);
    }
  }

  // Rolls a monster's loot table independently per entry (so a single kill
  // can drop several things, or nothing) and grants whatever hits straight
  // into the killer's inventory.
  private async grantDrops(sessionId: string, template: MonsterTemplateWithDrops) {
    if (template.drops.length === 0) return;
    const characterId = this.characterIds.get(sessionId);
    if (!characterId) return;

    const rolled: { itemId: string; quantity: number }[] = [];
    for (const drop of template.drops) {
      if (Math.random() * 100 >= drop.dropChance) continue;
      const span = drop.maxQuantity - drop.minQuantity;
      const quantity = drop.minQuantity + (span > 0 ? Math.floor(Math.random() * (span + 1)) : 0);
      if (quantity > 0) rolled.push({ itemId: drop.itemId, quantity });
    }
    if (rolled.length === 0) return;

    await prisma.$transaction(
      rolled.map((r) =>
        prisma.characterItem.upsert({
          where: { characterId_itemId: { characterId, itemId: r.itemId } },
          update: { quantity: { increment: r.quantity } },
          create: { characterId, itemId: r.itemId, quantity: r.quantity },
        }),
      ),
    );

    const client = this.clients.getById(sessionId);
    if (!client) return;

    const message: LootDroppedMessage = {
      drops: rolled.map((r) => {
        const item = this.itemTemplatesById.get(r.itemId);
        return {
          itemId: r.itemId,
          name: item?.name ?? "Unknown item",
          color: item?.color ?? 0xffffff,
          rarity: (item?.rarity as ItemRarity) ?? "common",
          quantity: r.quantity,
        };
      }),
    };
    client.send("lootDropped", message);
    await this.sendInventoryState(client);
  }

  // Combat math (damage/heal scaling, armor mitigation) always reads through
  // here rather than characterStats directly, so equipped gear actually
  // matters in a fight — characterStats stays the "base" block that persists
  // to the Character row and grows on level-up, unaffected by what's equipped.
  private getEffectiveStats(sessionId: string): CombatStats | undefined {
    const base = this.characterStats.get(sessionId);
    if (!base) return undefined;
    const bonus = this.equipmentBonus.get(sessionId) ?? EMPTY_EQUIPMENT_BONUS;
    const talent = this.talentBonus.get(sessionId) ?? EMPTY_TALENT_BONUS;
    return {
      level: base.level,
      experience: base.experience,
      armor: applyPercent(base.armor + bonus.armor + talent.flat.armor, talent.percent.armor),
      strength: applyPercent(base.strength + bonus.strength + talent.flat.strength, talent.percent.strength),
      intelligence: applyPercent(
        base.intelligence + bonus.intelligence + talent.flat.intelligence,
        talent.percent.intelligence,
      ),
      dexterity: applyPercent(base.dexterity + bonus.dexterity + talent.flat.dexterity, talent.percent.dexterity),
      criticalChance: applyPercent(
        base.criticalChance + bonus.criticalChance + talent.flat.criticalChance,
        talent.percent.criticalChance,
      ),
    };
  }

  // The one place maxHp/armor/strength/intelligence/dexterity/criticalChance
  // are derived onto the synced Player fields — called on join, level-up,
  // equip/unequip, and learn-talent, so those four call sites can never
  // drift out of sync. maxHp changes are applied as a delta to current hp
  // (same treatment a level-up's HP gain always got), not a hard reset, so
  // mid-fight HP isn't clobbered by, say, unequipping a ring.
  private applyStatsToPlayer(sessionId: string) {
    const player = this.state.players.get(sessionId);
    const base = this.characterStats.get(sessionId);
    if (!player || !base) return;
    const bonus = this.equipmentBonus.get(sessionId) ?? EMPTY_EQUIPMENT_BONUS;
    const talent = this.talentBonus.get(sessionId) ?? EMPTY_TALENT_BONUS;

    const newMaxHp = applyPercent(
      PLAYER_MAX_HP + (base.level - 1) * HP_PER_LEVEL + bonus.hp + talent.flat.hp,
      talent.percent.hp,
    );
    const delta = newMaxHp - player.maxHp;
    player.maxHp = newMaxHp;
    player.hp = Math.max(0, Math.min(newMaxHp, player.hp + delta));

    player.armor = applyPercent(base.armor + bonus.armor + talent.flat.armor, talent.percent.armor);
    player.strength = applyPercent(base.strength + bonus.strength + talent.flat.strength, talent.percent.strength);
    player.intelligence = applyPercent(
      base.intelligence + bonus.intelligence + talent.flat.intelligence,
      talent.percent.intelligence,
    );
    player.dexterity = applyPercent(base.dexterity + bonus.dexterity + talent.flat.dexterity, talent.percent.dexterity);
    player.criticalChance = applyPercent(
      base.criticalChance + bonus.criticalChance + talent.flat.criticalChance,
      talent.percent.criticalChance,
    );

    player.talentPoints = talentPointsForLevel(base.level) - sumTalentRanks(this.learnedTalents.get(sessionId));
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

  // The talent equivalent of loadEquipmentBonus: loads which talents this
  // character has learned (and at what rank) into learnedTalents, then sums
  // every statBonus effect across them into flat/percent totals scaled by
  // valuePerRank * rank.
  private async loadTalentBonus(sessionId: string, characterId: string) {
    const rows = await prisma.characterTalent.findMany({ where: { characterId } });
    const learned = new Map<string, number>(rows.map((r) => [r.talentId, r.rank]));
    this.learnedTalents.set(sessionId, learned);

    const flat: EquipmentBonusTotals = { ...EMPTY_EQUIPMENT_BONUS };
    const percent: EquipmentBonusTotals = { ...EMPTY_EQUIPMENT_BONUS };
    for (const [talentId, rank] of learned) {
      const talent = this.talentTemplatesById.get(talentId);
      if (!talent) continue;
      for (const effect of talent.effects) {
        if (effect.effectType !== "statBonus" || !effect.statKey) continue;
        const amount = (effect.valuePerRank ?? 0) * rank;
        const target = effect.bonusMode === "percent" ? percent : flat;
        switch (effect.statKey) {
          case "armor":
            target.armor += amount;
            break;
          case "strength":
            target.strength += amount;
            break;
          case "intelligence":
            target.intelligence += amount;
            break;
          case "dexterity":
            target.dexterity += amount;
            break;
          case "criticalChance":
            target.criticalChance += amount;
            break;
          case "maxHp":
            target.hp += amount;
            break;
        }
      }
    }
    this.talentBonus.set(sessionId, { flat, percent });
  }

  // Applies any spellModifier talents this caster has learned for spellId's
  // "param" to base, flat first then percent. SpellDef objects are
  // cached/shared across every player of a class (see spellDefsByClass), so
  // a talent's effect can never be baked into the cached object — it has to
  // be recomputed from `base` fresh at every read site instead.
  private getSpellValue(
    sessionId: string,
    classId: string,
    spellId: SpellId,
    param: TalentSpellParam,
    base: number,
  ): number {
    const learned = this.learnedTalents.get(sessionId);
    if (!learned || learned.size === 0) return base;

    let flat = 0;
    let percent = 0;
    for (const [talentId, rank] of learned) {
      const talent = this.talentTemplatesById.get(talentId);
      if (!talent || talent.classId !== classId) continue;
      for (const effect of talent.effects) {
        if (effect.effectType !== "spellModifier" || effect.spellParam !== param || !effect.spellTemplateId) continue;
        const spellTemplate = this.spellTemplatesById.get(effect.spellTemplateId);
        if (!spellTemplate || spellTemplate.classId !== classId || (spellTemplate.keybind as SpellId) !== spellId) continue;
        const amount = (effect.valuePerRank ?? 0) * rank;
        if (effect.bonusMode === "percent") percent += amount;
        else flat += amount;
      }
    }
    return applyPercent(base + flat, percent);
  }

  // The check every bespoke mechanic-flag talent's gameplay code should gate
  // on — true if this session has learned any talent carrying a
  // mechanicFlag effect named `flagName` (see TALENT_MECHANIC_FLAGS in
  // shared/src/api-types.ts for the fixed set of names an admin can attach
  // to a talent). mechanicFlag effects have no numeric value/rank to read —
  // a talent either has the flag or doesn't, so this is a plain boolean,
  // unlike getSpellValue/loadTalentBonus which accumulate magnitudes.
  private hasMechanicFlag(sessionId: string, flagName: TalentMechanicFlag): boolean {
    const learned = this.learnedTalents.get(sessionId);
    if (!learned) return false;
    for (const talentId of learned.keys()) {
      const talent = this.talentTemplatesById.get(talentId);
      if (talent?.effects.some((e) => e.effectType === "mechanicFlag" && e.flagName === flagName)) return true;
    }
    return false;
  }

  private sendTalentState(client: Client) {
    const sessionId = client.sessionId;
    const player = this.state.players.get(sessionId);
    const learned = this.learnedTalents.get(sessionId);
    const message: TalentStateMessage = {
      points: player?.talentPoints ?? 0,
      learned: learned ? [...learned.entries()].map(([talentId, rank]) => ({ talentId, rank })) : [],
    };
    client.send("talentState", message);
  }

  private async handleLearnTalent(client: Client, message: LearnTalentMessage) {
    const sessionId = client.sessionId;
    const characterId = this.characterIds.get(sessionId);
    const player = this.state.players.get(sessionId);
    if (!characterId || !player) return;

    const talent = this.talentTemplatesById.get(message.talentId);
    if (!talent || talent.classId !== player.classId) {
      client.send("talentActionFailed", { reason: "Talent not found." } satisfies TalentActionFailedMessage);
      return;
    }

    const learned = this.learnedTalents.get(sessionId) ?? new Map<string, number>();
    if (!canLearnTalent(talent, learned, player.talentPoints)) {
      client.send("talentActionFailed", {
        reason: "That talent isn't available to learn right now.",
      } satisfies TalentActionFailedMessage);
      return;
    }

    await prisma.characterTalent.upsert({
      where: { characterId_talentId: { characterId, talentId: talent.id } },
      update: { rank: { increment: 1 } },
      create: { characterId, talentId: talent.id, rank: 1 },
    });

    await this.loadTalentBonus(sessionId, characterId);
    this.applyStatsToPlayer(sessionId);
    this.sendTalentState(client);
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
    this.sendCompletedQuestsState(client);

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
    spellId: SpellId,
    monster: Monster,
    monsterId: string,
    hitX: number,
    hitY: number,
    casterSessionId: string,
  ) {
    const caster = this.state.players.get(casterSessionId);
    const casterClassName = caster?.className ?? "";
    const casterClassId = caster?.classId ?? "";

    if (spell.kind === "aoe") {
      const radius = this.getSpellValue(casterSessionId, casterClassId, spellId, "aoeRadius", spell.aoeRadius ?? 0);
      const damageBase = this.getSpellValue(casterSessionId, casterClassId, spellId, "damage", spell.damage ?? 0);
      for (const [id, m] of this.state.monsters) {
        const dist = Math.hypot(m.x - hitX, m.y - hitY);
        if (dist <= radius) {
          const amount = this.rollForCaster(casterSessionId, casterClassName, damageBase);
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

    const damageBase = this.getSpellValue(casterSessionId, casterClassId, spellId, "damage", spell.damage ?? 0);
    const amount = this.rollForCaster(casterSessionId, casterClassName, damageBase);
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

      if (!isWalkableAt(this.chunkCache, projectile.x, projectile.y)) {
        hit = true;
      } else {
        for (const [monsterId, monster] of this.state.monsters) {
          const dist = Math.hypot(monster.x - projectile.x, monster.y - projectile.y);
          if (dist <= PROJECTILE_HIT_RADIUS + MONSTER_COLLISION_RADIUS) {
            this.resolveSpellHit(spell, runtime.spellId, monster, monsterId, projectile.x, projectile.y, runtime.casterSessionId);
            hit = true;
            break;
          }
        }
      }

      const maxRange = this.getSpellValue(runtime.casterSessionId, runtime.classId, runtime.spellId, "maxRange", spell.maxRange ?? 0);
      if (hit || traveled >= maxRange) {
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
    // Defense in depth alongside the seat reservation itself — only
    // characters the portal actually granted entry to may join a dungeon
    // instance (see handleUsePortal).
    if (this.allowedCharacterIds && !this.allowedCharacterIds.has(character.id)) {
      throw new Error("You don't have access to this dungeon instance.");
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
    this.isAdmin.set(client.sessionId, payload.role === "admin");
    await this.loadEquipmentBonus(client.sessionId, character.id);
    await this.loadTalentBonus(client.sessionId, character.id);

    const player = new Player();
    player.sessionId = client.sessionId;
    player.name = character.name;
    // A dungeon instance's coordinate space has nothing to do with the
    // character's persisted overworld position — spawn at the (dungeon)
    // map's own spawn point instead, same as a brand-new character would.
    player.x = this.isDungeonInstance ? this.spawnX : character.x;
    player.y = this.isDungeonInstance ? this.spawnY : character.y;
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
    this.sendTalentState(client);

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
    this.sendCompletedQuestsState(client);
    if (player.quests.some((e) => this.questsById.get(e.questId)?.objectiveType === "bringItems")) {
      await this.refreshBringItemsReadiness(client.sessionId);
    }
    // A newly-joined client has nothing to diff against — the browsable
    // open-parties list only reaches everyone else via future
    // broadcastOpenParties calls, so this one needs its own initial snapshot.
    client.send("openPartiesState", { parties: this.computeOpenParties() } satisfies OpenPartiesStateMessage);

    console.log(`${player.name} (${player.className}) joined ${this.roomId}`);
  }

  async onLeave(client: Client) {
    const player = this.state.players.get(client.sessionId);
    const characterId = this.characterIds.get(client.sessionId);
    const stats = this.characterStats.get(client.sessionId);
    this.state.players.delete(client.sessionId);
    this.characterIds.delete(client.sessionId);
    this.characterStats.delete(client.sessionId);
    this.isAdmin.delete(client.sessionId);
    this.learnedTalents.delete(client.sessionId);
    this.talentBonus.delete(client.sessionId);
    this.inputs.delete(client.sessionId);
    this.lastZoneBlockedNoticeAt.delete(client.sessionId);
    this.invulnerableUntil.delete(client.sessionId);
    this.interruptCast(client.sessionId);
    this.gcdUntil.delete(client.sessionId);
    this.completedQuestIds.delete(client.sessionId);
    this.playerLastChunk.delete(client.sessionId);
    for (let spellId = 1; spellId <= 6; spellId++) {
      this.lastCastAt.delete(`${client.sessionId}:${spellId}`);
    }
    const partyId = this.partyIdBySession.get(client.sessionId);
    if (partyId) this.removeFromParty(client.sessionId, partyId);
    this.removeApplicantFromAllParties(client.sessionId);

    if (player && characterId) {
      try {
        await prisma.character.update({
          where: { id: characterId },
          data: {
            // A dungeon instance's x/y is meaningless in the overworld's
            // coordinate space — writing it here would corrupt the
            // character's real position. Only the overworld room persists it.
            ...(!this.isDungeonInstance && { x: player.x, y: player.y }),
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
