import type { PartyStateMessage, PartyApplicantView, OpenPartyView } from "shared";
import type { OnlinePlayerView } from "./Sidebar.js";

export interface GroupFinderHandlers {
  onCreateGroup: () => void;
  onInvite: (targetSessionId: string) => void;
  onLeave: () => void;
  onSetOpen: (open: boolean) => void;
  onApply: (partyId: string) => void;
  onWithdrawApplication: (partyId: string) => void;
  onRespondApplication: (sessionId: string, accept: boolean) => void;
}

export interface GroupFinderData {
  party: PartyStateMessage;
  onlinePlayers: OnlinePlayerView[];
  mySessionId: string;
  // Pending applicants to *my* party — only meaningful (and only ever
  // non-empty) when I'm the leader; the server never sends this to anyone
  // else (see WorldRoom.sendPartyApplications).
  applicants: PartyApplicantView[];
  // The browsable list of every open, non-full party server-wide (see
  // OpenPartiesStateMessage) — not just ones I could join, so the "Find
  // Group" tab still shows nothing but an empty state while I'm in a party.
  openParties: OpenPartyView[];
  // Locally tracked (see WorldScene) — partyIds I've sent an application to
  // and haven't heard back on yet, since the server only confirms rejection
  // (PartyApplicationDeclinedMessage), not success (a PartyStateMessage
  // update covers that instead).
  myPendingApplications: ReadonlySet<string>;
}

const EMPTY_DATA: GroupFinderData = {
  party: { leaderSessionId: null, members: [], open: false },
  onlinePlayers: [],
  mySessionId: "",
  applicants: [],
  openParties: [],
  myPendingApplications: new Set(),
};

type Tab = "mine" | "browse";

// Renders the party/group UI into whatever container a caller hands it — a
// genuinely shared component rather than each caller keeping its own copy
// of this logic, since it's used from two places: the sidebar's always-
// available Party tab, and docked alongside the dungeon-entry prompt (see
// DungeonPrompt) so a group can be put together right where "enter this
// dungeon" is being decided.
export class GroupFinder {
  private container: HTMLElement | null = null;
  private handlers?: GroupFinderHandlers;
  private data: GroupFinderData = EMPTY_DATA;
  private activeTab: Tab = "mine";

  show(container: HTMLElement, data: GroupFinderData, handlers: GroupFinderHandlers) {
    this.container = container;
    this.data = data;
    this.handlers = handlers;
    this.render();
  }

  // Callers must call this once the container they passed to show() is
  // about to be reused for something else (e.g. the sidebar switching away
  // from the Party tab, or a dungeon prompt closing) — otherwise a later
  // update() would blindly re-render stale content into whatever now
  // occupies that container.
  hide() {
    this.container = null;
  }

  // Merges a partial update (one piece of the picture changing — a
  // partyState/openPartiesState/etc. push arriving) into the current
  // snapshot and re-renders, if currently shown.
  update(partial: Partial<GroupFinderData>) {
    this.data = { ...this.data, ...partial };
    if (this.container) this.render();
  }

  private render() {
    if (!this.container) return;
    this.container.innerHTML = "";

    const wrapper = document.createElement("div");
    wrapper.className = "group-finder";

    const tabs = document.createElement("div");
    tabs.className = "group-finder-tabs";
    tabs.append(this.buildTabButton("mine", "My Group"), this.buildTabButton("browse", "Find Group"));
    wrapper.appendChild(tabs);

    if (this.activeTab === "mine") this.renderMine(wrapper);
    else this.renderBrowse(wrapper);

    this.container.appendChild(wrapper);
  }

  private buildTabButton(tab: Tab, label: string): HTMLButtonElement {
    const button = document.createElement("button");
    button.className = `group-finder-tab${this.activeTab === tab ? " active" : ""}`;
    button.textContent = label;
    button.addEventListener("click", () => {
      this.activeTab = tab;
      this.render();
    });
    return button;
  }

