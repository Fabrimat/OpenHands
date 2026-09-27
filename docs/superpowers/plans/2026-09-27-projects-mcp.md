# Centralized MCP (Phase 6) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An "All servers" section on the MCP page that shows every local backend's MCP entries as a drift matrix, pushes one entry to many backends, removes an entry from many backends, and tests an entry on a given backend on demand.

**Architecture:** A pure module (`src/utils/mcp-fleet.ts`) builds the matrix, fingerprints and replacement patches. A backend-parameterized service (`src/api/mcp-service/mcp-fleet.api.ts`) reads, writes and tests on any local backend, using `getAgentServerClientOptions({ host, apiKey })` the same way `ProjectsService` does. Hooks fan out per backend with `useQueries`, following `useAllServersActivity`. The UI lives in `src/components/features/mcp-page/all-servers/` and is mounted in `src/routes/mcp.tsx`.

**Tech Stack:** React, TanStack Query v5, `@openhands/typescript-client` (`SettingsClient`, `MCPClient`), vitest + RTL, i18next.

**Spec:** `specs/projects-mcp.md` (PRJ-601…605).

## Global Constraints

- Repo rules: `AGENTS.md`.
  - All UI strings go through `t(I18nKey.…)`; add every key to `src/i18n/translation.json` in all 15 languages, then run `npm run make-i18n`.
  - No `react-router` imports in `src/components`.
  - Tag code and tests with `// @spec PRJ-60x — …`.
  - Tests mock services, never the hook under test.
  - No raw axios or fetch to the agent-server.
- Only local backends take part (`b.kind === "local"`); cloud backends are never read or written.
- Secret values from the push form go only into the per-backend write request. They are never persisted, logged, cached or toasted, and never read from any backend in plaintext.
- No new dependencies.
- Commits are unsigned (`git -c commit.gpgsign=false commit`), with no Co-Authored-By or AI trailer and no push.
- vitest on Windows: pass exact test paths and `--exclude '.claude/**' --pool=threads`.
- Never touch `.claude/`, `graphify-out/`, `src/graphify-out/`.

## Review Focus

1. **Overwrite across transports.** When the pushed entry is stdio and the target has a remote entry with the same key (or the reverse), the stale transport fields (`url`, `headers`, `auth`, or `command`, `args`, `env`) are removed in the **same** request. A delete followed by a create is not acceptable, because a failed create would lose the entry.
2. **Partial failure.** If one backend rejects the push, the other backends still get it, the failed one shows its error, and "Retry failed" resends only to the failed ones.
3. **Redacted leaks.** A push must never send `**********` as a value. If the form still holds the redacted placeholder, for example because it was prefilled from an existing row, submitting is blocked until the user fills in the secret.
4. **A backend that becomes unreachable.** Its column shows `unreachable`, its checklist box is disabled, and there is no global toast.
5. **Keys that differ only in normalization.** The row identity is the settings map key. The push key is `toMcpServerName(form.name)`, so pushing "My Server" targets the existing `my-server` key (or whatever `toMcpServerName` yields) rather than creating a duplicate.

---

### Task 1: Pure fleet model (`src/utils/mcp-fleet.ts`)

**Files:**
- Create: `src/utils/mcp-fleet.ts`
- Test: `__tests__/utils/mcp-fleet.test.ts`

**Interfaces:**
- Consumes: `MCPConfig`, `MCPServer`, `MCPServerPatch` from `@openhands/typescript-client`; `buildMcpServerPatch`, `toCanonicalMcpServer`, `REDACTED_MCP_SECRET_VALUE`, `hasRedactedMcpSecretLeaf` from `#/utils/mcp-config`; `Backend`.
- Produces:
  ```ts
  export type FleetCell =
    | { state: "present" | "disabled" | "differs"; server: MCPServer; diff: FingerprintField[] }
    | { state: "missing" }
    | { state: "unreachable" };
  export type FingerprintField = "transport" | "target" | "env_keys" | "header_keys" | "auth_strategy";
  export interface FleetColumn { backend: Backend; config: MCPConfig | null } // null = unreachable/loading error
  export interface FleetRow { key: string; cells: FleetCell[]; reference: MCPServer }
  export function mcpFingerprint(server: MCPServer): Record<FingerprintField, string>;
  export function buildFleetMatrix(columns: FleetColumn[]): FleetRow[];
  export function buildReplacementPatch(previous: MCPServer, edited: MCPServerConfig): MCPServerPatch;
  export function hasRedactedSecret(server: MCPServerConfig): boolean;
  ```

