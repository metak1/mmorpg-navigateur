import Phaser from "phaser";
import type { Room } from "colyseus.js";
import type {
  Player,
  Monster,
  Projectile,
  Npc,
  Portal,
  RoomState,
  SpellId,
  SpellDef,
  HealEventMessage,
  GroundAoeEventMessage,
  CastFizzledMessage,
  CastFailedMessage,
  ZoneBlockedMessage,
  NpcDialogueMessage,
  QuestActionFailedMessage,
  QuestCompletedMessage,
  InventoryStateMessage,
  EquipActionFailedMessage,
  LootDroppedMessage,
  XpGainedMessage,
  CompletedQuestsStateMessage,
  TalentTemplateDTO,
  TalentStateMessage,
  TalentActionFailedMessage,
  PortalFailedMessage,
  PortalGrantedMessage,
  DungeonClearedMessage,
  DungeonPromptMessage,
  PartyInviteReceivedMessage,
  PartyStateMessage,
  PartyActionFailedMessage,
  PartyApplicantView,
  PartyApplicationsStateMessage,
  PartyApplicationDeclinedMessage,
  OpenPartyView,
  OpenPartiesStateMessage,
} from "shared";
import {
  MOVE_SPEED,
  resolveMovement,
  ChunkTileCache,
  CHUNK_SIZE,
  isoProject,
  isoUnproject,
  isoUnprojectDirection,
  isoCircleFootprint,
  isoElevationOffset,
  isHiddenByTerrain,
  hasLineOfSight,
  TERRAIN_DEPTH,
  UI_DEPTH,
  TileType,
} from "shared";
import { connectToWorld, joinRoomById } from "../net/RoomClient.js";
import { fetchActiveMap, fetchMapById, fetchMapTiles, fetchSpells, fetchTalents, fetchMe } from "../net/api.js";
import { Hud } from "../ui/Hud.js";
import { npcDialogue } from "../ui/NpcDialogue.js";
import { sidebar, type OnlinePlayerView } from "../ui/Sidebar.js";
import { dungeonPrompt } from "../ui/DungeonPrompt.js";
import { groupFinder, type GroupFinderData, type GroupFinderHandlers } from "../ui/GroupFinder.js";
import { partyFrames, type PartyFrameMember } from "../ui/PartyFrames.js";
import { dungeonObjectives, type DungeonObjectiveView } from "../ui/DungeonObjectives.js";
import {
  preloadGameAssets,
  CLASS_TEXTURE_KEYS,
  MONSTER_TEXTURE_KEYS,
  NPC_TEXTURE_KEYS,
  DEFAULT_CLASS_TEXTURE_KEY,
  DEFAULT_MONSTER_TEXTURE_KEY,
  DEFAULT_NPC_TEXTURE_KEY,
  TERRAIN_FULL_TEXTURE_KEYS,
  TERRAIN_CUBE_SOURCE_WIDTH,
  TERRAIN_CUBE_SOURCE_HEIGHT,
  TERRAIN_CUBE_SOURCE_TOP_HEIGHT,
  PROP_TEXTURE_KEYS,
} from "../assets.js";

const REMOTE_SMOOTHING = 0.25; // lerp factor applied per frame toward server position
// The local player predicts its own movement (see updateInput) and never
// hard-snaps to the server's echoed position — that was deliberate, since
// re-syncing to targetX/Y every tick caused visible rubber-banding (it's
// always a little behind due to latency). But with ZERO correction ever
// applied, any discrepancy between client and server (differing per-tick dt
// granularity, a dropped input, etc.) has nothing pulling it back and can
// accumulate indefinitely — the server (monster AI, attack range/LOS, hit
// detection) always uses its own true position, so a drifted local render
// eventually shows the player somewhere monsters visibly aren't chasing/
// attacking, even though the hits are landing correctly server-side.
// Applied only while idle (see updateInput) — since nothing is fighting it
// there, it can afford to be much stronger than REMOTE_SMOOTHING without
// looking like a snap.
const LOCAL_RECONCILE_SMOOTHING = 0.15;
const HP_BAR_WIDTH = 30;
const HP_BAR_HEIGHT = 4;
const HP_BAR_OFFSET_Y = 20;
// Drawn above the HP bar rather than below it, so a monster's melee-range
// indicator and its HP bar don't get visually confused with the channel bar.
const CAST_BAR_HEIGHT = 4;
const CAST_BAR_OFFSET_Y = HP_BAR_OFFSET_Y + 8;
// Clear of both the HP bar and (for monsters) the cast bar above it.
const NAME_TEXT_OFFSET_Y = CAST_BAR_OFFSET_Y + 12;
// Opacity applied to an entity's sprite + HP bar while standing behind a
// cliff tall enough to hide them (see isHiddenByTerrain) — faded rather
// than fully invisible so the entity doesn't just vanish/pop.
const OCCLUDED_ALPHA = 0.25;
const MONSTER_SLOWED_COLOR = 0x5599ff;
const TARGET_RING_COLOR = 0xffff00;
const TARGET_RING_SIZE = 36;
const TARGET_PANEL_X = 8;
const TARGET_PANEL_Y = 40;
const TARGET_PANEL_WIDTH = 220;
const TARGET_PANEL_HP_WIDTH = 200;
const RARITY_TEXT_COLORS: Record<string, string> = {
  common: "#cccccc",
  rare: "#4d9fff",
  epic: "#c060f0",
  legendary: "#ff9d2e",
};
// How often the set of loaded terrain chunks is recomputed against the
// camera's current view — doesn't need to be every frame, chunk boundaries
// don't move nearly that fast relative to the player's speed.
const CHUNK_REFRESH_INTERVAL_MS = 250;
// Extra chunks kept loaded outside the camera's visible rect, so panning
// doesn't show a pop-in edge right at the viewport boundary.
const CHUNK_MARGIN = 1;

type Target = { kind: "monster"; id: string } | { kind: "self" };

interface HpBarHolder {
  rect: Phaser.GameObjects.Image;
  hpBarBg: Phaser.GameObjects.Rectangle;
  hpBarFill: Phaser.GameObjects.Rectangle;
  nameText: Phaser.GameObjects.Text;
}

// Every mover tracks position in two coordinate systems: worldX/Y (raw
// simulation-space pixels — predicted locally, or lerped toward targetX/Y
// for remote entities) and rect.x/y (the projected screen position, the
// only thing actually handed to Phaser). targetX/Y is the latest raw
// server-reported position — unchanged in role from before iso, but no
// longer read directly for rendering or for local prediction (see
// updateInput: reusing it there caused rubber-banding against continuous
// server echoes).
interface PlayerEntity extends HpBarHolder {
  isLocal: boolean;
  worldX: number;
  worldY: number;
  targetX: number;
  targetY: number;
  name: string;
  hp: number;
  maxHp: number;
}

interface MonsterEntity extends HpBarHolder {
  worldX: number;
  worldY: number;
  targetX: number;
  targetY: number;
  name: string;
  hp: number;
  maxHp: number;
  level: number;
  attackRange: number;
  // Lazily created on the monster's first cast — most monsters never cast,
  // so paying for two extra rectangles per monster up front is wasted.
  castBarBg?: Phaser.GameObjects.Rectangle;
  castBarFill?: Phaser.GameObjects.Rectangle;
  castStartedAt?: number;
  castDurationMs: number;
}

interface ProjectileEntity {
  shape: Phaser.GameObjects.Rectangle;
  worldX: number;
  worldY: number;
  targetX: number;
  targetY: number;
}

interface NpcEntity {
  rect: Phaser.GameObjects.Image;
  nameText: Phaser.GameObjects.Text;
}