  private renderMine(wrapper: HTMLElement) {
    const { party, mySessionId } = this.data;
    const inParty = party.members.length > 0;
    const isLeader = inParty && party.leaderSessionId === mySessionId;

    if (inParty) {
      const roster = document.createElement("div");
      roster.className = "group-finder-roster";
      for (const member of party.members) {
        const row = document.createElement("div");
        row.className = "bag-item";
        const name = document.createElement("div");
        name.className = "bag-item-name";
        const memberIsLeader = member.sessionId === party.leaderSessionId;
        name.textContent = `${memberIsLeader ? "★ " : ""}${member.name}`;
        const desc = document.createElement("div");
        desc.className = "bag-item-desc";
        desc.textContent = `Lvl ${member.level} ${member.className}`;
        row.append(name, desc);
        roster.appendChild(row);
      }
      wrapper.appendChild(roster);

      if (isLeader) {
        const openLabel = document.createElement("label");
        openLabel.className = "group-finder-open-toggle";
        const openCheckbox = document.createElement("input");
        openCheckbox.type = "checkbox";
        openCheckbox.checked = party.open;
        openCheckbox.addEventListener("change", () => this.handlers?.onSetOpen(openCheckbox.checked));
        openLabel.append(openCheckbox, document.createTextNode(" Open to applications"));
        wrapper.appendChild(openLabel);
      }

      const leaveBtn = document.createElement("button");
      leaveBtn.className = "group-finder-leave-btn";
      leaveBtn.textContent = "Leave Group";
      leaveBtn.addEventListener("click", () => this.handlers?.onLeave());
      wrapper.appendChild(leaveBtn);
    } else {
      const empty = document.createElement("div");
      empty.className = "bag-empty";
      empty.textContent = "Not in a group yet.";
      wrapper.appendChild(empty);

      const createBtn = document.createElement("button");
      createBtn.className = "group-finder-create-btn";
      createBtn.textContent = "Create Group";
      createBtn.addEventListener("click", () => this.handlers?.onCreateGroup());
      wrapper.appendChild(createBtn);
    }

    if (isLeader && this.data.applicants.length > 0) {
      const header = document.createElement("div");
      header.className = "group-finder-header";
      header.textContent = "Applications";
      wrapper.appendChild(header);

      const list = document.createElement("div");
      list.className = "group-finder-applicant-list";
      for (const applicant of this.data.applicants) {
        const row = document.createElement("div");
        row.className = "bag-item";
        const name = document.createElement("div");
        name.className = "bag-item-name";
        name.textContent = applicant.name;
        row.appendChild(name);

        const actions = document.createElement("div");
        actions.className = "group-finder-applicant-actions";
        const acceptBtn = document.createElement("button");
        acceptBtn.textContent = "Accept";
        acceptBtn.addEventListener("click", () => this.handlers?.onRespondApplication(applicant.sessionId, true));
        const declineBtn = document.createElement("button");
        declineBtn.className = "group-finder-decline-btn";
        declineBtn.textContent = "Decline";
        declineBtn.addEventListener("click", () => this.handlers?.onRespondApplication(applicant.sessionId, false));
        actions.append(acceptBtn, declineBtn);
        row.appendChild(actions);
        list.appendChild(row);
      }
      wrapper.appendChild(list);
    }

    if (inParty) {
      const inPartySessionIds = new Set(party.members.map((m) => m.sessionId));
      const invitable = this.data.onlinePlayers.filter((p) => p.sessionId !== mySessionId && !inPartySessionIds.has(p.sessionId));

      const listHeader = document.createElement("div");
      listHeader.className = "group-finder-header";
      listHeader.textContent = "Invite";
      wrapper.appendChild(listHeader);

      const list = document.createElement("div");
      list.className = "group-finder-invite-list";
      if (invitable.length === 0) {
        const empty = document.createElement("div");
        empty.className = "bag-empty";
        empty.textContent = "No one else online";
        list.appendChild(empty);
      }
      for (const player of invitable) {
        const row = document.createElement("div");
        row.className = "bag-item";
        const name = document.createElement("div");
        name.className = "bag-item-name";
        name.textContent = player.name;
        row.appendChild(name);
        const button = document.createElement("button");
        button.textContent = "Invite";
        button.addEventListener("click", () => this.handlers?.onInvite(player.sessionId));
        row.appendChild(button);
        list.appendChild(row);
      }
      wrapper.appendChild(list);
    }
  }

  private renderBrowse(wrapper: HTMLElement) {
    const inParty = this.data.party.members.length > 0;

    if (inParty) {
      const note = document.createElement("div");
      note.className = "bag-empty";
      note.textContent = "Leave your current group to apply elsewhere.";
      wrapper.appendChild(note);
      return;
    }

    if (this.data.openParties.length === 0) {
      const empty = document.createElement("div");
      empty.className = "bag-empty";
      empty.textContent = "No groups are currently recruiting.";
      wrapper.appendChild(empty);
      return;
    }

    const list = document.createElement("div");
    list.className = "group-finder-browse-list";
    for (const openParty of this.data.openParties) {
      const row = document.createElement("div");
      row.className = "bag-item";
      const name = document.createElement("div");
      name.className = "bag-item-name";
      name.textContent = `${openParty.leaderName}'s Group`;
      const desc = document.createElement("div");
      desc.className = "bag-item-desc";
      desc.textContent = `${openParty.memberCount} member${openParty.memberCount === 1 ? "" : "s"}`;
      row.append(name, desc);

      const applied = this.data.myPendingApplications.has(openParty.partyId);
      const button = document.createElement("button");
      if (applied) {
        button.className = "group-finder-decline-btn";
        button.textContent = "Cancel";
        button.addEventListener("click", () => this.handlers?.onWithdrawApplication(openParty.partyId));
      } else {
        button.textContent = "Apply";
        button.addEventListener("click", () => this.handlers?.onApply(openParty.partyId));
      }
      row.appendChild(button);
      list.appendChild(row);
    }
    wrapper.appendChild(list);
  }
}

export const groupFinder = new GroupFinder();
