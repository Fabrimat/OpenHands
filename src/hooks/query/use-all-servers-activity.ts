import { useQueries } from "@tanstack/react-query";
import type { Backend } from "#/api/backend-registry/types";
import { useActiveBackendContext } from "#/contexts/active-backend-context";
import type { ActivityConversation } from "#/utils/group-activity-by-project";
import {
  serverAutomationsQuery,
  serverConversationsQuery,
  type ProjectAutomation,
  type ServerConversationItem,
} from "./use-project-data";

export const DASHBOARD_REFETCH_INTERVAL_MS = 15_000;

export interface ServerActivity {
  backend: Backend;
  status: "loading" | "error" | "success";
  conversations: ActivityConversation[];
  automations: ProjectAutomation[];
}

// @spec PRJ-101, PRJ-104
export function useAllServersActivity(): {
  servers: ServerActivity[];
  conversations: ActivityConversation[];
  automations: ProjectAutomation[];
} {
  const { backends } = useActiveBackendContext();
  const localBackends = backends.filter((b) => b.kind === "local");

  const conversationQueries = useQueries({
    queries: localBackends.map((backend) => ({
      ...serverConversationsQuery(backend),
      refetchInterval: DASHBOARD_REFETCH_INTERVAL_MS,
    })),
  });
  const automationQueries = useQueries({
    queries: localBackends.map((backend) => ({
      ...serverAutomationsQuery(backend),
      refetchInterval: DASHBOARD_REFETCH_INTERVAL_MS,
    })),
  });

  const servers: ServerActivity[] = localBackends.map((backend, i) => {
    const conversationQuery = conversationQueries[i];
    const automationQuery = automationQueries[i];
    const items: ServerConversationItem[] = conversationQuery.data?.items ?? [];
    const conversations: ActivityConversation[] = items.map((item) => ({
      id: item.id,
      title: item.title ?? item.id,
      updated_at: item.updated_at ?? null,
      execution_status: item.execution_status ?? null,
      working_dir: item.workspace?.working_dir ?? null,
      backend,
    }));
    // Automation failure alone doesn't mark a server unreachable — the
    // automation backend may simply not be running on it.
    const automations: ProjectAutomation[] = (
      automationQuery.data?.automations ?? []
    ).map((automation) => ({ ...automation, backend }));

    let status: ServerActivity["status"] = "loading";
    if (conversationQuery.isError) status = "error";
    else if (conversationQuery.isSuccess) status = "success";

    return { backend, status, conversations, automations };
  });

  return {
    servers,
    conversations: servers.flatMap((s) => s.conversations),
    automations: servers.flatMap((s) => s.automations),
  };
}
