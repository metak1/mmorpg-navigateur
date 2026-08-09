import type { SpellId } from "./spells.js";
import type { EquipmentSlot, ItemRarity, ItemSlotType } from "./api-types.js";

export const WORLD_ROOM = "world";
// Registered against the exact same WorldRoom class as WORLD_ROOM (see
// packages/server/src/index.ts) — a dungeon instance is a WorldRoom created
// with mapId/allowedCharacterIds room options rather than a separate room
// implementation, so it inherits every existing system (combat, spells,
// quests, inventory, talents) for free. The two names exist so overworld
// clients can never accidentally matchmake into a dungeon instance via
// plain joinOrCreate — dungeon instances are only ever reached via an
// explicit server-issued roomId (see PortalGrantedMessage).
export const DUNGEON_ROOM = "dungeon";
export const MOVE_SPEED = 200; // px/sec

// Options sent when joining the world room. The session token is issued by
// POST /api/auth/login or /api/auth/register and identifies the account
// server-side; characterId selects which of that account's characters to
// play — the room verifies both, it never trusts a client-supplied name.
export interface JoinOptions {
  token: string;
  characterId: string;
}

export interface MoveInputMessage {
  dx: number;
  dy: number;
  direction: "up" | "down" | "left" | "right";
}

export interface CastInputMessage {
  spellId: SpellId;
  // Monster id to aim at, captured at cast time. Omitted/ignored for
  // self-targeted kinds (e.g. "heal") and ground-targeted kinds ("groundAoe").
  targetId?: string;
  // World-space cast point for "groundAoe" — wherever the caster's mouse was
  // at cast time. Ignored by every other kind.
  x?: number;
  y?: number;
}

// Broadcast whenever a heal successfully lands (cooldown passed), so clients
// can show a cast effect even though "heal" has no Projectile state to watch.
export interface HealEventMessage {
  sessionId: string;
}

// Broadcast whenever a "groundAoe" cast resolves, so clients can render the
// burst at its (possibly range-clamped) landing point and radius.
export interface GroundAoeEventMessage {
  x: number;
  y: number;
  radius: number;
  color: number;
}

// Sent back to the casting client only, when a targeted cast (single/aoe/
// slow) resolves with no valid target left — e.g. the monster died in the
// window between being targeted and the cast (possibly after a cast-time
// delay) actually resolving. The per-spell cooldown is refunded server-side
// when this fires, so the client rolls back its optimistic cooldown/cast-bar
// UI to match, instead of leaving it playing out for a cast that never
// happened.
export interface CastFizzledMessage {
  spellId: SpellId;
}

// Sent back to the casting client only, rejecting a cast at the moment it's
// requested (before any cast-time delay, GCD, or cooldown is spent) — e.g.
// no line of sight to the target/point. Distinct from CastFizzledMessage,
// which reports a cast that was already accepted and is unwinding after the
// fact.
export interface CastFailedMessage {
  spellId: SpellId;
  reason: string;
}

// Client -> server: interact with an NPC (approaches it and clicks/presses
// interact). The server replies with "npcDialogue" describing what that NPC
// currently has to say to this character.
export interface TalkMessage {
  npcId: string;
}

export interface AcceptQuestMessage {
  questId: string;
}

export interface TurnInQuestMessage {
  questId: string;
}

export type NpcDialogueOptionKind = "offer" | "turnIn" | "inProgress";

// One quest-shaped thing this NPC currently has to say: a new quest it can
// give ("offer"), an active quest it gave that's ready to complete
// ("turnIn"), or an active quest it gave that isn't ready yet ("inProgress",
// shown so players know to come back later instead of nothing happening).
export interface NpcDialogueOption {
  kind: NpcDialogueOptionKind;
  questId: string;
  title: string;
  description: string;
  objectiveSummary: string;
}

export interface NpcDialogueMessage {
  npcId: string;
  npcName: string;
  options: NpcDialogueOption[];
}

// Sent back to the requesting client only, when accept/turn-in is rejected
// server-side (e.g. already have it, not actually ready yet) — the dialogue
// UI shows the reason instead of silently doing nothing.
export interface QuestActionFailedMessage {
  questId: string;
  reason: string;
}

export interface QuestCompletedMessage {
  questId: string;
  title: string;
  rewardXp: number;
  rewardItems: Array<{ name: string; quantity: number }>;
}

export interface CompletedQuestView {
  questId: string;
  title: string;
}

// Pushed at join and again after every turn-in — the full list is small
// enough (and infrequent enough to change) that resending it wholesale is
// simpler than diffing, same call as InventoryStateMessage.
export interface CompletedQuestsStateMessage {
  quests: CompletedQuestView[];
}