interface PortalEntity {
  rect: Phaser.GameObjects.Ellipse;
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
  private npcs = new Map<string, NpcEntity>();
  private portals = new Map<string, PortalEntity>();
  private projectiles = new Map<string, ProjectileEntity>();
  private cursors?: Phaser.Types.Input.Keyboard.CursorKeys;
  private wasd?: Record<"W" | "A" | "S" | "D", Phaser.Input.Keyboard.Key>;
  private lastDirection: "up" | "down" | "left" | "right" = "down";
  private lastSent = { dx: 0, dy: 0 };
  private token = "";
  private characterId = "";
  // Present only when entering via a portal (see main.ts's "switch-room"
  // event) — join that specific dungeon instance instead of the plain
  // overworld, and bootstrap map metadata for `dungeonMapId` instead of
  // assuming "the active map."
  private roomId?: string;
  private dungeonMapId?: string;
  private chunkCache!: ChunkTileCache;
  // Every terrain GameObject a chunk owns (its tiles' cube sprites) — NOT
  // wrapped in a Container. A container has one depth for all its children,
  // but a tile's cube sprite extends well below its own diamond (the
  // baked-in side faces), overlapping whatever chunk is drawn "in front" of
  // it on screen — which, across a chunk boundary, has nothing to do with
  // which chunk's container happened to be created first. Each tile gets
  // its own depth instead (see createChunkLayer) so Phaser's normal
  // scene-wide depth sort orders every tile correctly regardless of chunk
  // membership.
  private chunkLayers = new Map<string, Phaser.GameObjects.GameObject[]>();
  // Decorative furniture sprites for each chunk — destroyed alongside the
  // chunk's terrain objects when it unloads.
  private chunkPropSprites = new Map<string, Phaser.GameObjects.Image[]>();
  // Chunks that were rendered before their real (possibly painted) data had
  // finished loading — re-checked each refresh tick and re-drawn once the
  // underlying ChunkTileCache actually has them, so a chunk painted by an
  // admin doesn't stay visually wrong just because it was the leading edge
  // of exploration when it was first drawn.
  private pendingChunkLoads = new Set<string>();
  private spellDefsByClass = new Map<string, Map<SpellId, SpellDef>>();
  private talentDefsByClass = new Map<string, TalentTemplateDTO[]>();
  private myClassId = "";
  // Learned-talent ranks aren't schema-synced (see TalentStateMessage), so
  // they're cached here from the last push and re-combined with the live
  // (schema-synced) player.talentPoints on every player.onChange — otherwise
  // the talents panel would only refresh its point count after the next
  // learnTalent round-trip instead of the moment a level-up grants one.
  private talentsLearnedCache: TalentStateMessage["learned"] = [];
  private spellDefs = new Map<SpellId, SpellDef>();
  // Mirrors of the party/group-finder state GroupFinder needs — kept here
  // (rather than only inside Sidebar) so the copy docked alongside the
  // dungeon-entry prompt (see DungeonPrompt), which may pop open at any
  // time independent of which sidebar tab is active, can render up to date
  // without its own room listeners.
  private onlinePlayers: OnlinePlayerView[] = [];
  private partyState: PartyStateMessage = { leaderSessionId: null, members: [], open: false };
  private partyApplicants: PartyApplicantView[] = [];
  private openParties: OpenPartyView[] = [];
  // Locally tracked optimistically — see GroupFinderData.myPendingApplications.
  private myPendingApplications = new Set<string>();
  private target: Target | null = null;
  private targetRing?: Phaser.GameObjects.Rectangle;
  // Shows the targeted monster's real attackRange footprint — under iso
  // projection, screen distance isn't proportional to real distance (most
  // pronounced approaching from directly "above"/"below" on screen), so
  // eyeballing raw pixel closeness to judge "am I in range" is unreliable.
  private attackRangeIndicator?: Phaser.GameObjects.Ellipse;
  private targetPanelParts: Phaser.GameObjects.GameObject[] = [];
  private targetNameText?: Phaser.GameObjects.Text;
  private targetHpFill?: Phaser.GameObjects.Rectangle;
  private hud?: Hud;
  private aimingSpell: SpellId | null = null;
  // Ellipses, not Arcs — a world-space circular radius projects to an
  // ellipse (width 2R, height R) under the non-uniform iso transform, not
  // a screen-space circle.
  private groundAoePreviewRing?: Phaser.GameObjects.Ellipse;
  private groundAoeRangeRing?: Phaser.GameObjects.Ellipse;
  private bannerText?: Phaser.GameObjects.Text;
  private dungeonClearedText?: Phaser.GameObjects.Text;

  constructor() {
    super("world");
  }

  init(data: { token: string; characterId: string; roomId?: string; mapId?: string }) {
    this.token = data.token;
    this.characterId = data.characterId;
    this.roomId = data.roomId;
    this.dungeonMapId = data.mapId;
  }

