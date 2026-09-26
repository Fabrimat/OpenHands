import { useQueries, useQuery } from "@tanstack/react-query";
import { ConversationSortOrder } from "@openhands/typescript-client";
import { ConversationClient } from "@openhands/typescript-client/clients";
import { RemoteWorkspace } from "@openhands/typescript-client/workspace/remote-workspace";
import { getAgentServerClientOptions } from "#/api/agent-server-client-options";
import AutomationService from "#/api/automation-service/automation-service.api";
import type { Backend } from "#/api/backend-registry/types";
import { useActiveBackendContext } from "#/contexts/active-backend-context";
import type { Automation } from "#/types/automation";
import type { Project, ProjectLocation } from "#/types/project";
import {
  matchesProjectLocation,
  matchesProjectRepository,
  resolveLocationBackend,
} from "#/utils/project-matching";
import {
  GIT_INFO_COMMAND,
  parseGitInfoOutput,
  type LocalGitInfo,
} from "./use-local-git-info";
import { PROJECTS_QUERY_KEYS } from "./query-keys";

// ponytail: only the newest N conversations per server are scanned; add
// server-side working-dir filtering or paging if projects outgrow it.
const CONVERSATION_SCAN_LIMIT = 100;

export interface ProjectConversation {
  id: string;
  title: string;
  updated_at: string | null;
  execution_status: string | null;
  backend: Backend;
}

export type ProjectAutomation = Automation & { backend: Backend };

export interface LocationResult<T> {
  location: ProjectLocation;
  backend: Backend | null;
  status: "unregistered" | "loading" | "error" | "success";
  data: T;
}

/** Raw search-result conversation item, as returned by `ConversationClient.searchConversations`. */
export interface ServerConversationItem {
  id: string;
  title?: string | null;
  updated_at?: string | null;
  execution_status?: string | null;
  workspace?: { working_dir?: string | null } | null;
}

function optionsFor(backend: Backend) {
  return getAgentServerClientOptions({
    host: backend.host,
    apiKey: backend.apiKey,
  });
}

function toStatus(
  backend: Backend | null,
  q: { isError: boolean; isSuccess: boolean },
): LocationResult<unknown>["status"] {
  if (!backend) return "unregistered";
  if (q.isError) return "error";
  return q.isSuccess ? "success" : "loading";
}

/** Shared per-server conversations query, reused by project hooks and the dashboard. */
export function serverConversationsQuery(backend: Backend) {
  // eslint-disable-next-line @tanstack/query/exhaustive-deps
  return {
    queryKey: PROJECTS_QUERY_KEYS.conversations(
      backend.id,
      backend.connectionRevision ?? 0,
    ),
    meta: { disableToast: true },
    // The client's `workspace` field is typed as `unknown`; narrow it to the
    // shape callers actually read (`working_dir`).
    queryFn: async () =>
      new ConversationClient(optionsFor(backend)).searchConversations({
        limit: CONVERSATION_SCAN_LIMIT,
        sort_order: ConversationSortOrder.UPDATED_AT_DESC,
      }) as unknown as { items: ServerConversationItem[] },
  };
}

/** Shared per-server automations query, reused by project hooks and the dashboard. */
export function serverAutomationsQuery(backend: Backend) {
  // eslint-disable-next-line @tanstack/query/exhaustive-deps
  return {
    queryKey: PROJECTS_QUERY_KEYS.automations(
      backend.id,
      backend.connectionRevision ?? 0,
    ),
    meta: { disableToast: true },
    queryFn: () => AutomationService.listAutomationsForBackend(backend),
  };
}

// @spec PRJ-006 — Project detail aggregates across servers
// @spec PRJ-007 — Per-server failure isolation
export function useProjectConversations(project: Project) {
  const { backends } = useActiveBackendContext();
  const resolved = project.locations.map((location) => ({
    location,
    backend: resolveLocationBackend(location, backends),
  }));

  const queries = useQueries({
    queries: resolved.map(({ location, backend }) => ({
      ...(backend
        ? serverConversationsQuery(backend)
        : {
            queryKey: PROJECTS_QUERY_KEYS.conversations(
              `unregistered:${location.host}`,
              0,
            ),
            meta: { disableToast: true },
            queryFn: async (): Promise<{ items: ServerConversationItem[] }> =>
              Promise.resolve({ items: [] }),
          }),
      enabled: backend !== null,
    })),
  });

  const locations: LocationResult<ProjectConversation[]>[] = resolved.map(
    ({ location, backend }, i) => {
      const q = queries[i];
      const items = q.data?.items ?? [];
      const data = backend
        ? items
            .filter((c) =>
              matchesProjectLocation(c.workspace?.working_dir, location.path),
            )
            .map((c) => ({
              id: c.id,
              title: c.title ?? c.id,
              updated_at: c.updated_at ?? null,
              execution_status: c.execution_status ?? null,
              backend,
            }))
        : [];
      return { location, backend, status: toStatus(backend, q), data };
    },
  );

  const conversations = locations
    .flatMap((l) => l.data)
    .sort((a, b) => (b.updated_at ?? "").localeCompare(a.updated_at ?? ""));

  return { locations, conversations };
}

export function useProjectAutomations(project: Project) {
  const { backends } = useActiveBackendContext();
  // One query per distinct backend: automations are matched by repo, not path.
  const uniqueBackends = [
    ...new Map(
      project.locations
        .map((l) => resolveLocationBackend(l, backends))
        .filter((b): b is Backend => b !== null)
        .map((b) => [b.id, b]),
    ).values(),
  ];

  const queries = useQueries({
    queries: uniqueBackends.map((backend) => serverAutomationsQuery(backend)),
  });

  const automations: ProjectAutomation[] = uniqueBackends.flatMap(
    (backend, i) =>
      (queries[i].data?.automations ?? [])
        .filter((a) => matchesProjectRepository(project.repo_url, a.repository))
        .map((a) => ({ ...a, backend })),
  );
  const failedBackendIds = uniqueBackends
    .filter((_, i) => queries[i].isError)
    .map((b) => b.id);

  return { automations, failedBackendIds };
}

export function useProjectGitInfo(
  location: ProjectLocation,
  backend: Backend | null,
) {
  // eslint-disable-next-line @tanstack/query/exhaustive-deps
  return useQuery<LocalGitInfo>({
    queryKey: PROJECTS_QUERY_KEYS.gitInfo(backend?.id ?? "none", location.path),
    enabled: backend !== null,
    meta: { disableToast: true },
    queryFn: async () => {
      const result = await new RemoteWorkspace({
        ...optionsFor(backend as Backend),
        workingDir: location.path,
      }).executeCommand(GIT_INFO_COMMAND, location.path, 10);
      return parseGitInfoOutput(result.stdout, result.exit_code);
    },
  });
}
