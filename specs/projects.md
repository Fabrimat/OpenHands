# Projects Specs (Phase 1)

Design for grouping work across several self-hosted agent-servers by git
repository. Later phases (multi-server dashboard, supervisor agent, Borg
backups) live in [`projects-roadmap.md`](projects-roadmap.md).

## Context

- The user runs 4 self-hosted agent-servers (2 PCs + 2 VPS) on one Tailscale
  tailnet, all registered in the frontend backend registry. No OpenHands Cloud.
- Today the frontend has no "project" concept; conversations, workspaces and
  automations are scoped to the single active backend.
- Local conversations store `selected_repository` only in browser storage
  (`src/api/conversation-metadata-store.ts`), so it cannot identify a
  conversation's project from another browser. The server-reported
  `workspace.working_dir` can.
- Backend registry `id`s are generated per browser, so persisted data that
  must be shared across browsers cannot reference them.

## Decisions

- **Project = git repository**, plus optional ClickUp list link and notes.
  Agents read/write ClickUp tasks through the ClickUp MCP; the app only links.
- **Aggregation happens in the browser**: the frontend queries each relevant
  backend in parallel with typed `@openhands/typescript-client` clients built
  from `getAgentServerClientOptions({ host, apiKey })`. No new backend service
  and no SDK change.
- **Storage**: projects are persisted on one **primary** agent-server under
  `misc_settings.projects` (frontend-owned container, deep-merged PATCH).
- **Conversation membership** is derived from `working_dir`, not from browser
  metadata.

## Data model

```ts
// misc_settings.projects on the primary server
interface Project {
  id: string;            // uuid
  name: string;
  repo_url: string;      // normalized: no protocol, no trailing ".git", no trailing "/", lowercase host
  locations: ProjectLocation[];
  clickup?: { list_id: string; url: string };
  notes?: string;
}

interface ProjectLocation {
  host: string;          // normalized backend host, e.g. "http://vps1:8000" (no trailing slash)
  path: string;          // checkout dir on that server, POSIX or Windows
}
```

- `misc_settings_diff` replaces lists wholesale, so every save sends the full
  `projects` array. Concurrent edits from two browsers are last-write-wins
  (acceptable: single user).
- A location resolves to a registry backend by normalized-host equality
  (loopback-equivalent hosts count as equal, reusing the registry's existing
  loopback comparison). Unresolved locations render as "server not registered".

## Architecture

- `src/api/backend-registry/`: add optional `isPrimary?: boolean` to `Backend`
  (per browser; settable from Manage Backends). Resolver
  `getPrimaryBackend()`: the backend with `isPrimary`, else the first local
  backend.
- `src/api/projects-service/`: `ProjectsService.getProjects()` /
  `saveProjects(projects)` via `SettingsClient` with overrides pointing at the
  primary backend (never the active one).
- `src/utils/project-matching.ts`: pure helpers `normalizeRepoUrl()`,
  `normalizeHost()`, `matchesProjectLocation(workingDir, path)`.
- Hooks (`src/hooks/query/`), keys in `PROJECTS_QUERY_KEYS`
  (`query-keys.ts`):
  - `useProjects()`, `useSaveProjects()`
  - `useProjectConversations(project)`: `useQueries`, one per location
  - `useProjectAutomations(project)`: same, via automation service per backend
  - `useProjectGitInfo(location)`: branch/remote via `RemoteWorkspace`
- Routes (`src/routes.ts`): `projects` → `routes/projects-list.tsx`,
  `projects/:projectId` → `routes/project-detail.tsx`. Components under
  `src/components/features/projects/`. Sidebar entry "Projects" below
  Conversations.

## Specs

### PRJ-001: Projects persist on the primary server
- [ ] Projects shall be read from and written to `misc_settings.projects` of the primary backend, regardless of which backend is active.
- [ ] Each save shall send the full projects array through `misc_settings_diff`.

### PRJ-002: Primary backend selection
- [ ] The user shall be able to mark exactly one registered backend as primary from Manage Backends.
- [ ] When none is marked, the first local backend shall act as primary.

### PRJ-003: Project CRUD
- [ ] The user shall create a project with name, repo URL, one or more locations (server + folder via the folder browser), optional ClickUp link and notes.
- [ ] The user shall edit a project and delete it after a confirmation step.
- [ ] Repo URLs shall be stored normalized (PRJ-008).

### PRJ-004: Repo auto-detection
- [ ] When a location is added on a reachable server and the repo URL field is empty, the app shall prefill it from that checkout's git remote.

### PRJ-005: Projects list
- [ ] `/projects` shall list every project with name, repo, a health dot per location's server, and counts of conversations and automations.

### PRJ-006: Project detail aggregates across servers
- [ ] `/projects/:projectId` shall show, per location, server health, path and current branch.
- [ ] It shall list conversations from every location's server whose `working_dir` matches the location path, each with a server badge, newest first.
- [ ] It shall list automations whose working dir matches a location.

### PRJ-007: Per-server failure isolation
- [ ] An unreachable, unauthorized or CORS-blocked server shall show "server unreachable" in its own section only; other servers' data shall still render, and no global error toast shall fire per failing server.
- [ ] If the primary backend is unreachable, the projects list shall show an error naming the primary server with a Retry action; no local fallback store.

### PRJ-008: Path and repo matching
- [ ] `matchesProjectLocation` shall match a working dir equal to or nested under the path, normalizing `\`/`/` separators, trailing slashes, and (for Windows drive paths) case; `/srv/app` shall not match `/srv/app2`.
- [ ] `normalizeRepoUrl` shall treat `https://github.com/a/b.git`, `git@github.com:a/b.git` and `github.com/a/b/` as equal.

### PRJ-009: Cross-server actions
- [ ] "New conversation here" on a location on a non-active server shall switch the active backend to it (existing environment switch), then create the conversation with `workingDirOverride = path`.
- [ ] Opening a conversation from another server shall switch backend before navigating.

### PRJ-010: Mock and i18n coverage
- [ ] `dev:mock` MSW handlers shall serve `misc_settings.projects`.
- [ ] All copy shall use `PROJECTS$*` i18n keys in all supported languages.

## Testing

- Unit: `project-matching.ts` (PRJ-008).
- Service: `ProjectsService` targets primary host and sends full array (mock the client, not hooks) (PRJ-001).
- Components: list + create flow; detail with two servers where one fails (PRJ-006, PRJ-007); delete confirmation (PRJ-003).
- Mock-LLM E2E: new `tests/e2e/mock-llm/projects/` spec (create project → start conversation in path → see it in detail); add mapping in `test-mapping.json`.

## Out of scope (phase 1)

- Global all-projects dashboard (phase 2).
- Rendering ClickUp tasks in the app (link only).
- Creating conversations on a non-active backend without switching.
- Tags, archiving, custom ordering.

## Operational note: CORS

Remote agent-servers must allow the origin the frontend is served from, or
browser fan-out fails (surfaces as PRJ-007 "unreachable"). Document the
agent-server CORS setting in `docs/backend-management.md` as part of phase 1.