  preload() {
    preloadGameAssets(this);
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
    const [activeMap, spells, talents, account] = await Promise.all([
      this.dungeonMapId ? fetchMapById(this.dungeonMapId) : fetchActiveMap(),
      fetchSpells(),
      fetchTalents(),
      fetchMe(this.token),
    ]);
    sidebar.setAdmin(account?.role === "admin");
    // Clears out whatever the previous room's group last showed — switching
    // rooms tears down and rebuilds the Phaser game, but PartyFrames is a
    // DOM singleton that survives that (see main.ts's "switch-room"
    // listener), and this room's own partyState may not arrive at all if
    // the player ends up solo here.
    partyFrames.update([]);
    dungeonObjectives.update([]);

    this.chunkCache = new ChunkTileCache(activeMap.tileSize, (minCol, minRow, maxCol, maxRow) =>
      fetchMapTiles(activeMap.mapId, minCol, minRow, maxCol, maxRow),
    );
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
    for (const talent of talents) {
      const classTalents = this.talentDefsByClass.get(talent.classId) ?? [];
      classTalents.push(talent);
      this.talentDefsByClass.set(talent.classId, classTalents);
    }

    // No setBounds() — the world has no edges, so the camera follows
    // unbounded (Phaser supports this fine without a prior setBounds call).
    // Terrain itself streams in via refreshVisibleChunks below instead of
    // one static tilemap.
    this.time.addEvent({
      delay: CHUNK_REFRESH_INTERVAL_MS,
      loop: true,
      callback: () => this.refreshVisibleChunks(),
    });

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
        if (pointer.leftButtonDown()) {
          // pointer.worldX/Y reflects Phaser's actual (projected) render
          // space now — unproject before treating it as a raw world point.
          const raw = isoUnproject(pointer.worldX, pointer.worldY);
          this.confirmAiming(raw.x, raw.y);
        } else if (pointer.rightButtonDown()) this.cancelAiming();
        return;
      }
      if (!pointer.leftButtonDown()) return;
      if (this.input.hitTestPointer(pointer).length === 0) this.setTarget(null);
    });
    this.input.keyboard?.on("keydown-ESC", () => {
      this.cancelAiming();
      this.setTarget(null);
    });

    const { room, $ } = this.roomId
      ? await joinRoomById(this.roomId, this.token, this.characterId)
      : await connectToWorld(this.token, this.characterId);
    this.room = room;
    sidebar.setMySessionId(room.sessionId);

    room.onMessage("heal", (msg: HealEventMessage) => this.playHealEffect(msg.sessionId));
    room.onMessage("groundAoe", (msg: GroundAoeEventMessage) => this.playGroundAoeEffect(msg));
    room.onMessage("castFizzled", (msg: CastFizzledMessage) => this.hud?.cancelCast(msg.spellId));
    room.onMessage("castFailed", (msg: CastFailedMessage) => {
      this.hud?.rejectCast(msg.spellId);
      this.showBanner(msg.reason);
    });
    room.onMessage("zoneBlocked", (msg: ZoneBlockedMessage) => this.showBanner(msg.message));
    room.onMessage("npcDialogue", (msg: NpcDialogueMessage) => {
      npcDialogue.show(msg, {
        onAccept: (questId) => room.send("acceptQuest", { questId }),
        onTurnIn: (questId) => room.send("turnInQuest", { questId }),
      });
    });
    room.onMessage("questActionFailed", (msg: QuestActionFailedMessage) => alert(msg.reason));
    room.onMessage("questCompleted", (msg: QuestCompletedMessage) => {
      npcDialogue.hide();
      const items = msg.rewardItems.map((i) => `${i.quantity}x ${i.name}`).join(", ");
      alert(`Quest complete: ${msg.title}\n+${msg.rewardXp} XP${items ? `, ${items}` : ""}`);
    });
    room.onMessage("inventoryState", (msg: InventoryStateMessage) => sidebar.setInventory(msg));
    room.onMessage("lootDropped", (msg: LootDroppedMessage) => this.playLootEffect(msg));
    room.onMessage("xpGained", (msg: XpGainedMessage) => this.playXpGainedEffect(msg.amount));
    room.onMessage("completedQuestsState", (msg: CompletedQuestsStateMessage) => sidebar.setCompletedQuests(msg.quests));
    room.onMessage("equipActionFailed", (msg: EquipActionFailedMessage) => alert(msg.reason));
    sidebar.setInventoryHandlers({
      onEquip: (itemId, slot) => room.send("equipItem", { itemId, slot }),
      onUnequip: (slot) => room.send("unequipItem", { slot }),
    });
    room.onMessage("talentState", (msg: TalentStateMessage) => {
      this.talentsLearnedCache = msg.learned;
      sidebar.setTalents({ points: msg.points, learned: msg.learned, defs: this.talentDefsByClass.get(this.myClassId) ?? [] });
    });
    room.onMessage("talentActionFailed", (msg: TalentActionFailedMessage) => alert(msg.reason));
    sidebar.setTalentHandlers({
      onLearn: (talentId) => room.send("learnTalent", { talentId }),
    });
    sidebar.setAdminHandlers({
      onLevelTo10: () => room.send("adminSetLevel", { level: 10 }),
    });

    // Switching rooms is handled by main.ts (a full fresh Phaser.Game, not
    // an in-place reconnect — see its "switch-room" listener) since
    // buildWorld's connect/listener setup only runs safely once per scene.
    // Tearing down the Phaser.Game only destroys the client-side scene —
    // this room's websocket connection is a separate object main.ts never
    // touches, so without an explicit leave() here it stays open in the
    // background. The server only removes a player from its synced state
    // (WorldRoom.onLeave) when that connection actually closes, so leaving
    // this out left a duplicate, un-despawning entity behind in whichever
    // room was just left — both entering a dungeon (leaving the overworld)
    // and exiting one (leaving the dungeon instance) go through this same
    // handler, so this one leave() call covers both directions.
    room.onMessage("portalGranted", (msg: PortalGrantedMessage) => {
      dungeonPrompt.hide();
      groupFinder.hide();
      void room.leave();
      window.dispatchEvent(
        new CustomEvent("switch-room", {
          detail: { token: this.token, characterId: this.characterId, roomId: msg.roomId, mapId: msg.mapId },
        }),
      );
    });
    room.onMessage("portalFailed", (msg: PortalFailedMessage) => alert(msg.reason));
    room.onMessage("dungeonCleared", (_msg: DungeonClearedMessage) => this.showDungeonClearedBanner());

    // Shown instead of entering immediately whenever the clicked portal
    // leads to a dungeon — see WorldRoom.handleUsePortal. DungeonPrompt
    // hands back a dock element that GroupFinder renders into, so the same
    // create/invite/apply/leave group UI the sidebar's Party tab uses shows
    // up right alongside "enter this dungeon" instead of requiring a detour.
    room.onMessage("dungeonPrompt", (msg: DungeonPromptMessage) => {
      const groupDock = dungeonPrompt.show(msg, {
        onEnter: (portalId) => room.send("enterDungeon", { portalId }),
        onCancel: () => groupFinder.hide(),
      });
      groupFinder.show(groupDock, this.groupFinderData(room.sessionId), this.groupFinderHandlers(room));
    });

    room.onMessage("partyInviteReceived", (msg: PartyInviteReceivedMessage) => {
      const accept = confirm(`${msg.fromName} invited you to a party. Accept?`);
      room.send("respondPartyInvite", { fromSessionId: msg.fromSessionId, accept });
    });
    room.onMessage("partyState", (msg: PartyStateMessage) => {
      this.partyState = msg;
      // Can't have a pending application while actually in a group (the
      // server rejects applyToParty otherwise) — joining one, whether via
      // invite or an accepted application, means any leftover local
      // "applied" state is necessarily stale.
      if (msg.members.length > 0 && this.myPendingApplications.size > 0) this.myPendingApplications.clear();
      sidebar.setParty(msg);
      groupFinder.update({ party: msg, myPendingApplications: this.myPendingApplications });
      this.refreshPartyFrames();
    });
    room.onMessage("partyActionFailed", (msg: PartyActionFailedMessage) => alert(msg.reason));
    room.onMessage("partyApplicationsState", (msg: PartyApplicationsStateMessage) => {
      this.partyApplicants = msg.applicants;
      sidebar.setApplicants(msg.applicants);
      groupFinder.update({ applicants: msg.applicants });
    });
    room.onMessage("partyApplicationDeclined", (msg: PartyApplicationDeclinedMessage) => {
      this.myPendingApplications.delete(msg.partyId);
      sidebar.setMyPendingApplications(this.myPendingApplications);
      groupFinder.update({ myPendingApplications: this.myPendingApplications });
      alert("Your application was declined.");
    });
    room.onMessage("openPartiesState", (msg: OpenPartiesStateMessage) => {
      this.openParties = msg.parties;
      sidebar.setOpenParties(msg.parties);
      groupFinder.update({ openParties: msg.parties });
    });
    sidebar.setPartyHandlers(this.groupFinderHandlers(room));

    this.input.keyboard?.on("keydown", (event: KeyboardEvent) => {
      const spellId = SPELL_KEY_CODES[event.code];
      if (spellId) this.handleSpellActivated(spellId);
    });

    $(room.state).players.onAdd((player: Player, sessionId: string) => {
      const isLocal = sessionId === room.sessionId;
      const p = this.projectEntity(player.x, player.y);
      const textureKey = CLASS_TEXTURE_KEYS[player.className] ?? DEFAULT_CLASS_TEXTURE_KEY;
      const rect = this.add.image(p.x, p.y, textureKey).setDisplaySize(32, 32).setDepth(p.depth);
      // Same sprite either way (classes aren't visually distinguished by
      // "whose character is whose") — a faint tint on everyone else is the
      // only thing that used to tell "me" apart from other players when both
      // were flat-colored rectangles, and still does the job here.
      if (!isLocal) rect.setTint(0xffaa66);
      const { hpBarBg, hpBarFill, nameText } = this.createHpBar(p.x, p.y, player.name);
      const entity: PlayerEntity = {
        rect,
        hpBarBg,
        hpBarFill,
        nameText,
        isLocal,
        worldX: player.x,
        worldY: player.y,
        targetX: player.x,
        targetY: player.y,
        name: player.name,
        hp: player.hp,
        maxHp: player.maxHp,
      };
      this.entities.set(sessionId, entity);
      this.positionHpBar(entity);
      this.refreshOnlinePlayers();

      if (isLocal) {
        // lerpX/Y eases the camera toward the player instead of snapping to
        // their exact position every frame — the player's own rect already
        // moves in discrete per-tick steps (local prediction), so without
        // this the camera inherited that same steppy motion.
        this.cameras.main.startFollow(rect, true, 0.1, 0.1);
        rect.setInteractive({ useHandCursor: true });
        rect.on("pointerdown", (pointer: Phaser.Input.Pointer) => {
          if (this.aimingSpell) return; // let the scene-level handler treat this as a placement click
          if (pointer.leftButtonDown()) this.setTarget({ kind: "self" });
        });
        this.myClassId = player.classId;
        this.setupSpellbarForClass(player.classId);
        this.hud?.setHealth(player.hp, player.maxHp);
        this.hud?.setLevel(player.level, player.experience, player.xpToNextLevel);
        this.syncCharacterStats(player);

        const syncQuestLog = () => {
          sidebar.setQuests(
            [...player.quests].map((q) => ({
              questId: q.questId,
              title: q.title,
              objectiveSummary: q.objectiveSummary,
              ready: q.ready,
            })),
          );
        };
        $(player).quests.onAdd((entry) => {
          $(entry).onChange(syncQuestLog);
          syncQuestLog();
        });
        $(player).quests.onRemove(syncQuestLog);
        syncQuestLog();

        window.dispatchEvent(new CustomEvent("world-ready"));
      }

      $(player).onChange(() => {
        entity.targetX = player.x;
        entity.targetY = player.y;
        // The sprite has no left/right-facing variants, just one forward
        // pose — flipping it horizontally is the cheap way to still show
        // facing for the two directions where it's visually obvious.
        // up/down leave whatever flip was already showing rather than
        // resetting it, since there's no "back" pose to flip to either.
        if (player.direction === "left") rect.setFlipX(true);
        else if (player.direction === "right") rect.setFlipX(false);
        entity.hp = player.hp;
        // maxHp changes mid-session on level-up — keep the cached copy in
        // sync so the HP bar's fraction doesn't render against a stale value.
        entity.maxHp = player.maxHp;
        hpBarFill.width = HP_BAR_WIDTH * Math.max(0, player.hp / entity.maxHp);
        // Cheap — the party frames panel only ever has up to MAX_PARTY_SIZE
        // rows — and only actually rebuilds anything when the player who
        // just changed is one of them, so this is a no-op for everyone else
        // moving/fighting nearby.
        if (this.partyState.members.some((m) => m.sessionId === sessionId)) this.refreshPartyFrames();
        if (isLocal) {
          this.hud?.setHealth(player.hp, player.maxHp);
          this.hud?.setLevel(player.level, player.experience, player.xpToNextLevel);
          this.syncCharacterStats(player);
          sidebar.setTalents({
            points: player.talentPoints,
            learned: this.talentsLearnedCache,
            defs: this.talentDefsByClass.get(this.myClassId) ?? [],
          });
        }
      });
    });

    $(room.state).players.onRemove((_player: Player, sessionId: string) => {
      const entity = this.entities.get(sessionId);
      entity?.rect.destroy();
      entity?.hpBarBg.destroy();
      entity?.hpBarFill.destroy();
      entity?.nameText.destroy();
      this.entities.delete(sessionId);
      this.refreshOnlinePlayers();
    });

    $(room.state).monsters.onAdd((monster: Monster, id: string) => {
      const p = this.projectEntity(monster.x, monster.y);
      const textureKey = MONSTER_TEXTURE_KEYS[monster.name] ?? DEFAULT_MONSTER_TEXTURE_KEY;
      const rect = this.add.image(p.x, p.y, textureKey).setDisplaySize(32, 32).setDepth(p.depth);
      rect.setInteractive({ useHandCursor: true });
      rect.on("pointerdown", (pointer: Phaser.Input.Pointer) => {
        if (this.aimingSpell) return; // let the scene-level handler treat this as a placement click
        if (pointer.leftButtonDown()) this.setTarget({ kind: "monster", id });
      });
      const { hpBarBg, hpBarFill, nameText } = this.createHpBar(p.x, p.y, monster.name);
      const entity: MonsterEntity = {
        rect,
        hpBarBg,
        hpBarFill,
        nameText,
        worldX: monster.x,
        worldY: monster.y,
        targetX: monster.x,
        targetY: monster.y,
        name: monster.name,
        hp: monster.hp,
        maxHp: monster.maxHp,
        level: monster.level,
        attackRange: monster.attackRange,
        castDurationMs: monster.castDurationMs,
      };
      this.monsters.set(id, entity);
      this.positionHpBar(entity);

      let lastHp = monster.hp;
      let wasCasting = monster.casting;
      $(monster).onChange(() => {
        // Monsters have no synced facing (unlike Player, nothing server-side
        // ever needed their direction before now) — derived from which way
        // this update actually moved them instead, comparing against the
        // still-old entity.targetX before it's overwritten below.
        if (monster.x > entity.targetX) rect.setFlipX(false);
        else if (monster.x < entity.targetX) rect.setFlipX(true);
        entity.targetX = monster.x;
        entity.targetY = monster.y;
        entity.hp = monster.hp;
        entity.attackRange = monster.attackRange;
        hpBarFill.width = HP_BAR_WIDTH * Math.max(0, monster.hp / entity.maxHp);
        if (monster.slowed) rect.setTint(MONSTER_SLOWED_COLOR);
        else rect.clearTint();

        if (monster.hp < lastHp) {
          this.tweens.add({ targets: rect, alpha: 0.15, duration: 60, yoyo: true, repeat: 1 });
        }
        lastHp = monster.hp;

        // A flip to true is the only "cast started" signal synced from the
        // server (see Monster schema) — the client times the fill itself
        // from this moment, mirroring Hud's own cast bar.
        if (monster.casting && !wasCasting) {
          entity.castDurationMs = monster.castDurationMs;
          entity.castStartedAt = this.time.now;
          if (!entity.castBarBg || !entity.castBarFill) {
            const { castBarBg, castBarFill } = this.createCastBar(rect.x, rect.y);
            entity.castBarBg = castBarBg;
            entity.castBarFill = castBarFill;
          }
          entity.castBarFill.width = 0;
          entity.castBarBg.setVisible(true);
          entity.castBarFill.setVisible(true);
        } else if (!monster.casting && wasCasting) {
          entity.castStartedAt = undefined;
          entity.castBarBg?.setVisible(false);
          entity.castBarFill?.setVisible(false);
        }
        wasCasting = monster.casting;
      });
    });

    $(room.state).monsters.onRemove((_monster: Monster, id: string) => {
      const entity = this.monsters.get(id);
      entity?.rect.destroy();
      entity?.hpBarBg.destroy();
      entity?.hpBarFill.destroy();
      entity?.nameText.destroy();
      entity?.castBarBg?.destroy();
      entity?.castBarFill?.destroy();
      this.monsters.delete(id);
      if (this.target?.kind === "monster" && this.target.id === id) this.setTarget(null);
    });

    $(room.state).npcs.onAdd((npc: Npc, id: string) => {
      const p = this.projectEntity(npc.x, npc.y);
      const mappedKey = NPC_TEXTURE_KEYS[npc.name];
      const rect = this.add.image(p.x, p.y, mappedKey ?? DEFAULT_NPC_TEXTURE_KEY).setDisplaySize(32, 32).setDepth(p.depth);
      // npc.color is an admin-authored per-template color, previously the
      // NPC's entire fill — now only used as a tint for names that don't
      // have a dedicated sprite above, so an admin-added NPC is still at
      // least distinguishable by color instead of all looking identical.
      if (!mappedKey) rect.setTint(npc.color);
      rect.setInteractive({ useHandCursor: true });
      rect.on("pointerdown", (pointer: Phaser.Input.Pointer) => {
        if (this.aimingSpell) return; // let the scene-level handler treat this as a placement click
        if (pointer.leftButtonDown()) this.room?.send("talk", { npcId: id });
      });
      // -22 is a screen-space "above the head" offset, so it's applied to
      // the rendered (elevation-shifted) position, not raw world coordinates.
      const nameText = this.add
        .text(p.x, p.y - 22, npc.name, {
          fontSize: "11px",
          color: "#ffffff",
          backgroundColor: "#000000aa",
          padding: { x: 3, y: 1 },
        })
        .setOrigin(0.5)
        .setDepth(p.depth + 1);
      this.npcs.set(id, { rect, nameText });
    });

    $(room.state).npcs.onRemove((_npc: Npc, id: string) => {
      const entity = this.npcs.get(id);
      entity?.rect.destroy();
      entity?.nameText.destroy();
      this.npcs.delete(id);
    });

    $(room.state).portals.onAdd((portal: Portal, id: string) => {
      const p = this.projectEntity(portal.x, portal.y);
      const rect = this.add.ellipse(p.x, p.y, 28, 18, 0x9d4dff, 0.7).setStrokeStyle(2, 0xd9b8ff).setDepth(p.depth);
      rect.setInteractive({ useHandCursor: true });
      rect.on("pointerdown", (pointer: Phaser.Input.Pointer) => {
        if (this.aimingSpell) return; // let the scene-level handler treat this as a placement click
        if (pointer.leftButtonDown()) this.room?.send("usePortal", { portalId: id });
      });
      this.portals.set(id, { rect });
    });

    $(room.state).portals.onRemove((_portal: Portal, id: string) => {
      this.portals.get(id)?.rect.destroy();
      this.portals.delete(id);
    });

    // Fixed at room creation (see WorldRoom.onCreate) — entries are never
    // added/removed mid-session, only their progress/completed fields
    // change, so onAdd just needs to wire each entry's own onChange once.
    const syncDungeonObjectives = () => {
      const objectives: DungeonObjectiveView[] = [...room.state.dungeonObjectives].map((o) => ({
        id: o.id,
        description: o.description,
        progress: o.progress,
        requiredCount: o.requiredCount,
        completed: o.completed,
      }));
      dungeonObjectives.update(objectives);
    };
    $(room.state).dungeonObjectives.onAdd((objective) => {
      $(objective).onChange(syncDungeonObjectives);
      syncDungeonObjectives();
    });

    $(room.state).projectiles.onAdd((projectile: Projectile, id: string) => {
      const spell = this.spellDefsByClass.get(projectile.classId)?.get(projectile.spellId as SpellId);
      const size = spell?.size ?? 6;
      const color = spell?.color ?? 0xffffff;

      // projectile.x/y is the caster's server-authoritative position at cast
      // time — it can already be a bit behind wherever the caster's own
      // sprite has since rendered to (local prediction keeps moving after
      // the cast is sent; a remote caster's sprite is smoothed toward its
      // own target separately). Spawning from the caster entity's current
      // worldX/Y instead makes the projectile visibly leave their body
      // rather than appearing offset from it; it still lerps toward the
      // server's real projectile position from there via targetX/Y below.
      const caster = this.entities.get(projectile.casterSessionId);
      const spawnWorldX = caster?.worldX ?? projectile.x;
      const spawnWorldY = caster?.worldY ?? projectile.y;

      const p = this.projectEntity(spawnWorldX, spawnWorldY);
      const shape = this.add.rectangle(p.x, p.y, size, size, color).setDepth(p.depth);
      const entity: ProjectileEntity = {
        shape,
        worldX: spawnWorldX,
        worldY: spawnWorldY,
        targetX: projectile.x,
        targetY: projectile.y,
      };
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

  // Streams terrain in as small per-chunk tilemaps instead of one static
  // map — creates whatever chunks are newly visible (camera rect + a
  // margin), destroys ones that scrolled out, and re-draws any chunk that
  // was first rendered before its real data had finished loading (see
  // pendingChunkLoads).
  private refreshVisibleChunks() {
    const tileSize = this.chunkCache.tileSize;
    const chunkPx = CHUNK_SIZE * tileSize;
    const view = this.cameras.main.worldView;

    // view is in projected (screen) space; a screen-aligned rect unprojects
    // to a rotated quadrilateral in world space, not another axis-aligned
    // rect, so take the bounding box across all 4 unprojected corners
    // rather than unprojecting the rect's two extremes directly.
    const corners = [
      isoUnproject(view.x, view.y),
      isoUnproject(view.x + view.width, view.y),
      isoUnproject(view.x, view.y + view.height),
      isoUnproject(view.x + view.width, view.y + view.height),
    ];
    const minWorldX = Math.min(...corners.map((c) => c.x));
    const maxWorldX = Math.max(...corners.map((c) => c.x));
    const minWorldY = Math.min(...corners.map((c) => c.y));
    const maxWorldY = Math.max(...corners.map((c) => c.y));

    const minChunkCol = Math.floor(minWorldX / chunkPx) - CHUNK_MARGIN;
    const minChunkRow = Math.floor(minWorldY / chunkPx) - CHUNK_MARGIN;
    const maxChunkCol = Math.floor(maxWorldX / chunkPx) + CHUNK_MARGIN;
    const maxChunkRow = Math.floor(maxWorldY / chunkPx) + CHUNK_MARGIN;

    const visibleKeys = new Set<string>();
    for (let chunkCol = minChunkCol; chunkCol <= maxChunkCol; chunkCol++) {
      for (let chunkRow = minChunkRow; chunkRow <= maxChunkRow; chunkRow++) {
        const key = `${chunkCol},${chunkRow}`;
        visibleKeys.add(key);
        if (!this.chunkLayers.has(key)) this.createChunkLayer(key, chunkCol, chunkRow);
      }
    }

    for (const key of this.chunkLayers.keys()) {
      if (visibleKeys.has(key)) continue;
      this.destroyChunkLayer(key);
      this.pendingChunkLoads.delete(key);
    }

    for (const key of [...this.pendingChunkLoads]) {
      const [chunkCol, chunkRow] = key.split(",").map(Number);
      if (!this.chunkCache.isChunkLoaded(chunkCol * CHUNK_SIZE, chunkRow * CHUNK_SIZE)) continue;
      this.destroyChunkLayer(key);
      this.pendingChunkLoads.delete(key);
      this.createChunkLayer(key, chunkCol, chunkRow);
    }
  }

  // Tears down everything createChunkLayer built for one chunk — the
  // terrain objects plus the prop sprites.
  private destroyChunkLayer(key: string) {
    for (const obj of this.chunkLayers.get(key) ?? []) obj.destroy();
    this.chunkLayers.delete(key);
    for (const sprite of this.chunkPropSprites.get(key) ?? []) sprite.destroy();
    this.chunkPropSprites.delete(key);
  }

  // Draws a chunk as CHUNK_SIZE×CHUNK_SIZE real voxel blocks (one per tile)
  // instead of a Phaser Tilemap — projecting each tile's 4 raw world-space
  // corners is what actually produces the diamond shape a block's top face
  // sits in.
  //
  // Each tile is exactly one full Kenney "Isometric Blocks" cube sprite (top
  // face plus its two baked-in south/east side faces — see assets.ts) —
  // no hand-drawn vector fill for the tile itself. A cliff is filled below
  // that with one whole extra block per elevation level, from level 0 up to
  // this tile's own real one (level 0 gets a block, level 1 gets a block,
  // ...) — the exact same full cube sprite each time, just stacked one
  // levelDisplayHeight lower per level down, with the real block always
  // added last so it draws on top and hides the seam of the one below it
  // (see the filler loop below). A north/west drop shows nothing (this
  // camera angle can't see that face on a real cube either — physically
  // correct, if a little less obvious as terrain, and the one existing
  // texture has no north/west face baked in to reuse for it either) — the
  // accepted tradeoff for a map built entirely out of real cube sprites.
  private createChunkLayer(key: string, chunkCol: number, chunkRow: number) {
    const tileSize = this.chunkCache.tileSize;
    // Every object this chunk creates, so destroyChunkLayer can tear them
    // all down — NOT a Container (see the chunkLayers field comment for
    // why: a cube's baked-in side faces extend past its own tile into
    // whatever's drawn "in front" of it, which needs a real per-tile depth
    // to resolve correctly across chunk boundaries, not one shared value).
    const terrainObjects: Phaser.GameObjects.GameObject[] = [];
    // TERRAIN_DEPTH is a fixed floor far below any world-tier entity depth
    // (which is unbounded — this world has no edges) or col+row could ever
    // reach, so terrain always renders behind every entity regardless of
    // how far a player has traveled from spawn.

    // +1px overscale on every sprite's display size, same seam-hiding
    // trick the old flat-fill version used (SEAM_PAD) — adjacent tiles
    // overlap by a hair instead of leaving a hairline gap at shared edges.
    const diamondW = tileSize * 2 + 1;
    const scale = diamondW / TERRAIN_CUBE_SOURCE_WIDTH;
    const fullDisplayH = TERRAIN_CUBE_SOURCE_HEIGHT * scale;
    // Fraction down the "full" cube image where the top face's own vertical
    // center sits — origin is set to this so positioning at a tile's
    // (centerX, centerY) lines the top face up exactly where the old flat
    // diamond used to be, with the baked-in sides simply hanging below it.
    const topOriginYFraction = TERRAIN_CUBE_SOURCE_TOP_HEIGHT / 2 / TERRAIN_CUBE_SOURCE_HEIGHT;
    // One elevation level's worth of screen-space height — the south/east
    // filler below stacks in units of exactly this, one whole block per
    // level, so a cliff from level 0 to level N always lands exactly on
    // level 0 with nothing left over.
    const levelDisplayHeight = isoElevationOffset(1, tileSize);

    // Flat tiles never overlap on screen, so draw order didn't matter
    // before elevation existed. An elevated tile's diamond IS shifted up
    // into neighboring tiles' screen space, so cells must be painted in
    // painter's-algorithm order (farthest from camera first) or a raised
    // tile can get incorrectly painted over by whatever's "behind" it in
    // raw iteration order. Depth for a 2:1 projection is proportional to
    // col+row, so sort ascending by that instead of raw row-major order.
    const cells: Array<{ r: number; c: number }> = [];
    for (let r = 0; r < CHUNK_SIZE; r++) {
      for (let c = 0; c < CHUNK_SIZE; c++) cells.push({ r, c });
    }
    cells.sort((a, b) => a.r + a.c - (b.r + b.c));

    const propSprites: Phaser.GameObjects.Image[] = [];

    for (const { r, c } of cells) {
      const col = chunkCol * CHUNK_SIZE + c;
      const row = chunkRow * CHUNK_SIZE + r;
      const elevation = this.chunkCache.elevationAt(col, row);
      const tileType = this.chunkCache.tileAt(col, row);
      const elevationShift = isoElevationOffset(elevation, tileSize);

      const worldLeft = col * tileSize;
      const worldTop = row * tileSize;
      const corners = [
        isoProject(worldLeft, worldTop),
        isoProject(worldLeft + tileSize, worldTop),
        isoProject(worldLeft + tileSize, worldTop + tileSize),
        isoProject(worldLeft, worldTop + tileSize),
      ].map((p) => ({ x: p.x, y: p.y - elevationShift }));

      const centerX = (corners[0].x + corners[2].x) / 2;
      const centerY = (corners[0].y + corners[2].y) / 2;

      // A real per-tile depth (not a shared container/chunk-level value) —
      // see the chunkLayers field comment for why this specific value
      // matters now that a cube's sides can visually reach into a
      // neighboring tile's space, possibly in another chunk: Phaser sorts
      // every top-level GameObject in the scene by depth each frame, so
      // this alone is what makes two adjacent tiles — regardless of which
      // chunk either belongs to — composite in the correct order.
      const tileDepth = TERRAIN_DEPTH + col + row;

      const fullKey = TERRAIN_FULL_TEXTURE_KEYS[tileType] ?? TERRAIN_FULL_TEXTURE_KEYS[TileType.Grass];

      // A raised tile's own cube bottom sits elevationShift px above where
      // this tile would be at elevation 0 — one whole block per level fills
      // that gap: level 0 gets a block, level 1 gets a block, ... up to
      // this tile's own real block at its actual elevation (level 0/2 pngs)
      // — the same full, undistorted cube sprite every time, just
      // positioned one levelDisplayHeight lower per level down, not a
      // cropped/squeezed sliver. This stays a plain per-tile calculation,
      // continuing straight down this tile's own screen column regardless
      // of what's actually there (see the chunk comment above — this
      // renderer never looks at neighbors for its own elevation).
      //
      // Order matters: at equal depth (same tile), Phaser draws later-added
      // objects on top of earlier ones, so every filler below the tile's
      // real elevation is added first (ascending from level 0), with the
      // real block added LAST — its own side art naturally reaches down
      // more than one level, so it draws over and hides each filler's top
      // edge below it, seamlessly, the same way one flat block already
      // hides the tops of the ones "behind" it in ordinary flat terrain.
      for (let level = 0; level < elevation; level++) {
        const fillerImg = this.add
          .image(centerX, centerY + (elevation - level) * levelDisplayHeight, fullKey)
          .setOrigin(0.5, topOriginYFraction)
          .setDisplaySize(diamondW, fullDisplayH)
          .setDepth(tileDepth);
        terrainObjects.push(fillerImg);
      }

      const fullImg = this.add
        .image(centerX, centerY, fullKey)
        .setOrigin(0.5, topOriginYFraction)
        .setDisplaySize(diamondW, fullDisplayH)
        .setDepth(tileDepth);
      terrainObjects.push(fullImg);

      // TEMP DEBUG — remove before finishing: outlines the tile's true
      // world-grid diamond (from the raw corners) in magenta, plus a dot at
      // its exact center, so I can visually check whether the rendered
      // texture actually lines up with the mathematical grid cell.
      const debugG = this.add.graphics().setDepth(100000);
      debugG.lineStyle(1, 0xff00ff, 1);
      debugG.beginPath();
      debugG.moveTo(corners[0].x, corners[0].y);
      debugG.lineTo(corners[1].x, corners[1].y);
      debugG.lineTo(corners[2].x, corners[2].y);
      debugG.lineTo(corners[3].x, corners[3].y);
      debugG.closePath();
      debugG.strokePath();
      debugG.fillStyle(0xff00ff, 1);
      debugG.fillCircle(centerX, centerY, 2);
      terrainObjects.push(debugG);

      // Decorative furniture (see shared/src/api-types.ts's PropType) — a
      // real projectEntity-style depth (not tileDepth) since, unlike
      // terrain, a prop needs to interleave with moving players/monsters
      // (walking in front of or behind a table), not with other tiles.
      const propType = this.chunkCache.propTypeAt(col, row);
      if (propType) {
        const rawCenterProj = isoProject(worldLeft + tileSize / 2, worldTop + tileSize / 2);
        const propImg = this.add
          .image(centerX, centerY, PROP_TEXTURE_KEYS[propType])
          .setOrigin(0.5, 0.85)
          .setDisplaySize(tileSize * 0.9, tileSize * 0.9)
          .setDepth(rawCenterProj.y);
        propSprites.push(propImg);
      }
    }

    this.chunkLayers.set(key, terrainObjects);
    this.chunkPropSprites.set(key, propSprites);

    if (!this.chunkCache.isChunkLoaded(chunkCol * CHUNK_SIZE, chunkRow * CHUNK_SIZE)) {
      this.pendingChunkLoads.add(key);
    }
  }

  // Called once, when the local player's own class is known (their spell set
  // and its size aren't known until then) — builds the hotbar/HUD sized to
  // that class's kit instead of a fixed universal slot count.
  private setupSpellbarForClass(classId: string) {
    const classSpells = this.spellDefsByClass.get(classId) ?? new Map<SpellId, SpellDef>();
    this.spellDefs = classSpells;

    const spellIds = [...classSpells.keys()].sort((a, b) => a - b);

    this.hud = new Hud(
      this,
      spellIds.map((spellId) => ({ spellId, keyLabel: String(spellId) })),
      (spellId) => this.handleSpellActivated(spellId),
    );
    this.hud.setSpellDefs(this.spellDefs);
  }

  private syncCharacterStats(player: Player) {
    sidebar.setStats({
      className: player.className,
      level: player.level,
      experience: player.experience,
      xpToNextLevel: player.xpToNextLevel,
      hp: player.hp,
      maxHp: player.maxHp,
      armor: player.armor,
      strength: player.strength,
      intelligence: player.intelligence,
      dexterity: player.dexterity,
      criticalChance: player.criticalChance,
    });
  }

  // Projects a raw world position to a rendered screen position (shifted
  // up/down by the occupied tile's elevation) plus a depth key for
  // draw-order. depth is deliberately UNSHIFTED (true world position only)
  // — elevation is a pure visual offset, it never lets something merely
  // tall draw in front of something genuinely closer to the camera.
  private projectEntity(worldX: number, worldY: number): { x: number; y: number; depth: number } {
    const tileSize = this.chunkCache.tileSize;
    const col = Math.floor(worldX / tileSize);
    const row = Math.floor(worldY / tileSize);
    const elevation = this.chunkCache.elevationAt(col, row);
    const proj = isoProject(worldX, worldY);
    return { x: proj.x, y: proj.y - isoElevationOffset(elevation, tileSize), depth: proj.y };
  }

  private createHpBar(x: number, y: number, name: string) {
    const barY = y - HP_BAR_OFFSET_Y;
    const hpBarBg = this.add.rectangle(x, barY, HP_BAR_WIDTH, HP_BAR_HEIGHT, 0x222222);
    const hpBarFill = this.add.rectangle(x - HP_BAR_WIDTH / 2, barY, HP_BAR_WIDTH, HP_BAR_HEIGHT, 0x33ff55).setOrigin(0, 0.5);
    const nameText = this.add
      .text(x, y - NAME_TEXT_OFFSET_Y, name, {
        fontSize: "11px",
        color: "#ffffff",
        backgroundColor: "#000000aa",
        padding: { x: 3, y: 1 },
      })
      .setOrigin(0.5);
    return { hpBarBg, hpBarFill, nameText };
  }

  private positionHpBar(entity: HpBarHolder) {
    const barY = entity.rect.y - HP_BAR_OFFSET_Y;
    entity.hpBarBg.setPosition(entity.rect.x, barY).setDepth(entity.rect.depth + 1);
    entity.hpBarFill.setPosition(entity.rect.x - HP_BAR_WIDTH / 2, barY).setDepth(entity.rect.depth + 2);
    entity.nameText.setPosition(entity.rect.x, entity.rect.y - NAME_TEXT_OFFSET_Y).setDepth(entity.rect.depth + 3);
  }

  private createCastBar(x: number, y: number) {
    const barY = y - CAST_BAR_OFFSET_Y;
    const castBarBg = this.add.rectangle(x, barY, HP_BAR_WIDTH, CAST_BAR_HEIGHT, 0x222222);
    const castBarFill = this.add.rectangle(x - HP_BAR_WIDTH / 2, barY, 0, CAST_BAR_HEIGHT, 0xffaa33).setOrigin(0, 0.5);
    return { castBarBg, castBarFill };
  }

  // Only called for monsters that have actually cast at least once (the bar
  // is lazily created) — a no-op for every other monster's per-frame update.
  private positionCastBar(entity: MonsterEntity) {
    if (!entity.castBarBg || !entity.castBarFill) return;
    const barY = entity.rect.y - CAST_BAR_OFFSET_Y;
    entity.castBarBg.setPosition(entity.rect.x, barY).setDepth(entity.rect.depth + 1);
    entity.castBarFill.setPosition(entity.rect.x - HP_BAR_WIDTH / 2, barY).setDepth(entity.rect.depth + 2);

    if (entity.castStartedAt == null) return;
    const elapsed = this.time.now - entity.castStartedAt;
    const frac = Math.min(1, entity.castDurationMs > 0 ? elapsed / entity.castDurationMs : 1);
    entity.castBarFill.width = HP_BAR_WIDTH * frac;
  }

  // Recomputed wholesale from room.state.players (a live, always-current
  // snapshot) rather than incrementally tracked — simpler, and this only
  // runs on the infrequent join/leave edge, not every frame.
  private refreshOnlinePlayers() {
    if (!this.room) return;
    const players: OnlinePlayerView[] = [];
    this.room.state.players.forEach((player, sessionId) => {
      players.push({ sessionId, name: player.name });
    });
    this.onlinePlayers = players;
    sidebar.setOnlinePlayers(players);
    groupFinder.update({ onlinePlayers: players });
  }

  // Reads hp/maxHp straight from room.state.players (always current) rather
  // than the this.entities cache, so this works even the instant a fresh
  // partyState arrives before that member's entity has necessarily synced.
  private refreshPartyFrames() {
    if (!this.room) return;
    const room = this.room;
    const members: PartyFrameMember[] = this.partyState.members.map((member) => {
      const player = room.state.players.get(member.sessionId);
      return {
        sessionId: member.sessionId,
        name: member.name,
        hp: player?.hp ?? 0,
        maxHp: player?.maxHp ?? 0,
        isLeader: member.sessionId === this.partyState.leaderSessionId,
        isSelf: member.sessionId === room.sessionId,
      };
    });
    partyFrames.update(members);
  }

  // Bundles the party/group-finder state this scene mirrors into the shape
  // GroupFinder.show wants — used both when docking it alongside a fresh
  // dungeonPrompt and (indirectly, via Sidebar) for its own Party tab.
  private groupFinderData(mySessionId: string): GroupFinderData {
    return {
      party: this.partyState,
      onlinePlayers: this.onlinePlayers,
      mySessionId,
      applicants: this.partyApplicants,
      openParties: this.openParties,
      myPendingApplications: this.myPendingApplications,
    };
  }

  private groupFinderHandlers(room: Room<RoomState>): GroupFinderHandlers {
    return {
      onCreateGroup: () => room.send("createParty", {}),
      onInvite: (targetSessionId) => room.send("inviteParty", { targetSessionId }),
      onLeave: () => room.send("leaveParty", {}),
      onSetOpen: (open) => room.send("setPartyOpen", { open }),
      onApply: (partyId) => {
        this.myPendingApplications.add(partyId);
        sidebar.setMyPendingApplications(this.myPendingApplications);
        groupFinder.update({ myPendingApplications: this.myPendingApplications });
        room.send("applyToParty", { partyId });
      },
      onWithdrawApplication: (partyId) => {
        this.myPendingApplications.delete(partyId);
        sidebar.setMyPendingApplications(this.myPendingApplications);
        groupFinder.update({ myPendingApplications: this.myPendingApplications });
        room.send("withdrawPartyApplication", { partyId });
      },
      onRespondApplication: (sessionId, accept) => room.send("respondPartyApplication", { sessionId, accept }),
    };
  }

  // Fades an entity (and its HP bar) while a cliff tall enough to hide them
  // stands between their current tile and the camera — purely a rendering
  // effect, see isHiddenByTerrain in shared/src/map.ts.
  private applyOcclusion(entity: HpBarHolder, worldX: number, worldY: number) {
    const alpha = isHiddenByTerrain(this.chunkCache, worldX, worldY) ? OCCLUDED_ALPHA : 1;
    entity.rect.setAlpha(alpha);
    entity.hpBarBg.setAlpha(alpha);
    entity.hpBarFill.setAlpha(alpha);
    entity.nameText.setAlpha(alpha);
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
    const previewSize = isoCircleFootprint(radius);
    const rangeSize = isoCircleFootprint(maxRange);

    // Aiming aids always render on top (UI tier), same as their original
    // fixed-above-everything depth before iso — they're not meant to be
    // occludable by world entities.
    if (!this.groundAoePreviewRing) {
      this.groundAoePreviewRing = this.add.ellipse(0, 0, previewSize.width, previewSize.height).setDepth(UI_DEPTH);
    }
    this.groundAoePreviewRing
      .setSize(previewSize.width, previewSize.height)
      .setStrokeStyle(1, spell.color, 0.6)
      .setFillStyle(spell.color, 0.12)
      .setVisible(true);

    if (!this.groundAoeRangeRing) {
      this.groundAoeRangeRing = this.add.ellipse(0, 0, rangeSize.width, rangeSize.height).setDepth(UI_DEPTH);
    }
    this.groundAoeRangeRing.setSize(rangeSize.width, rangeSize.height).setStrokeStyle(1, spell.color, 0.25).setVisible(true);
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

    const local = this.entities.get(this.room.sessionId);
    if (local && !hasLineOfSight(this.chunkCache, local.worldX, local.worldY, worldX, worldY)) {
      this.showBanner("No line of sight");
      return;
    }

    this.hud.beginCast(spellId, spell.name, this.time.now);
    this.room.send("cast", { spellId, x: worldX, y: worldY });
  }

  private playGroundAoeEffect(msg: GroundAoeEventMessage) {
    // msg.x/y are raw world coordinates from the server — project once
    // (including the target tile's elevation, so the burst sits at the
    // right height), and use an ellipse (not a circle) for the same reason
    // the aiming rings do: a world-space radius isn't a screen-space radius
    // here.
    const p = this.projectEntity(msg.x, msg.y);
    const depth = p.depth + 10; // just above whatever's standing at that spot
    const size = isoCircleFootprint(msg.radius);
    const fill = this.add.ellipse(p.x, p.y, size.width, size.height, msg.color, 0.25).setDepth(depth);
    const outline = this.add
      .ellipse(p.x, p.y, size.width, size.height)
      .setStrokeStyle(2, msg.color, 0.9)
      .setDepth(depth + 1);
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
      .setDepth(entity.rect.depth + 10);
    this.tweens.add({
      targets: ring,
      scale: 2.2,
      alpha: 0,
      duration: 400,
      onComplete: () => ring.destroy(),
    });
  }

  // Floats one line of text per dropped item above the local player and
  // fades it out — a quiet notification that doesn't interrupt play the way
  // the questCompleted alert() does, since this can fire on every kill.
  private playLootEffect(msg: LootDroppedMessage) {
    const local = this.entities.get(this.room?.sessionId ?? "");
    if (!local || msg.drops.length === 0) return;

    msg.drops.forEach((drop, i) => {
      const label = drop.quantity > 1 ? `+${drop.quantity}x ${drop.name}` : `+${drop.name}`;
      const text = this.add
        .text(local.rect.x, local.rect.y - HP_BAR_OFFSET_Y - 14 - i * 16, label, {
          fontSize: "15px",
          color: RARITY_TEXT_COLORS[drop.rarity] ?? "#ffffff",
        })
        .setOrigin(0.5, 1)
        .setDepth(local.rect.depth + 10);
      this.tweens.add({
        targets: text,
        y: text.y - 24,
        alpha: 0,
        duration: 1200,
        delay: i * 120,
        onComplete: () => text.destroy(),
      });
    });
  }

  // Same reused float-and-fade shape as playLootEffect, sent independently
  // (see WorldRoom's "xpGained" message) so a kill with no drops still gets
  // feedback — positioned above where the loot stack starts so the two
  // don't directly overlap when a kill has both.
  private playXpGainedEffect(amount: number) {
    const local = this.entities.get(this.room?.sessionId ?? "");
    if (!local || amount <= 0) return;

    const text = this.add
      .text(local.rect.x, local.rect.y - HP_BAR_OFFSET_Y - 34, `+${amount} XP`, {
        fontSize: "16px",
        fontStyle: "bold",
        color: "#ffcc33",
      })
      .setOrigin(0.5, 1)
      .setDepth(local.rect.depth + 10);
    this.tweens.add({
      targets: text,
      y: text.y - 24,
      alpha: 0,
      duration: 1200,
      onComplete: () => text.destroy(),
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
      (part as Phaser.GameObjects.Rectangle | Phaser.GameObjects.Text).setScrollFactor(0).setDepth(UI_DEPTH);
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
      name = `${monster.name} (Lvl ${monster.level})`;
      hp = monster.hp;
      maxHp = monster.maxHp;
    }

    this.targetNameText?.setText(name);
    if (this.targetHpFill) this.targetHpFill.width = TARGET_PANEL_HP_WIDTH * Math.max(0, hp / maxHp);
  }

  // Brief fading red banner at screen center — reuses one text object
  // (reset/re-tweened on each call) rather than spawning a new one per
  // message, since the triggers (spamming a blocked cast, walking into a
  // barrier) tend to repeat rapidly. Used for cast rejections and the
  // "zone not implemented" notice alike.
  private showBanner(reason: string) {
    const cam = this.cameras.main;
    if (!this.bannerText) {
      this.bannerText = this.add
        .text(0, 0, "", {
          fontSize: "16px",
          color: "#ff5555",
          backgroundColor: "#000000aa",
          padding: { x: 8, y: 4 },
        })
        .setOrigin(0.5)
        .setScrollFactor(0)
        .setDepth(UI_DEPTH);
    }
    this.tweens.killTweensOf(this.bannerText);
    this.bannerText.setText(reason).setPosition(cam.width / 2, cam.height / 2 - 80).setAlpha(1);
    this.tweens.add({ targets: this.bannerText, alpha: 0, duration: 800, delay: 500 });
  }

  // In-game banner (not a blocking alert()) — same reused-object/fade-tween
  // shape as showBanner, just a celebratory beat rather than an
  // error: bigger text, a pop-in scale tween, and a much longer hold before
  // it fades, since this only fires once per dungeon run and is worth
  // actually noticing.
  private showDungeonClearedBanner() {
    const cam = this.cameras.main;
    if (!this.dungeonClearedText) {
      this.dungeonClearedText = this.add
        .text(0, 0, "Dungeon Cleared!", {
          fontSize: "32px",
          fontStyle: "bold",
          color: "#ffcc33",
          backgroundColor: "#000000aa",
          padding: { x: 18, y: 12 },
        })
        .setOrigin(0.5)
        .setScrollFactor(0)
        .setDepth(UI_DEPTH);
    }
    this.tweens.killTweensOf(this.dungeonClearedText);
    this.dungeonClearedText.setPosition(cam.width / 2, cam.height / 2 - 160).setAlpha(1).setScale(0.7);
    this.tweens.add({ targets: this.dungeonClearedText, scale: 1, duration: 250, ease: "Back.Out" });
    this.tweens.add({ targets: this.dungeonClearedText, alpha: 0, duration: 1000, delay: 2500 });
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
    const local = this.entities.get(this.room.sessionId);
    const monster = this.monsters.get(this.target.id);
    if (local && monster && !hasLineOfSight(this.chunkCache, local.worldX, local.worldY, monster.worldX, monster.worldY)) {
      this.showBanner("No line of sight");
      return;
    }
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

    let screenDx = 0;
    let screenDy = 0;
    if (this.cursors.left.isDown || this.wasd?.A.isDown) screenDx = -1;
    else if (this.cursors.right.isDown || this.wasd?.D.isDown) screenDx = 1;
    if (this.cursors.up.isDown || this.wasd?.W.isDown) screenDy = -1;
    else if (this.cursors.down.isDown || this.wasd?.S.isDown) screenDy = 1;

    if (screenDx === -1) this.lastDirection = "left";
    else if (screenDx === 1) this.lastDirection = "right";
    else if (screenDy === -1) this.lastDirection = "up";
    else if (screenDy === 1) this.lastDirection = "down";

    // Moving cancels a channeled cast rather than being blocked outright —
    // mirrors the server, which interrupts the cast the moment movement
    // input arrives instead of rooting the player in place.
    if (screenDx !== 0 || screenDy !== 0) {
      const castingSpellId = this.hud?.getCastingSpellId();
      if (castingSpellId != null) this.hud?.cancelCast(castingSpellId);
    }

    // WASD/arrows express screen-relative intent ("Up" = visually up), but
    // movement (both the server and local prediction) happens in raw
    // world-space — remap so pressing Up doesn't walk the character
    // diagonally just because the world is now rendered isometrically.
    const worldDir = isoUnprojectDirection(screenDx, screenDy);

    if (screenDx !== this.lastSent.dx || screenDy !== this.lastSent.dy) {
      this.lastSent = { dx: screenDx, dy: screenDy };
      this.room.send("move", { dx: worldDir.x, dy: worldDir.y, direction: this.lastDirection });
    }

    // Predict the local player's movement immediately instead of waiting on
    // the network round-trip; resolveMovement is the same collision function
    // the server uses, so prediction can't walk through a wall the server
    // would also block. Reads/writes local.worldX/Y (raw simulation space)
    // rather than targetX/Y — targetX/Y is continuously overwritten by
    // server state broadcasts, so using it here would snap prediction back
    // to a network-lagged position on every tick (rubber-banding).
    const local = this.entities.get(this.room.sessionId);
    if (local?.isLocal) {
      if (screenDx !== 0 || screenDy !== 0) {
        const resolved = resolveMovement(
          this.chunkCache,
          local.worldX,
          local.worldY,
          worldDir.x * MOVE_SPEED * dt,
          worldDir.y * MOVE_SPEED * dt,
        );
        local.worldX = resolved.x;
        local.worldY = resolved.y;
      } else {
        // Reconciliation only runs while idle, not on every frame — pulling
        // toward the server's last-reported position (always a little
        // behind, due to latency) *while actively predicting* fights the
        // input-driven movement above, since prediction pushes forward at
        // full speed the same frame reconciliation pulls back toward a
        // laggier point. That tug-of-war is what made movement feel
        // sluggish/imprecise. Idle is also when any drift is easiest to
        // correct invisibly — there's no ongoing motion for a small nudge
        // to visibly interrupt — so it uses a much stronger factor than
        // REMOTE_SMOOTHING would need for a moving entity.
        local.worldX = Phaser.Math.Linear(local.worldX, local.targetX, LOCAL_RECONCILE_SMOOTHING);
        local.worldY = Phaser.Math.Linear(local.worldY, local.targetY, LOCAL_RECONCILE_SMOOTHING);
      }

      const p = this.projectEntity(local.worldX, local.worldY);
      local.rect.x = p.x;
      local.rect.y = p.y;
      local.rect.setDepth(p.depth);
      this.positionHpBar(local);
      this.applyOcclusion(local, local.worldX, local.worldY);
    }
  }

  // Lerping happens in raw world space, then the result is projected for
  // rendering — lerping rect.x/y directly (screen space) toward targetX/Y
  // (world space) would mix two different coordinate systems.
  private updateRemoteEntities() {
    for (const entity of this.entities.values()) {
      if (entity.isLocal) continue;
      entity.worldX = Phaser.Math.Linear(entity.worldX, entity.targetX, REMOTE_SMOOTHING);
      entity.worldY = Phaser.Math.Linear(entity.worldY, entity.targetY, REMOTE_SMOOTHING);
      const p = this.projectEntity(entity.worldX, entity.worldY);
      entity.rect.setPosition(p.x, p.y).setDepth(p.depth);
      this.positionHpBar(entity);
      this.applyOcclusion(entity, entity.worldX, entity.worldY);
    }

    for (const entity of this.monsters.values()) {
      entity.worldX = Phaser.Math.Linear(entity.worldX, entity.targetX, REMOTE_SMOOTHING);
      entity.worldY = Phaser.Math.Linear(entity.worldY, entity.targetY, REMOTE_SMOOTHING);
      const p = this.projectEntity(entity.worldX, entity.worldY);
      entity.rect.setPosition(p.x, p.y).setDepth(p.depth);
      this.positionHpBar(entity);
      this.positionCastBar(entity);
      this.applyOcclusion(entity, entity.worldX, entity.worldY);
    }

    for (const entity of this.projectiles.values()) {
      entity.worldX = Phaser.Math.Linear(entity.worldX, entity.targetX, REMOTE_SMOOTHING);
      entity.worldY = Phaser.Math.Linear(entity.worldY, entity.targetY, REMOTE_SMOOTHING);
      const p = this.projectEntity(entity.worldX, entity.worldY);
      entity.shape.setPosition(p.x, p.y).setDepth(p.depth);
    }

    if (this.target) {
      const entity = this.target.kind === "self" ? this.entities.get(this.room?.sessionId ?? "") : this.monsters.get(this.target.id);
      if (entity) this.targetRing?.setPosition(entity.rect.x, entity.rect.y).setDepth(entity.rect.depth + 1);

      if (this.target.kind === "monster") {
        const monster = this.monsters.get(this.target.id);
        if (monster && monster.attackRange > 0) {
          const size = isoCircleFootprint(monster.attackRange);
          if (!this.attackRangeIndicator) {
            this.attackRangeIndicator = this.add.ellipse(0, 0, size.width, size.height).setStrokeStyle(1, 0xff3333, 0.5);
          }
          this.attackRangeIndicator
            .setPosition(monster.rect.x, monster.rect.y)
            .setSize(size.width, size.height)
            .setDepth(monster.rect.depth - 1)
            .setVisible(true);
        } else {
          this.attackRangeIndicator?.setVisible(false);
        }
      } else {
        this.attackRangeIndicator?.setVisible(false);
      }

      this.refreshTargetPanel();
    } else {
      this.attackRangeIndicator?.setVisible(false);
    }

    if (this.aimingSpell && this.room) {
      const local = this.entities.get(this.room.sessionId);
      const spell = this.spellDefs.get(this.aimingSpell);
      const pointer = this.input.activePointer;
      this.groundAoePreviewRing?.setPosition(pointer.worldX, pointer.worldY);
      if (local) {
        this.groundAoeRangeRing?.setPosition(local.rect.x, local.rect.y);
        const maxRange = spell?.maxRange ?? Infinity;
        // In-range must compare raw world distances (matching how the
        // server enforces maxRange), not projected-screen distances — the
        // iso transform isn't uniform, so screen distance isn't
        // proportional to real distance.
        const rawPointer = isoUnproject(pointer.worldX, pointer.worldY);
        const inRange = Phaser.Math.Distance.Between(local.worldX, local.worldY, rawPointer.x, rawPointer.y) <= maxRange;
        const color = inRange ? (spell?.color ?? 0xffffff) : 0xff3333;
        this.groundAoePreviewRing?.setStrokeStyle(1, color, 0.6).setFillStyle(color, 0.12);
      }
    }
  }
}
