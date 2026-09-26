# Projects Roadmap

Goal: manage all projects, agents and sub-agents across the user's servers
(2 PCs + 2 VPS on Tailscale, self-hosted agent-servers), with agents keeping
every project monitored.

| Phase | Scope | Status |
|---|---|---|
| 1 | Projects: git-repo-based projects stored on the primary server, per-server locations, ClickUp link, cross-server detail view | Spec: [`projects.md`](projects.md) |
| 2 | Multi-server dashboard | Not designed |
| 3 | Supervisor agent | Not designed |
| 4 | Borg backups | Not designed |

## Phase 2: Multi-server dashboard

A single view of everything running across all registered servers.

- All active conversations and automations across every backend, grouped by project and by server; unassigned work in its own group.
- Server health (reusing `useBackendsHealth`) and agent status (running, waiting for confirmation, errored, idle).
- Built on the phase-1 hooks (per-backend fan-out, `matchesProjectLocation`).
- Open question: create conversations on a non-active backend without a full environment switch (requires per-backend conversation creation / websocket plumbing).

## Phase 3: Supervisor agent

An agent that checks the state of all projects on a schedule and reports.

- Runs as a scheduled automation on the primary server; reads project definitions from `misc_settings.projects`.
- Per project: git status/branch drift per location, stuck or errored conversations, failed automation runs, open ClickUp tasks (via ClickUp MCP); writes a report back to ClickUp.
- Cross-server access over Tailscale via each server's REST API.
- **Key custody (security review required before build):**
  - **Hub (default):** only the primary server stores the other servers' session API keys as secrets; the supervisor runs there. A compromised secondary server gains no access to others.
  - **Mesh (optional):** every server holds every key; resilient if the primary is down, but compromising any server compromises all four.
- Per-project agent/sub-agent assignment (agent profile, `enable_sub_agents`, ACP agent) so the supervisor can dispatch work, not only report.

## Phase 4: Borg backups

- Backup support via BorgBackup for the servers.
- Open questions: what is backed up (repo checkouts, `~/.openhands` state incl. settings/secrets/conversations, automation DB), where the Borg repository lives (one VPS vs. external), scheduling (automation vs. system cron), and restore UX.
- Secrets in `~/.openhands` are encrypted with `OH_SECRET_KEY`; backups must keep `secret-key.txt` handling explicit (never store it next to the data it protects unencrypted).

## Remaining items / ideas

- In-app rendering of ClickUp tasks per project (phase 1 only links).
- Project tags, archiving, custom ordering.
- Conflict handling beyond last-write-wins for concurrent project edits.
