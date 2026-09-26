# Multi-Server Dashboard Specs (Phase 2)

A single view aggregating every registered local server's health and agent
activity, grouped by project. Builds on [`projects.md`](projects.md) (project
data model, matching helpers, per-server failure isolation) and is tracked as
Phase 2 in [`projects-roadmap.md`](projects-roadmap.md).

## Specs

### PRJ-101: Dashboard aggregates all servers
- [x] `/dashboard` shall list every registered local backend with its health, active-agent count and enabled-automation count.

### PRJ-102: Activity grouped by project
- [x] Each conversation shall be assigned to the first project with a location whose host matches its server and whose path contains its `working_dir`; conversations matching no project's locations go to "Unassigned".
- [x] Enabled automations shall be grouped by repository match against a project's `repo_url`; automations matching no project go to "Unassigned". Disabled automations are excluded.

### PRJ-103: Active filter
- [x] By default only conversations with `execution_status` in `running`, `waiting_for_confirmation`, `error`, `stuck` shall be shown.
- [x] A toggle shall reveal all recent conversations regardless of status. The filter does not affect which automations are shown.

### PRJ-104: Auto-refresh and isolation
- [x] Dashboard data shall auto-refresh every 15 seconds.
- [x] An unreachable server shall show "unreachable" on its own row only; other servers shall continue to render their data; no global error toast shall fire for a per-server failure.

### PRJ-105: Cross-server navigation
- [x] Opening a conversation from another server shall switch the active backend first (the same helper used for PRJ-009), before navigating to it.

## Out of scope (Phase 2 / Part A)

- Stopping/pausing agents from the dashboard.
- History/charts.
- Notifications.