// Client -> server: equip an owned item into a specific concrete slot. The
// slot must be compatible with the item's category (ring items -> ring1/
// ring2, trinket items -> trinket1/trinket2, everything else maps 1:1).
export interface EquipItemMessage {
  itemId: string;
  slot: EquipmentSlot;
}

export interface UnequipItemMessage {
  slot: EquipmentSlot;
}

export interface EquipActionFailedMessage {
  reason: string;
}

export interface InventoryItemView {
  itemId: string;
  name: string;
  description: string;
  color: number;
  rarity: ItemRarity;
  slotType: ItemSlotType | null;
  quantity: number;
}

export interface EquippedItemView {
  slot: EquipmentSlot;
  itemId: string;
  name: string;
  color: number;
  rarity: ItemRarity;
}

// Pushed to the owning client whenever their inventory or equipped loadout
// changes (join, quest reward, equip, unequip) — private per-character data,
// so it's request/response messaging rather than synced room state.
export interface InventoryStateMessage {
  items: InventoryItemView[];
  equipped: EquippedItemView[];
}

// Client -> server: spend one available talent point on this talent
// (bumping its rank by 1). Rejected (see TalentActionFailedMessage) if the
// prerequisite isn't met, it's already at max rank, or no points are free —
// see shared/src/talents.ts's canLearnTalent, the single rule both server
// and client evaluate.
export interface LearnTalentMessage {
  talentId: string;
}

export interface TalentActionFailedMessage {
  reason: string;
}

export interface LearnedTalentView {
  talentId: string;
  rank: number;
}

// Client -> server: admin-only debug command that fast-forwards the sending
// character straight to `level`, granting exactly the XP needed via the
// same grantExperience growth curve a normal level-up uses (so stats/HP
// grow correctly, not just the level number) — lets an admin unlock
// level-gated features like talent points instantly while testing, without
// grinding. Silently ignored server-side (see WorldRoom.handleAdminSetLevel)
// if the connected account isn't an admin.
export interface AdminSetLevelMessage {
  level: number;
}

// Pushed to the owning client at join and after every learnTalent — private
// per-character data, same "push on demand rather than synced room state"
// rationale as InventoryStateMessage. `points` is redundant with the synced
// Player.talentPoints field but included so the talent panel can render
// standalone off one message without also subscribing to schema changes.
export interface TalentStateMessage {
  points: number;
  learned: LearnedTalentView[];
}

// Sent to the killing player only, once per monster death, listing every
// loot-table entry that rolled successfully (may be empty).
export interface LootDroppedMessage {
  drops: Array<{ itemId: string; name: string; color: number; rarity: ItemRarity; quantity: number }>;
}

// Sent to the killing player only, once per monster death — independent of
// LootDroppedMessage (which is skipped entirely when nothing rolls), so a
// kill with no drops still gets XP feedback. Purely a client-side floating-
// text cue; grantXp applies the actual stat change separately.
export interface XpGainedMessage {
  amount: number;
}

// --- Party system ---
// Lives entirely as extra state/messages on WorldRoom rather than a
// separate service — every overworld player is already colocated in the
// one running WorldRoom instance (see DUNGEON_ROOM's comment), so no
// cross-room presence infrastructure is needed for players to find/invite
// each other.

export const MAX_PARTY_SIZE = 4;

// Client -> server: explicitly forms a new party of just the sender (as
// leader), rather than leaving a party to spring into existence implicitly
// the first time an invite is accepted (see RespondPartyInviteMessage's
// server handling). Lets a player commit to "I'm forming a group" — and see
// themselves listed as one — before anyone else has joined. A no-op if the
// sender is already in a party.
export interface CreatePartyMessage {}

export interface InvitePartyMessage {
  targetSessionId: string;
}

// Pushed to the invitee only — the client shows a blocking accept/decline
// prompt (this is rare and needs an answer now, unlike e.g. loot drops).
export interface PartyInviteReceivedMessage {
  fromSessionId: string;
  fromName: string;
}

export interface RespondPartyInviteMessage {
  fromSessionId: string;
  accept: boolean;
}

// Client -> server: leave (or, if the sender is the only member, disband)
// the sender's current party. No payload — "which party" is implicit from
// the sender's session.
export interface LeavePartyMessage {}

export interface PartyActionFailedMessage {
  reason: string;
}

export interface PartyMemberView {
  sessionId: string;
  name: string;
  level: number;
  className: string;
}

