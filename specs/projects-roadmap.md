# Projects Roadmap

Goal: manage all projects, agents and sub-agents across the user's servers
(2 PCs + 2 VPS on Tailscale, self-hosted agent-servers), with agents keeping
every project monitored.

| Phase | Scope | Status |
|---|---|---|
| 1 | Projects: git-repo-based projects stored on the primary server, per-server locations, tracker link (ClickUp today), cross-server detail view | Spec: [`projects.md`](projects.md) |
| 2 | Multi-server dashboard | Spec: [`projects-dashboard.md`](projects-dashboard.md) |
| 3 | Supervisor agent (federated, autonomy B) | Spec: [`projects-supervisor.md`](projects-supervisor.md) |
| 4 | Borg backups | Not designed |
| 5 | Project file storage (S3-compatible, agent-facing) | Not designed |
| 6 | Centralized MCP management (generic; metamcp as endpoint) | Spec: [`projects-mcp.md`](projects-mcp.md) |
| 7 | Centralized memory via MCP (basic-memory through metamcp) | Not designed |

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

### Phase 3 spike results

Answers to the five questions in the "Spike" section of
[`projects-supervisor.md`](projects-supervisor.md), from hand-running the
spike runbook in `docs/SELF_HOSTING.md` → "Project supervisor" on one real
server. Unanswered until the spike is run (post-implementation user action,
not an agent task).

1. Does the run's terminal see the project path, and can `git -C <path> fetch` succeed non-interactively as that OS user? — _unanswered_
2. Is the ClickUp MCP callable inside an automation-created conversation (does the run inherit the server's MCP config)? — _unanswered_
3. Does a prompt automation need `finish` to reach COMPLETED, and does `finish(status: "failed")` show as failed in the UI? — _unanswered_
4. Does one POST to the prompt-create endpoint accept `trigger: { type: "cron", … }` + `enabled: true` directly? — _unanswered_
5. Does the ClickUp MCP sequence (find parent by name, update subtask, create/close suggestions) for one project fit well under the timeout? — _unanswered_

If Q2 or Q4 comes back "no", stop and revise `projects-supervisor.md` before enabling the supervisor on all servers.

## Phase 4: Borg backups

- Backup support via BorgBackup for the servers.
- Open questions: what is backed up (repo checkouts, `~/.openhands` state incl. settings/secrets/conversations, automation DB), where the Borg repository lives (one VPS vs. external), scheduling (automation vs. system cron), and restore UX.
- Secrets in `~/.openhands` are encrypted with `OH_SECRET_KEY`; backups must keep `secret-key.txt` handling explicit (never store it next to the data it protects unencrypted).

## Phase 5: Project file storage (S3-compatible)

Per-project file storage beyond the git repo, used mainly by agents (specs, inputs, generated outputs, assets).

- Backend: S3-compatible bucket (self-hosted MinIO on a VPS, or Backblaze B2 / Cloudflare R2), one prefix per project (e.g. `s3://projects/<project-id>/`).
- Agent access: mount on each server with `rclone mount` (agents see a local folder such as `/mnt/projects/<name>`, no MCP needed), or give agents `rclone`/`aws s3` CLI access with scoped credentials.
- Data model: optional `storage?: { provider: "s3"; bucket: string; prefix: string; mount_path?: string }` on `Project`; the mount path per server can live on `ProjectLocation`.
- App: show the storage location and mount status per server in project detail; optionally list files later.
- Credentials: per-project or per-server scoped keys stored as agent-server secrets, never in `misc_settings`.
- Include the bucket in Borg backups (phase 4), or rely on provider versioning.
- Open questions: MinIO self-hosted vs. managed provider; mount (rclone) vs. CLI-only access; how agents learn the path (e.g. injected into the conversation's system suffix, like `<RUNTIME_SERVICES>`).

## Phase 6: Centralized MCP (generic)

Configure MCP servers once, in one place, instead of on every agent-server. The canvas treats MCP generically — no metamcp-specific code; metamcp (what the user runs) is just an aggregating MCP endpoint like any other.

- Canvas: one view of the MCP servers configured on every registered agent-server (reusing the existing MCP page's data per backend), whether each responds, and which tools it exposes.
- Push the same MCP entry (e.g. the user's metamcp endpoint, with a per-server or per-project namespace) to all servers' MCP settings in one action; show drift where a server differs.
- Side benefit: one shared endpoint gives the supervisor's tracker MCP (spike Q2) the same config on all servers.
- Open questions: per-server vs. per-project MCP sets; credential custody for endpoint keys (agent-server secrets, never `misc_settings`); whether to read tool lists live or only on demand.

## Phase 7: Centralized memory (via MCP)

One memory store shared by every agent on every server. basic-memory is reached through metamcp like any other MCP (phase 6), so there is no basic-memory-specific integration in the agent path.

- Agents on any server read/write the same project knowledge through the shared MCP endpoint.
- Canvas: optionally a memory view per project (browse/search notes) by calling the memory MCP's tools, and a per-project pointer to its memory space on `Project`.
- Open questions: mapping canvas project ↔ memory project/folder; read-only vs. editable in the canvas; whether the supervisor also writes its daily status to memory.

## Remaining items / ideas

- In-app rendering of tracker tasks per project (phase 1 only links).
- More tracker providers (GitHub Issues / Linear / Plane) — see
  [`projects.md`](projects.md) → "Tracker providers" for how to add one.
- Project tags, archiving, custom ordering.
- Conflict handling beyond last-write-wins for concurrent project edits.
