import { useMutation, useQueries, useQueryClient } from "@tanstack/react-query";
import type { MCPServer } from "@openhands/typescript-client";
import type { Backend } from "#/api/backend-registry/types";
import {
  McpFleetService,
  pushToBackends,
  removeFromBackends,
} from "#/api/mcp-service/mcp-fleet.api";
import { useActiveBackendContext } from "#/contexts/active-backend-context";
import type {
  ExtendedMCPTestResponse,
  MCPServerConfig,
} from "#/types/mcp-server";
import {
  buildFleetMatrix,
  type FleetColumn,
  type FleetRow,
} from "#/utils/mcp-fleet";
import { MCP_FLEET_QUERY_KEYS, SETTINGS_QUERY_KEYS } from "./query-keys";

// @spec PRJ-601 — All-servers MCP view (per-backend failure isolation)
export function useMcpFleet(): {
  columns: FleetColumn[];
  rows: FleetRow[];
  isLoading: boolean;
} {
  const { backends } = useActiveBackendContext();
  const localBackends = backends.filter((b) => b.kind === "local");

  const queries = useQueries({
    queries: localBackends.map((backend) => ({
      queryKey: MCP_FLEET_QUERY_KEYS.config(
        backend.id,
        backend.connectionRevision ?? 0,
      ),
      meta: { disableToast: true },
      queryFn: () => McpFleetService.getConfig(backend),
    })),
  });

  const columns: FleetColumn[] = localBackends.map((backend, i) => ({
    backend,
    // null covers both an unsettled fetch and a settled error — the row
    // builder already renders either as "unreachable".
    config: queries[i].data ?? null,
  }));

  return {
    columns,
    rows: buildFleetMatrix(columns),
    isLoading: queries.some((q) => q.isPending),
  };
}

function invalidateFleetQueries(
  queryClient: ReturnType<typeof useQueryClient>,
) {
  queryClient.invalidateQueries({ queryKey: MCP_FLEET_QUERY_KEYS.all });
  queryClient.invalidateQueries({ queryKey: SETTINGS_QUERY_KEYS.personal() });
}

// @spec PRJ-603 — Push an entry to servers
export function usePushMcpToBackends() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      targets,
      server,
    }: {
      targets: { backend: Backend; previous: MCPServer | undefined }[];
      server: MCPServerConfig;
    }) => pushToBackends(targets, server),
    onSettled: () => invalidateFleetQueries(queryClient),
  });
}

// @spec PRJ-604 — Remove an entry from servers
export function useRemoveMcpFromBackends() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ backends, key }: { backends: Backend[]; key: string }) =>
      removeFromBackends(backends, key),
    onSettled: () => invalidateFleetQueries(queryClient),
  });
}

// @spec PRJ-605 — On-demand test
export function useTestMcpOnBackend() {
  return useMutation({
    mutationFn: ({
      backend,
      key,
      stored,
    }: {
      backend: Backend;
      key: string;
      stored: MCPServer;
    }): Promise<ExtendedMCPTestResponse> =>
      McpFleetService.test(backend, key, stored),
  });
}
