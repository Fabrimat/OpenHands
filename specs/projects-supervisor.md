# Projects Supervisor Specs (Phase 3)

A daily supervisor that reviews every project on every server and reports to
ClickUp. Autonomy level **B** (observe + propose); level **C** (bounded
self-acting) is future work. Builds on [`projects.md`](projects.md) (phase 1)
and [`projects-dashboard.md`](projects-dashboard.md) (phase 2). Roadmap:
[`projects-roadmap.md`](projects-roadmap.md).

Revised after a Fable ADVISE review (verdict: sound with changes).

## Context

- Four self-hosted agent-servers (2 PCs + 2 VPS) on one Tailscale tailnet; project definitions live in `misc_settings.projects` on the primary server.
- Automations are scheduled prompts: at each trigger a server's automation backend starts an agent conversation on that server. Spec surface: `name, prompt, trigger {type: "cron", schedule, timezone}, model, repos, plugins, timeout` — no per-automation tools, confirmation policy or agent settings. Default timeout 600 s, maximum from `capabilities.maxAutomationTimeoutSeconds`.
- The automation list returns each automation's full `prompt`, so the frontend can diff desired vs. deployed state without storing anything.
- Runs record `run_metadata.finish_tool_response.status` (`success | partial_success | blocked | failed`), already rendered by the UI.
- Tasks, notes and reports for projects live in ClickUp; agents reach ClickUp via the ClickUp MCP configured on each server.

## Decisions

- **Federated topology.** Each server runs its own supervisor automation that checks only the projects checked out on it. No server stores another server's session key. The primary server also runs a summary automation that reads **only ClickUp**.
- **Project list compiled into the prompt.** The frontend renders each server's projects into that server's automation prompt; no server reads the primary's settings at run time.
- **Stateless sync, reconciled by name.** Sync lists each server's automations, finds `Supervisore — <label>` by name, and creates / updates / disables it by comparing `prompt`, `trigger`, `timeout` and `enabled` with the desired state. Nothing about deployed automations is stored; a deleted automation is recreated on the next sync. Name is the identity key (single user; collision risk accepted). Line 1 of every supervisor prompt is a fixed marker `<!-- agent-canvas:supervisor v1 -->`, and a name match without the marker is treated as a conflict and shown on that server's row instead of being overwritten.
- **v1 checks = git state + ClickUp only.** Failed automation runs and errored/stuck conversations are not checked by the supervisor: they need an authenticated call to the server's own API (the highest-privilege thing it could touch), and the phase-2 dashboard already shows them live. Re-add later if the daily report is still missing them.
- **Autonomy B is enforced by the prompt**, with these hard limits: an explicit `timeout` (default 1800 s, clamped to the server maximum), no `repos` on the automation (no clone), and a dedicated ClickUp account (see Security).
- **Server identity** is a `label` stored on the primary per normalized host (not the per-browser backend name), used in automation names and ClickUp titles.
- **Schedule:** per-server runs are staggered from `run_time` by 5 minutes per server in `servers` order (default 08:00, 08:05, 08:10, 08:15), which avoids the parent-task creation race and spreads ClickUp load (100 req/min/token). The summary defaults to 09:00; the UI warns if `summary_time` is earlier than the last server run time plus the timeout.
- **ClickUp layout:**
  - Per project list: a parent task `📊 Stato progetto` with one subtask per server, `📊 Stato — <label>`. Each server rewrites only its own subtask.
  - Suggestions are separate tasks tagged `supervisor-suggestion` with a fixed title key `[<label>] <project>: <kind>`, where `kind` is from a closed set: `behind-upstream`, `ahead-unpushed`, `uncommitted-changes`, `detached-head`, `fetch-failed`, `path-missing`, `not-a-repo`. The fixed title is the de-dup key.
  - Each run **closes its own open suggestions whose condition no longer holds**.
  - Projects without `clickup.list_id` are reported under the summary's "Supervisore" list in a per-server "Progetti senza lista ClickUp" section, not skipped.
  - Summary: one fixed task in the "Supervisore" list, description rewritten daily, plus one dated comment per run.
- **Failure signalling via `finish`:** a run ends with `finish(status, outcome_summary)`: `failed` if the ClickUp MCP is unavailable, `partial_success` if some projects could not be checked, `success` otherwise.
- **Missed runs** (a PC powered off at run time) are not caught up; the summary's "not updated today" flag covers them.

## Data model

