# Centralized MCP Specs (Phase 6)

One place to see and manage the MCP servers configured on every registered
local agent-server. MCP is treated generically: there is no metamcp-specific
code; the user's metamcp is just one aggregating MCP entry among others.
Tracked as Phase 6 in [`projects-roadmap.md`](projects-roadmap.md).

## Facts this builds on

- Each agent-server stores its MCP servers in `agent_settings.mcp_config`, a
  name-keyed map (`MCPConfig`). Writes are sparse RFC 7386 merge patches
  (`SettingsService.patchMcpConfig`, `createMcpServer`, `patchMcpServer`,
  `deleteMcpServer`); sibling servers are preserved (MCP-001).
- `GET /api/settings` redacts secret leaves (`env`, `headers`, `auth`) to
  `REDACTED_MCP_SECRET_VALUE`. Exposed secrets are encrypted with **that**
  server's `OH_SECRET_KEY`, so a stored entry's credentials can never be
  copied to another server.
- A non-active backend is reached with
  `getAgentServerClientOptions({ host, apiKey })`, as `ProjectsService` and the
  phase-2 dashboard hooks do. Cloud backends are excluded from fan-out.

## Specs

### PRJ-601: All-servers MCP view
- [x] The MCP page shall show an "All servers" section when at least two local backends are registered; it is hidden otherwise and for cloud-only registries.
- [x] The section shall render a matrix: one row per MCP name found on any local backend (sorted by name), one column per local backend.
- [x] Each cell shall show one of: `present`, `disabled` (`enabled === false`), `missing`, `differs`, or `unreachable` (the whole column, when that backend's settings cannot be read).
- [x] Each backend's settings are read by its own query (keyed by backend id and `connectionRevision`); one backend failing shall not affect the others and shall not raise a global error toast (same isolation rule as PRJ-104).

### PRJ-602: Drift fingerprint
- [x] An entry's fingerprint shall consist only of non-secret fields: transport; `url` (remote) or `command` + `args` (stdio); the sorted key names of `env` and `headers`; `auth.strategy`. Secret values, `timeout`, `description`, `icon` and `enabled` are not part of it.
- [x] A row's present cells shall show `differs` when their fingerprints are not all equal; hovering or focusing the cell shall list which fingerprint fields differ from the most common fingerprint in that row (ties: the first backend in registry order).

### PRJ-603: Push an entry to servers
- [x] "Push to servers…" shall open the existing MCP server form (including secret fields) plus a checklist of local backends; reachable backends are checked by default, unreachable ones are unchecked and disabled.
- [x] Starting from an existing row shall prefill every non-secret field from the most common fingerprint's entry; secret fields start empty and must be re-entered.
- [x] Before sending, if any checked backend already has an entry with that name, a confirmation shall list those backends as "will be overwritten".
- [x] On confirm, each checked backend receives, independently, a create (name absent) or a full replace of that name (name present). Replacement shall not keep old fields: fields absent from the form are removed on that backend.
- [x] Secret values typed in the form shall be sent only in the per-backend write requests. They shall never be written to localStorage, `misc_settings`, logs, query caches or error toasts, and never read back from any backend.
- [x] After the run, each backend shall show `ok` or its error; there is no rollback. "Retry failed" shall resend the same form to the failed backends only, while the form is still open.
- [x] A row's "Push…" is disabled when its entry has an auth strategy the form cannot edit (e.g. `basic`) or raw top-level `headers`, so an untouched submit can never drop them; an oauth2 row push omits the server-held `state`, and the overwrite confirmation warns that overwritten OAuth entries must be re-authorized.
- [x] On completion the section's queries and the active backend's settings query shall be invalidated.

### PRJ-604: Remove an entry from servers
- [x] A row action shall delete that name from the checked backends that have it, after a confirmation listing them, with per-backend results as in PRJ-603.

### PRJ-605: On-demand test
- [x] Each `present`/`differs` cell shall offer "Test", which runs that backend's MCP test endpoint for the entry stored **on that backend** (redacted credentials substituted from that backend's encrypted settings, as `substituteRedactedMcpCredentials` does for the active backend) and shows ok/error and the tool count.
- [x] Tests run only on demand; the section shall not probe MCP servers automatically.

## Out of scope

- Different URLs, namespaces or keys per server or per project (edit on the server's own MCP page after pushing).
- Linking projects to MCP entries.
- Copying stored secrets between servers.
- Automatic or scheduled sync; conflict handling beyond "last push wins".
- Cloud backends.
