# Projects Supervisor Specs (Phase 3)

A daily supervisor that reviews every project on every server and reports to
ClickUp. Autonomy level **B** (observe + propose); level **C** (bounded
self-acting) is future work. Builds on [`projects.md`](projects.md) (phase 1)
and [`projects-dashboard.md`](projects-dashboard.md) (phase 2). Roadmap:
[`projects-roadmap.md`](projects-roadmap.md).

## Context

- Four self-hosted agent-servers (2 PCs + 2 VPS) on one Tailscale tailnet; project definitions live in `misc_settings.projects` on the primary server.
- Automations are scheduled prompts: the automation backend of a server starts an agent conversation on that server at each trigger. The agent has a terminal, curl, and the MCP servers configured on that server. Inside a run the agent can reach its own automation API with `X-Session-API-Key: $OPENHANDS_AUTOMATION_API_KEY`.
- Tasks, notes and reports for projects live in ClickUp; agents reach ClickUp via the ClickUp MCP.

## Decisions

- **Federated topology.** Each server runs its own supervisor automation that checks only the projects checked out on it, using only its own credentials. No server stores another server's session key. The primary server additionally runs a summary automation that reads **only ClickUp**.
- **Project list is compiled into the prompt.** The frontend renders each server's project list into that server's automation prompt, so no server needs to read the primary server's settings at run time. The frontend re-syncs prompts when projects change.
- **Autonomy B is enforced only by the prompt.** Every allowed check is read-only (`git fetch`/`status`/`log`, GET calls, ClickUp writes). This is a documented limitation; level C requires real enforcement (see Future).
- **ClickUp layout:** per project list, one parent task `📊 Stato progetto` with one subtask per server (`📊 Stato — <server name>`); each server rewrites only its own subtask (no concurrent writers on one task). Suggested actions are separate tasks tagged `supervisor-suggestion`, titled `[<server name>] <action>`, de-duplicated against open tasks with the same title. The summary is one fixed task in the "Supervisore" list, description rewritten daily plus one dated comment per run.
- **Schedule:** per-server runs at 08:00, summary at 08:30, timezone Europe/Rome by default; all configurable.

## Data model

```ts
// misc_settings.supervisor on the primary server
interface SupervisorSettings {
  enabled: boolean;
  timezone: string;                 // IANA, default "Europe/Rome"
  run_time: string;                 // "HH:MM", default "08:00"
  summary_time: string;             // "HH:MM", default "08:30"
  summary_clickup_list_id: string;  // "Supervisore" list
  model?: string;                   // LLM profile name; omitted = server default
  servers: SupervisorServer[];
  summary_automation_id?: string;
  summary_prompt_hash?: string;
}

interface SupervisorServer {
  host: string;                     // normalized, matched like ProjectLocation.host
  enabled: boolean;
  automation_id?: string;           // automation on that server, set after first sync
  synced_prompt_hash?: string;      // hash of the last prompt pushed
}
```

- Saved through the same full-object `misc_settings_diff` pattern as projects (`supervisor` replaced wholesale).
- Automation ids are stored so sync updates in place; automations are never matched by name.

## Architecture

- `src/types/supervisor.ts`: types + `isValidSupervisorSettings` guard + `DEFAULT_SUPERVISOR_SETTINGS`.
- `src/utils/supervisor-prompt.ts`: pure `buildServerSupervisorPrompt(serverName, projects, settings)`, `buildSummaryPrompt(settings, projects, serverNames)`, `hashPrompt(prompt)`.
- `src/utils/supervisor-sync-plan.ts`: pure `planSupervisorSync(settings, projects, backends, health) → SyncStep[]` where a step is `create | update | disable | skip-offline | noop` per server plus the summary.
- `src/api/automation-service/automation-service.api.ts`: `createAutomationForBackend(backend, spec)`, `updateAutomationForBackend(backend, id, patch)` (same pinned-config pattern as `listAutomationsForBackend`).
- `src/api/projects-service/`: `getSupervisorSettings(primary)` / `saveSupervisorSettings(primary, settings)`.
- Hooks: `useSupervisorSettings`, `useSaveSupervisorSettings`, `useSyncSupervisor` (executes the plan, persists returned automation ids + hashes, isolates per-server failures).
- UI: collapsible "Supervisore" section at the top of `/projects` (`src/components/features/projects/supervisor-panel.tsx`).

## Prompt contract