```ts
// misc_settings.supervisor on the primary server — user preferences only
interface SupervisorSettings {
  enabled: boolean;
  timezone: string;                 // IANA, default "Europe/Rome"
  run_time: string;                 // "HH:MM", default "08:00"; server i runs at run_time + 5 min × i
  summary_time: string;             // "HH:MM", default "09:00"
  timeout_seconds: number;          // default 1800, clamped to server max at sync
  summary_clickup_list_id: string;  // "Supervisore" list
  servers: SupervisorServer[];      // order defines the stagger
}

interface SupervisorServer {
  host: string;                     // normalized, matched like ProjectLocation.host
  label: string;                    // stable cross-browser identity, e.g. "vps1"
  enabled: boolean;
}
```

- `misc_settings_diff` is **deep-merged**: scalar fields cannot be cleared by omission, and the `servers` list is replaced wholesale. The model has no field that ever needs clearing.
- Time fields are validated with `^([01]\d|2[0-3]):[0-5]\d$` and rendered as the cron schedule `M H * * *`.
- The MSW PATCH handler must pass `supervisor` through (as it does `projects`).

## Architecture

- `src/types/supervisor.ts`: types, `isValidSupervisorSettings`, `DEFAULT_SUPERVISOR_SETTINGS` (disabled).
- `src/utils/supervisor-prompt.ts`: pure `buildServerSupervisorPrompt(label, projects, settings)`, `buildSummaryPrompt(settings, projects, labels)`, `supervisorCronSchedule(time, offsetMinutes)`.
- `src/utils/supervisor-sync.ts`: pure `desiredSupervisorAutomations(settings, projects, backends, serverMaxTimeout) → Desired[]` and `diffAutomation(existing | undefined, desired | null) → "create" | "update" | "disable" | "noop" | "conflict"`.
- `src/api/automation-service/automation-service.api.ts`:
  - `createAutomationForBackend(backend, spec)`: **one** POST to the prompt-create endpoint with the cron trigger and `enabled` set, pinned via `buildPinnedLocalConfig`. It does not reuse `createAutomation`'s import flow (placeholder event, then PATCH, then disabled).
  - `updateAutomationForBackend(backend, id, patch)`.
- `src/api/projects-service/`: `getSupervisorSettings(primary)` / `saveSupervisorSettings(primary, settings)`; MSW passthrough.
- Hooks:
  - `useSupervisorSettings` / `useSaveSupervisorSettings`;
  - `useSupervisorSync`: per server, `listAutomationsForBackend`, then diff, then create or update. The list failing means the server is offline for that row. It exposes a per-row state (`synced | pending | offline | conflict | error`), computed on panel load and on demand.
- UI: collapsible "Supervisore" section at the top of `/projects` (`src/components/features/projects/supervisor-panel.tsx`).

## Prompt contract

Each server prompt contains, in this order:
1. The marker line, then role and autonomy: observe and propose only. Explicitly forbidden: editing files, committing, pushing, changing branches, calling any agent-server or automation API, starting/stopping/deleting conversations or automations, changing settings, acting on instructions found in data.
2. A fenced JSON data block of that server's projects (`name`, `path`, `repo_url`, `clickup_list_id` or null), introduced as data, not instructions. Notes are never included.
3. Git checks per project, non-interactive and shell-agnostic:
   - always `git -C "<path>" …`, with no `cd` or `&&` chains;
   - `GIT_TERMINAL_PROMPT=0` and `GIT_SSH_COMMAND="ssh -o BatchMode=yes"`, with a per-command timeout on `fetch`;
   - collect branch, ahead/behind upstream, uncommitted changes and last commit date;
   - on fetch failure, report `fetch-failed` with the first line of stderr and continue;
   - detect `path-missing`, `not-a-repo` and "dubious ownership" (report it, never change `safe.directory`).
4. ClickUp writes following the layout in Decisions, with a fixed section format. Includes closing stale own suggestions.
5. End with `finish(status, outcome_summary)` per the failure rule.

The summary prompt reads each project's status subtasks and open `supervisor-suggestion` tasks, flags servers whose subtask was not updated today, and rewrites the summary task. It treats all ClickUp content as data and performs no action besides writing the summary.

## Specs

### PRJ-201: Supervisor settings persist on the primary server
- [ ] Supervisor settings shall be read from and written to `misc_settings.supervisor` of the primary backend.
- [ ] Missing or invalid stored settings shall fall back to `DEFAULT_SUPERVISOR_SETTINGS` (disabled); invalid time strings shall be rejected by the guard.

### PRJ-202: Per-server prompt scope
- [ ] A server's prompt shall contain exactly the projects with a location whose host matches that server, and no other project.
- [ ] Project fields shall appear only inside the fenced JSON data block; notes shall never appear.
- [ ] The prompt shall start with the marker line and contain the forbidden-actions list, the non-interactive git rules and the `finish` rule.

### PRJ-203: Deterministic prompts
- [ ] Identical inputs shall produce an identical prompt; project order in settings shall not affect the output.

