import type { DungeonPromptMessage, PartyStateMessage } from "shared";
import type { OnlinePlayerView } from "./Sidebar.js";

export interface DungeonPromptHandlers {
  onInvite: (targetSessionId: string) => void;
  onLeave: () => void;
  onEnter: (portalId: string) => void;
  onCancel: () => void;
}

const EMPTY_PARTY_STATE: PartyStateMessage = { leaderSessionId: null, members: [] };

// A DOM overlay (like NpcDialogue/Sidebar), shown in place of instantly
// entering a dungeon — gives the player a chance to read what they're
// walking into and put a group together first. Party membership itself is
// still the same room-wide party system the sidebar's Party tab drives
// (WorldRoom's parties map); this just surfaces invite/leave controls right
// where they're needed instead of requiring a detour to another tab.
export class DungeonPrompt {
  private overlay: HTMLDivElement;
  private handlers?: DungeonPromptHandlers;
  private message?: DungeonPromptMessage;
  private party: PartyStateMessage = EMPTY_PARTY_STATE;
  private onlinePlayers: OnlinePlayerView[] = [];
  private mySessionId = "";

  constructor() {
    this.overlay = document.createElement("div");
    this.overlay.id = "dungeon-prompt-overlay";
    this.overlay.style.display = "none";
    document.body.appendChild(this.overlay);
  }

  get isVisible(): boolean {
    return this.message !== undefined;
  }

  show(
    message: DungeonPromptMessage,
    party: PartyStateMessage,
    onlinePlayers: OnlinePlayerView[],
    mySessionId: string,
    handlers: DungeonPromptHandlers,
  ) {
    this.message = message;
    this.party = party;
    this.onlinePlayers = onlinePlayers;
    this.mySessionId = mySessionId;
    this.handlers = handlers;
    this.render();
    this.overlay.style.display = "flex";
  }

  hide() {
    this.message = undefined;
    this.overlay.style.display = "none";
    this.overlay.innerHTML = "";
  }

  // Called whenever party/online-player state changes elsewhere (e.g. an
  // invite is accepted) while this prompt happens to be open, so the
  // roster/invite list stay live instead of going stale until re-opened.
  updateParty(party: PartyStateMessage) {
    this.party = party;
    if (this.isVisible) this.render();
  }

  updateOnlinePlayers(players: OnlinePlayerView[]) {
    this.onlinePlayers = players;
    if (this.isVisible) this.render();
  }

  private render() {
    const message = this.message;
    if (!message) return;
    this.overlay.innerHTML = "";

    const panel = document.createElement("div");
    panel.id = "dungeon-prompt-panel";

    const title = document.createElement("h3");
    title.textContent = message.name;
    panel.appendChild(title);

    const minLevel = document.createElement("div");
    minLevel.className = "dungeon-prompt-min-level";
    minLevel.textContent = `Requires level ${message.minLevel}+`;
    panel.appendChild(minLevel);

    if (message.description) {
      const description = document.createElement("p");
      description.className = "dungeon-prompt-description";
      description.textContent = message.description;
      panel.appendChild(description);
    }

    // --- Party: create or join a group before entering ---
    const partyHeader = document.createElement("div");
    partyHeader.className = "dungeon-prompt-section-header";
    partyHeader.textContent = "Your Party";
    panel.appendChild(partyHeader);

    if (this.party.members.length > 0) {
      const roster = document.createElement("div");
      roster.className = "dungeon-prompt-roster";
      for (const member of this.party.members) {
        const row = document.createElement("div");
        row.className = "bag-item";
        const name = document.createElement("div");
        name.className = "bag-item-name";
        const isLeader = member.sessionId === this.party.leaderSessionId;
        name.textContent = `${isLeader ? "★ " : ""}${member.name}`;
        const desc = document.createElement("div");
        desc.className = "bag-item-desc";
        desc.textContent = `Lvl ${member.level} ${member.className}`;
        row.append(name, desc);
        roster.appendChild(row);
      }
      panel.appendChild(roster);

      const leaveBtn = document.createElement("button");
      leaveBtn.className = "dungeon-prompt-leave-btn";
      leaveBtn.textContent = "Leave Party";
      leaveBtn.addEventListener("click", () => this.handlers?.onLeave());
      panel.appendChild(leaveBtn);
    } else {
      const empty = document.createElement("div");
      empty.className = "bag-empty";
      empty.textContent = "Not in a party — invite someone below, or enter solo.";
      panel.appendChild(empty);
    }

    const inPartySessionIds = new Set(this.party.members.map((m) => m.sessionId));
    const invitable = this.onlinePlayers.filter((p) => p.sessionId !== this.mySessionId);
    if (invitable.length > 0) {
      const listHeader = document.createElement("div");
      listHeader.className = "dungeon-prompt-section-header";
      listHeader.textContent = "Invite";
      panel.appendChild(listHeader);

      const list = document.createElement("div");
      list.className = "dungeon-prompt-invite-list";
      for (const player of invitable) {
        const row = document.createElement("div");
        row.className = "bag-item";
        const name = document.createElement("div");
        name.className = "bag-item-name";
        name.textContent = player.name;
        row.appendChild(name);
        if (!inPartySessionIds.has(player.sessionId)) {
          const button = document.createElement("button");
          button.textContent = "Invite";
          button.addEventListener("click", () => this.handlers?.onInvite(player.sessionId));
          row.appendChild(button);
        }
        list.appendChild(row);
      }
      panel.appendChild(list);
    }

    // --- Actions ---
    const actions = document.createElement("div");
    actions.className = "dungeon-prompt-actions";

    const enterButton = document.createElement("button");
    enterButton.className = "dungeon-prompt-enter-btn";
    enterButton.textContent = "Enter Dungeon";
    enterButton.addEventListener("click", () => this.handlers?.onEnter(message.portalId));
    actions.appendChild(enterButton);

    const cancelButton = document.createElement("button");
    cancelButton.className = "dungeon-prompt-cancel-btn";
    cancelButton.textContent = "Cancel";
    cancelButton.addEventListener("click", () => {
      this.handlers?.onCancel();
      this.hide();
    });
    actions.appendChild(cancelButton);

    panel.appendChild(actions);
    this.overlay.appendChild(panel);
  }
}

export const dungeonPrompt = new DungeonPrompt();
