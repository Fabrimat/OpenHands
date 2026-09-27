/**
 * Centralized query keys and cache configuration for TanStack Query.
 * Using constants ensures type safety and prevents typos.
 */

import { SettingsScope } from "#/types/settings";

export const QUERY_KEYS = {
  /** Web client configuration from the server */
  WEB_CLIENT_CONFIG: ["web-client-config"] as const,
  /** Same-origin OpenHands app cookie authentication status */
  MAIN_APP_COOKIE_AUTH: ["main-app-cookie-auth"] as const,
} as const;

export const SETTINGS_QUERY_KEYS = {
  all: ["settings"] as const,
  byScope: (scope: SettingsScope) => ["settings", scope] as const,
  personal: () => ["settings", "personal"] as const,
} as const;

export const LLM_PROFILES_QUERY_KEYS = {
  all: ["llm-profiles"] as const,
} as const;

export const AGENT_PROFILES_QUERY_KEYS = {
  all: ["agent-profiles"] as const,
} as const;

export const PROVIDER_CONNECTIONS_QUERY_KEYS = {
  all: ["provider-connections"] as const,
} as const;

/** Fail fast when older backends lack the profile endpoint. */
export const AGENT_PROFILES_RETRY_OPTIONS = {
  retry: false,
} as const;

export const LLM_SUBSCRIPTION_QUERY_KEYS = {
  all: ["llm-subscription"] as const,
  openaiStatus: ["llm-subscription", "openai", "status"] as const,
  openaiModels: ["llm-subscription", "openai", "models"] as const,
} as const;

export const LOCAL_WORKSPACES_QUERY_KEYS = {
  all: ["local-workspaces"] as const,
} as const;

// @spec PRJ-001 — Projects persist on the primary server
export const PROJECTS_QUERY_KEYS = {
  all: ["projects"] as const,
  // Prefix shared by every `list(...)` key, so a save can invalidate just the
  // projects list without refetching every server's conversations/automations.
  lists: () => ["projects", "list"] as const,
  list: (primaryId: string, revision: number) =>
    ["projects", "list", primaryId, revision] as const,
  conversations: (backendId: string, revision: number) =>
    ["projects", "conversations", backendId, revision] as const,
  automations: (backendId: string, revision: number) =>
    ["projects", "automations", backendId, revision] as const,
  gitInfo: (backendId: string, path: string) =>
    ["projects", "git-info", backendId, path] as const,
} as const;

// @spec PRJ-201 — Supervisor settings persist on the primary server
export const SUPERVISOR_QUERY_KEYS = {
  all: ["supervisor"] as const,
  settings: (primaryId: string, revision: number) =>
    ["supervisor", "settings", primaryId, revision] as const,
  state: (backendId: string, revision: number) =>
    ["supervisor", "state", backendId, revision] as const,
} as const;

export const PLUGINS_QUERY_KEYS = {
  /** Dynamic marketplace catalog (used by `use-plugins-marketplace`). */
  marketplace: ["plugins-marketplace"] as const,
  /** Installed plugins from the local agent-server. */
  installed: ["plugins-installed"] as const,
  /** Locally-discovered ambient plugins (used by `use-local-plugins`). */
  local: ["plugins-local"] as const,
} as const;

// @spec PRJ-601 — All-servers MCP view
export const MCP_FLEET_QUERY_KEYS = {
  all: ["mcp-fleet"] as const,
  config: (backendId: string, revision: number) =>
    ["mcp-fleet", "config", backendId, revision] as const,
} as const;

export const CANVAS_EXTENSIONS_QUERY_KEYS = {
  all: ["canvas-extensions"] as const,
  installed: (
    backendId: string,
    orgId: string | null,
    connectionRevision: number,
  ) =>
    [
      "canvas-extensions",
      "installed",
      backendId,
      orgId,
      connectionRevision,
    ] as const,
} as const;

export const SETUP_QUERY_KEYS = {
  /** What the deployment supports. The same answer for every setup entry. */
  capabilities: () => ["setup-capabilities"] as const,
} as const;

export const APP_UPDATE_QUERY_KEYS = {
  /** Latest published @openhands/agent-canvas version (npm `latest` dist-tag). */
  latestVersion: ["agent-canvas-latest-version"] as const,
} as const;

export const CONVERSATION_QUERY_KEYS = {
  subConversations: ["v1", "sub-conversations"] as const,
} as const;

export const LOCAL_PLANNER_MUTATION_KEYS = {
  create: ["create-local-planning-conversation"] as const,
} as const;

/** Cache configuration shared across all config-related queries */
export const CONFIG_CACHE_OPTIONS = {
  staleTime: 1000 * 60 * 5, // 5 minutes
  gcTime: 1000 * 60 * 15, // 15 minutes
} as const;

export type QueryKeys = (typeof QUERY_KEYS)[keyof typeof QUERY_KEYS];