Rules:
- The fingerprint follows PRJ-602.
  - `target` is `url` for a remote entry, or `command` plus the args joined with a single space for stdio.
  - Key lists are sorted and joined with `,`.
  - `auth_strategy` is `auth?.strategy ?? ""`.
- The row reference is the most common fingerprint among the columns that have the key. A tie goes to the earliest column.
- Each cell compares itself with the reference.
  - If any field differs, the state is `differs` and `diff` lists those fields.
  - If nothing differs and `enabled === false`, the state is `disabled`.
  - Otherwise the state is `present`.
  - `diff` is empty unless the state is `differs`.
- Rows are sorted by key. A `null` config gives `unreachable` in every row of that column.
- `buildReplacementPatch` is `buildMcpServerPatch(previous, edited)` plus `null` for every top-level key of `previous` that `toCanonicalMcpServer(edited)` does not have. This covers a transport switch and dropped `description` or `timeout`.
- `hasRedactedSecret` checks `env`, `headers` and `auth` for `REDACTED_MCP_SECRET_VALUE`.

- [ ] **Step 1: Write the failing tests** (it.each where the shape repeats):
  - the same entry on 2 backends gives two `present` cells;
  - a different `url` on one backend gives that cell `differs` with `diff: ["target"]`;
  - three backends with fingerprints A, A, B give a reference of A, so only the B cell is `differs`;
  - a 1–1 tie goes to the first column;
  - an entry missing on one backend gives `missing`, and a `null` config gives `unreachable`;
  - `enabled: false` with an equal fingerprint gives `disabled`;
  - env values differ but the env keys are equal, so the cells are not `differs` (secrets are ignored);
  - rows come back sorted by key;
  - replacing a remote entry with header auth by a stdio entry produces a patch containing `transport: "stdio"`, `command`, and `url: null`, `headers: null`, `auth: null`;
  - `hasRedactedSecret` is true for `{ env: { K: "**********" } }` and false for fresh values.
- [ ] **Step 2: Run** `npx vitest run __tests__/utils/mcp-fleet.test.ts --exclude '.claude/**' --pool=threads` and expect it to FAIL.
- [ ] **Step 3: Implement** `src/utils/mcp-fleet.ts`.
- [ ] **Step 4: Rerun** and expect it to PASS. Also run `npm run typecheck`.
- [ ] **Step 5: Commit** `feat(mcp): fleet matrix, fingerprint and replacement patch`.

### Task 2: Per-backend service and hooks

**Files:**
- Create: `src/api/mcp-service/mcp-fleet.api.ts`
- Create: `src/hooks/query/use-mcp-fleet.ts`
- Modify: `src/hooks/query/query-keys.ts` to add `MCP_FLEET_QUERY_KEYS`
- Modify: `src/api/mcp-service/mcp-redacted-credentials.ts` to add an optional loader parameter, keeping the default behaviour
- Modify: `src/api/mcp-service/mcp-service.api.ts` to export a backend-parameterized test
- Test: `__tests__/api/mcp-fleet.api.test.ts`, `__tests__/hooks/query/use-mcp-fleet.test.tsx`