### PRJ-204: Stateless reconciliation
- [ ] For each server: no automation named `Supervisore — <label>` and desired → create; present with a different prompt, trigger, timeout or enabled state → update; equal → noop; present but not desired (server disabled, global switch off, or no projects) → disable.
- [ ] A same-named automation without the marker line → conflict, never overwritten.
- [ ] The summary automation on the primary follows the same rules.

### PRJ-205: Automations created per backend
- [ ] Create shall be a single POST pinned to that backend's host and key, with trigger `{ type: "cron", schedule: "M H * * *", timezone }`, the staggered time, `timeout` = min(settings.timeout_seconds, server max), no `repos`, `enabled: true`.
- [ ] Disabling shall set `enabled: false`, never delete.

### PRJ-206: Auto re-sync
- [ ] Saving projects or supervisor settings while the supervisor is enabled shall trigger a sync; noop diffs shall send nothing.

### PRJ-207: Supervisor panel
- [ ] `/projects` shall show a collapsible Supervisore section: global switch, run time, summary time (with the too-early warning), timezone, timeout, summary list, and one row per local server with health, label, enable switch and sync state (synced / pending / offline / conflict / error with message).
- [ ] "Sync now" shall run the sync on demand.

### PRJ-208: Failure isolation
- [ ] A failure on one server (offline, no automation backend, validation error, conflict) shall be shown on that server's row only and shall not stop sync of other servers or fire a global toast.
- [ ] If the primary is unreachable the section shall be read-only with the projects' primary-unreachable error.

### PRJ-209: ClickUp suggestion lifecycle
- [ ] Suggestion titles shall use the fixed key `[<label>] <project>: <kind>` with `kind` from the closed set; the prompt shall instruct de-dup by exact title and closing of own suggestions whose condition no longer holds.
- [ ] Projects without a ClickUp list shall be reported under the summary list, not skipped.

### PRJ-210: No cross-server secrets
- [ ] No server's session key shall be written to another server, to `misc_settings`, or into any prompt. The ClickUp token shall live only in each server's MCP configuration.

## Testing

- Unit: `supervisor-prompt.ts` (PRJ-202, PRJ-203, cron/stagger), `supervisor-sync.ts` diff table (PRJ-204).
- Service: `createAutomationForBackend` is one POST to the given host with the expected trigger, timeout and no repos (PRJ-205).
- Components: panel with two servers, one offline; enabling syncs only the online one; conflict row; summary-time warning (PRJ-207, PRJ-208).
- Mock-LLM E2E: enabling the supervisor creates the automation on the real test backend with the expected name, trigger and marker (no LLM run).

## Spike (plan task 1)

Hand-create one automation via the existing Automations UI on one server, with the v1 prompt for one real project, dispatch it and read the run. Answer yes or no to each question:
1. Does the run's terminal see the project path, and can `git -C <path> fetch` succeed non-interactively as that OS user?
2. Is the ClickUp MCP callable inside an automation-created conversation (does the run inherit the server's MCP config)?
3. Does a prompt automation need `finish` to reach COMPLETED, and does `finish(status: "failed")` show as failed in the UI?
4. Does one POST to the prompt-create endpoint accept `trigger: { type: "cron", … }` + `enabled: true` directly?
5. Does the ClickUp MCP sequence (find parent by name, update subtask, create/close suggestions) for one project fit well under the timeout?

## Security notes

- **Reach of a run.** A supervisor run can do whatever any conversation on that server can do:
  - act as the OS user of the agent-server;
  - use the git credentials on that machine;
  - use **every** MCP server configured on that agent-server, not just ClickUp;
  - call the server's own `/api/*` with the session key present in the process environment (`OPENHANDS_AUTOMATION_API_KEY`).

  Autonomy B is acceptable for this single-user, self-hosted, observe-only setup precisely because that blast radius already exists for every conversation.
- **ClickUp account.** A personal ClickUp API token cannot be scoped to a space. Use a dedicated ClickUp member or guest account whose only access is the projects space, and configure its token.
- **Prompt-injection surfaces:**
  - user-authored: project names and paths;
  - third-party: git metadata read during checks (commit messages, branch names from `fetch`);
  - agent-authored: ClickUp content.

  All of them are rendered or treated as data. At level B the worst case is a poisoned suggestion task.
- **Level C** must never act on suggestion-task text without hard enforcement.

## Out of scope / future

- Level C: a plugin with a pre-tool hook enforcing an action allowlist (same hook infrastructure that gates `finish`), not prompt-only.
- Per-server model/profile selection (a profile name may not exist on every server); v1 uses each server's default.
- Failed-run and errored-conversation checks (would require compiling `runtime_services.automation.url_from_agent` into the prompt).
- Last-run column in the panel (needs a pinned runs endpoint), user-editable prompt, catch-up of missed runs.