// Pushed to every current member whenever the roster changes (invite
// accepted, member left, party disbanded) — an empty members array means
// "you are not in a party." leaderSessionId is used both cosmetically (a
// star in the roster) and functionally now — only the leader may invite,
// toggle open/closed, or accept/decline applications.
export interface PartyStateMessage {
  leaderSessionId: string | null;
  members: PartyMemberView[];
  // Whether this party currently shows up in everyone's browsable
  // "recruiting" list (see OpenPartiesStateMessage) and accepts unsolicited
  // applications — leader-controlled via SetPartyOpenMessage. Always false
  // on an empty (no-party) state.
  open: boolean;
}

// --- Party applications ---
// A second way to end up in a group besides a direct invite: the leader
// marks their party "open," it shows up in everyone's browsable list, and
// anyone not already in a party can apply — the leader then accepts or
// declines each applicant individually, same shape as the existing invite
// accept/decline flow just initiated from the other side.

// Client -> server: leader-only, toggles whether the party is open (see
// PartyStateMessage.open).
export interface SetPartyOpenMessage {
  open: boolean;
}

// Client -> server: apply to join a specific open party (seen via
// OpenPartiesStateMessage). Rejected (via PartyActionFailedMessage) if the
// sender is already in a party, or the target party isn't open/is full.
export interface ApplyToPartyMessage {
  partyId: string;
}

// Client -> server: cancels a previously-sent application before the
// leader has responded to it.
export interface WithdrawPartyApplicationMessage {
  partyId: string;
}

// Client -> server: leader-only, accepts or declines one pending applicant.
export interface RespondPartyApplicationMessage {
  sessionId: string;
  accept: boolean;
}

export interface PartyApplicantView {
  sessionId: string;
  name: string;
}

// Pushed to the party leader only (applications are private to them),
// wholesale, whenever the pending list changes — apply, withdraw, accept,
// decline, or an applicant disconnecting.
export interface PartyApplicationsStateMessage {
  applicants: PartyApplicantView[];
}

// Sent to the applicant only, when the leader declines (or the party fills
// up / closes before they respond) — lets the client clear its own
// "applied" UI state for that specific party. Accept has no equivalent
// dedicated message since the resulting PartyStateMessage already covers it
// (the applicant is now simply a member).
export interface PartyApplicationDeclinedMessage {
  partyId: string;
}

export interface OpenPartyView {
  partyId: string;
  leaderName: string;
  memberCount: number;
}

// Pushed to every connected client (not just party members — this is the
// browsable list everyone sees) whenever the set of open, non-full parties
// changes.
export interface OpenPartiesStateMessage {
  parties: OpenPartyView[];
}

// --- Portals / dungeons ---

// Client -> server: interact with a portal (walk up and click it, same
// interaction shape as talking to an NPC).
export interface UsePortalMessage {
  portalId: string;
}

export interface PortalFailedMessage {
  reason: string;
}

// Sent to every member of the entering party (not just whoever clicked the
// portal), telling the client which room/map to switch to. roomId is only
// present for a dungeon target — the client joins that specific instance
// by id (see net/RoomClient.ts's joinRoomById) so the whole party lands in
// the same room. A portal to a non-dungeon map (the overworld, e.g. a
// dungeon's return portal) omits roomId entirely — the client just rejoins
// the shared overworld room via ordinary matchmaking (connectToWorld).
// mapId is always present so the client can bootstrap map metadata
// (tileSize/spawn point/cliffColor) for the destination map instead of
// assuming "the active map" the way the very first connect does.
export interface PortalGrantedMessage {
  roomId?: string;
  mapId: string;
}

// Broadcast to a dungeon instance's room when its boss (a MonsterSpawn
// flagged isBoss) dies. No payload — the client just shows a clear message;
// there's no separate persisted "this character has cleared this dungeon"
// tracking (loot + a message is the full scope for this pass).
export interface DungeonClearedMessage {}

// Sent to the requesting client only, in place of an immediate
// PortalGrantedMessage, whenever the clicked portal's target is a dungeon
// map — gives the client enough to show a confirmation screen (description,
// level requirement, party roster/invite) before actually committing to
// create/join the instance via EnterDungeonMessage. A portal to a
// non-dungeon map (including a dungeon's own return portal) skips this
// entirely and still resolves immediately, since there's nothing to
// confirm about leaving.
export interface DungeonPromptMessage {
  portalId: string;
  mapId: string;
  name: string;
  description: string;
  minLevel: number;
}

// Client -> server: confirms a dungeon entry previously offered via
// DungeonPromptMessage. Re-validates range/level server-side exactly like
// UsePortalMessage did before this prompt step existed — the prompt is a UX
// nicety, not something the server trusts blindly.
export interface EnterDungeonMessage {
  portalId: string;
}