**Interfaces:**
- Consumes: Task 1 exports; `parseMcpConfig`, `toCanonicalMcpServer`, `toMcpServerName`; `SettingsClient`, `MCPClient`; `getAgentServerClientOptions`.
- Produces:
  ```ts
  // mcp-fleet.api.ts
  export const McpFleetService = {
    getConfig(backend: Backend): Promise<MCPConfig>,                 // parseMcpConfig(getSettings().agent_settings?.mcp_config)
    push(backend: Backend, server: MCPServerConfig, previous: MCPServer | undefined): Promise<void>,
    remove(backend: Backend, key: string): Promise<void>,
    test(backend: Backend, key: string, stored: MCPServer): Promise<ExtendedMCPTestResponse>,
  };
  export type PushResult = { backendId: string; ok: true } | { backendId: string; ok: false; error: string };
  export async function pushToBackends(targets: { backend: Backend; previous: MCPServer | undefined }[], server: MCPServerConfig): Promise<PushResult[]>;
  export async function removeFromBackends(backends: Backend[], key: string): Promise<PushResult[]>;
  // query-keys.ts
  export const MCP_FLEET_QUERY_KEYS = { all: ["mcp-fleet"] as const, config: (backendId: string, revision: number) => ["mcp-fleet", "config", backendId, revision] as const };
  // use-mcp-fleet.ts
  export function useMcpFleet(): { columns: FleetColumn[]; rows: FleetRow[]; isLoading: boolean };
  export function usePushMcpToBackends(): UseMutationResult<PushResult[], Error, { targets: …; server: MCPServerConfig }>;
  export function useRemoveMcpFromBackends(): UseMutationResult<PushResult[], Error, { backends: Backend[]; key: string }>;
  export function useTestMcpOnBackend(): UseMutationResult<ExtendedMCPTestResponse, Error, { backend: Backend; key: string; stored: MCPServer }>;
  ```

Rules:
- `push` refuses with an Error when `hasRedactedSecret(server)` is true.
  - The key is `toMcpServerName(server.name || server.type)`.
  - When `previous` is undefined, call `SettingsClient.createMcpServer(key, toCanonicalMcpServer(server))`.
  - Otherwise send one `updateSettings({ agent_settings_diff: { mcp_config: { [key]: buildReplacementPatch(previous, server) } } })`.
  - Use `withRetry` only if `settings-service.api.ts` exports it; otherwise call once.
- `pushToBackends` and `removeFromBackends` run all targets with `Promise.allSettled` and never throw.
  - An error message is `retrieveAxiosErrorMessage` or `err.message`, passed through `redactMcpSecrets(message, server)` so a typed token that the server echoes back never shows up.
- `test` converts `stored` into an `MCPServerConfig` exactly the way `flattenMcpConfig` does.
  - It substitutes redacted leaves from **that backend's** `getSettings({ exposeSecrets: "encrypted" })` by passing a loader to `substituteRedactedMcpCredentials`.
  - It calls `new MCPClient(optionsFor(backend)).testServer(request)`.
  - It goes through the same `finalizeMcpTestResponse` path, so extract a shared helper rather than duplicating it.
- `useMcpFleet` uses local backends from `useActiveBackendContext()` and one `useQueries` entry per backend, with `meta: { disableToast: true }` and no `refetchInterval`.
  - A column's config is `null` when that query errored.
  - `isLoading` is true while any query is pending.
- On settle, the push and remove mutations invalidate `MCP_FLEET_QUERY_KEYS.all` and `SETTINGS_QUERY_KEYS.personal()`.

- [ ] **Step 1: Failing tests.** Mock `@openhands/typescript-client/clients` (`SettingsClient`, `MCPClient`) as the existing `__tests__/api/*projects*` tests do.
  - `push` with no `previous` calls `createMcpServer` with the canonical server on that backend's host.
  - `push` with a `previous` sends one `updateSettings` holding the replacement patch.
  - `push` with a redacted env value rejects and sends nothing.
  - `pushToBackends` with one backend rejecting returns `[ok, {ok:false,error}]`, and the other backend was still called.
  - An error message that contains the typed token comes back redacted.
  - `test` substitutes from the target backend's encrypted settings (assert `getSettings` was called with `exposeSecrets: "encrypted"` on that host, and `testServer` received the stored ciphertext).
  - `useMcpFleet` with 2 local backends and 1 cloud backend gives 2 columns, and one backend erroring gives `config: null` with no toast.
- [ ] **Step 2: Run** the tests and expect FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the tests, `npm run typecheck` and `npx vitest run src/api/no-direct-agent-server-calls.test.ts __tests__/api/mcp-redacted-credentials* src/api/mcp-service --exclude '.claude/**' --pool=threads`. Expect PASS.
- [ ] **Step 5: Commit** `feat(mcp): per-backend MCP fleet service and hooks`.

### Task 3: "All servers" UI