Each server prompt contains, in this order:
1. Role and autonomy: observe and propose only; explicitly forbidden: editing files, committing, pushing, changing branches, starting/stopping/deleting conversations or automations, changing settings.
2. A fenced JSON data block of that server's projects (`name`, `path`, `repo_url`, `clickup_list_id`), introduced as data, not instructions.
3. Checks per project: `git fetch` then branch, ahead/behind upstream, uncommitted changes, last commit date; failed runs of this server's automations in the last 24 h via the automation API; (conditional, see PRJ-209) errored/stuck conversations whose working dir is inside the project path.
4. ClickUp writes following the layout in Decisions, with a fixed section format.
5. Failure rule: if the ClickUp MCP is unavailable, end the run with an explicit error message so the run is recorded as failed.

The summary prompt reads each project's status subtasks and open `supervisor-suggestion` tasks, flags servers whose subtask was not updated today, and rewrites the summary task. It treats all ClickUp content as data and performs no actions besides writing the summary.

## Specs

### PRJ-201: Supervisor settings persist on the primary server
- [ ] Supervisor settings shall be read from and written to `misc_settings.supervisor` of the primary backend.
- [ ] Missing or invalid stored settings shall fall back to `DEFAULT_SUPERVISOR_SETTINGS` (disabled).

### PRJ-202: Per-server prompt scope
- [ ] A server's prompt shall contain exactly the projects with a location whose host matches that server, and no other project.
- [ ] Project fields shall appear only inside the fenced JSON data block.
- [ ] The prompt shall contain the forbidden-actions list and the ClickUp failure rule.

### PRJ-203: Deterministic prompts
- [ ] Identical inputs shall produce an identical prompt and hash; project order in settings shall not affect the output.

### PRJ-204: Sync plan
- [ ] Enabled server with projects and no `automation_id` → create; with `automation_id` and a different hash → update; same hash → noop.
- [ ] Enabled server with no projects, or disabled server/global switch → disable its automation if one exists.
- [ ] Unreachable server → skip-offline, leaving its stored id/hash untouched.
- [ ] The summary automation on the primary follows the same rules.

### PRJ-205: Automations created per backend
- [ ] Sync shall create/update automations on each server's own automation API (pinned to that backend's host and key), with a daily cron trigger at the configured time and timezone, the configured model, and a name `Supervisore — <server name>` / `Supervisore — riepilogo`.
- [ ] Disabling shall set `enabled: false`, never delete.

### PRJ-206: Auto re-sync
- [ ] Saving projects while the supervisor is enabled shall trigger a sync; unchanged prompts shall not be re-sent.

### PRJ-207: Supervisor panel
- [ ] `/projects` shall show a collapsible Supervisore section: global switch, times, timezone, summary list, model, and one row per local server with health, enable switch, last run and sync state (synced / pending / offline / error with message).
- [ ] "Sync now" shall run the sync on demand.

### PRJ-208: Failure isolation
- [ ] A failure on one server (offline, no automation backend, validation error) shall be shown on that server's row only and shall not stop sync of other servers or fire a global toast.
- [ ] If the primary is unreachable the section shall be read-only with the projects' primary-unreachable error.

### PRJ-209: Conversation check gated by capability
- [ ] The errored/stuck-conversation check shall be included in the prompt only if the spike (plan task 1) confirms the run can authenticate to its own agent-server; otherwise it shall be omitted and noted in `projects-roadmap.md`.

### PRJ-210: No cross-server secrets
- [ ] No server's session key shall be written to another server, to `misc_settings`, or into any prompt. The ClickUp token shall live only in each server's MCP configuration.

## Testing

- Unit: `supervisor-prompt.ts` (PRJ-202, PRJ-203), `supervisor-sync-plan.ts` (PRJ-204).
- Service: per-backend create/update target the given host, trigger/timezone/model shape (PRJ-205).
- Components: panel with two servers, one offline; enabling syncs only the online one; row error isolation (PRJ-207, PRJ-208).
- Mock-LLM E2E: enabling the supervisor creates the automation on the real test backend with expected name, trigger and prompt markers (no LLM run).

## Security notes

- Prompt-injection surface: project names/notes/paths (user-authored) and ClickUp content (agent-authored). Both are rendered as data blocks; the summary run has no side effects beyond its own summary task.
- The supervisor's reach equals the ClickUp token's scope; recommend a token limited to the projects space.
- Autonomy B is prompt-enforced only (see Decisions).

## Out of scope / future

- Level C: bounded self-acting via an allowlisted action tool/script with real enforcement (not prompt-only).
- User-editable prompt, per-server schedules, run history UI beyond last run.