**Files:**
- Create in `src/components/features/mcp-page/all-servers/`: `all-servers-section.tsx` (the matrix), `push-to-servers-modal.tsx`, `remove-from-servers-modal.tsx`
- Modify: `src/routes/mcp.tsx` to render `<AllServersSection />` above `McpToolbar` when there are at least 2 local backends
- Modify: `src/i18n/translation.json` (15 languages), then `npm run make-i18n`
- Modify: `tests/e2e/mock-llm/test-mapping.json` to map `src/components/features/mcp-page/**` and `src/utils/mcp-fleet.ts` to `mcp`, if they are not covered already
- Test: `__tests__/components/features/mcp-page/all-servers-section.test.tsx`

**Interfaces:**
- Consumes: Task 2 hooks; `MCPServerForm` (`mode="add"`, `onSubmit`, `onCancel`); the existing modal wrapper used by `CustomServerEditor` or `InstallServerModal` (reuse the same one); `useBackendsHealth` is optional, since the column status comes from `useMcpFleet`.

Behaviour (PRJ-601…605):
- The section has a heading, the "Push to servers…" button and a table. The header row holds the backend names; each body row is one key.
- Each cell shows a status label (`present`, `disabled`, `missing`, `differs`, `unreachable`) with `data-testid="mcp-fleet-cell-<key>-<backendId>"`.
  - A `differs` cell has a `title` and `aria-label` that list the translated names of the differing fields.
  - A `present`, `disabled` or `differs` cell has a "Test" button. The result appears inline in the cell: ok plus the tool count, or the error.
- Each row has "Push…" (it opens the modal prefilled with `toMcpServerConfig(row.reference)` and the secret values cleared to `""`) and "Remove…".
- Push modal:
  - It shows `MCPServerForm` plus a checklist of local backends. Reachable ones are checked, unreachable ones are disabled.
  - Submitting with a redacted secret shows the inline error.
  - When checked targets already have the key, a confirmation step lists them under "will be overwritten".
  - Then it runs the push and shows the result for each backend. "Retry failed" resends the retained form value to the failed ones only.
  - Closing the modal discards the form value, and no copy remains anywhere.
- Remove modal: a checklist limited to the backends that have the key, a confirmation, then the results for each backend.
- i18n keys use the `MCP$FLEET_…` prefix: title, description, push, remove, test, the five states, the five fingerprint field names, will-be-overwritten, results ok and failed, retry failed, secret-required.

- [ ] **Step 1: Failing tests** (RTL; mock `McpFleetService` and `SettingsClient` at the service level, not the hooks).
  - 1 local backend: the section is not rendered. 2 local backends: the matrix renders a `differs` cell with the field name in its `aria-label`.
  - Push a new entry to 2 servers: `McpFleetService.push` is called for both, and the results show ok.
  - Pushing a key that exists on one server shows that server in the overwrite confirmation, and nothing is sent before confirming.
  - One server fails, then "Retry failed" calls push only for it.
  - "Push…" from a row with a redacted env value and a submit without filling it in shows the secret-required error and calls push zero times.
  - "Test" on a cell calls `McpFleetService.test` for that backend and shows the tool count.
- [ ] **Step 2: Run** the tests and expect FAIL.
- [ ] **Step 3: Implement**, including i18n and `make-i18n`.
- [ ] **Step 4: Run** the new test, the existing MCP page tests (`__tests__/routes/mcp*`, and `__tests__/components/features/mcp-page/*` if present), `npm run typecheck`, `npm run lint` and `npm run check-translation-completeness`. Expect PASS.
- [ ] **Step 5: Commit** `feat(mcp): all-servers MCP section with push, remove and test`.

### Task 4: Docs and live check (controller)

- Tick PRJ-601…605 in `specs/projects-mcp.md`. In the roadmap, mark phase 6 as built. Add one paragraph to `docs/SELF_HOSTING.md` ("Centralized MCP": push the metamcp endpoint to all servers; secrets are re-entered and encrypted per server).
- Live check on vidar:
  - Start a second agent-canvas container on another port so there are two backends.
  - Register both, push an entry, check the drift display after editing it on one server, run the test, and remove it.
  - Stop the second container afterwards.
