import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { selectPrimaryBackend } from "#/api/backend-registry/active-store";
import type { Backend } from "#/api/backend-registry/types";
import { ProjectsService } from "#/api/projects-service/projects-service.api";
import { useActiveBackendContext } from "#/contexts/active-backend-context";
import type { Project } from "#/types/project";
import { PROJECTS_QUERY_KEYS } from "./query-keys";

// @spec PRJ-001 — Projects persist on the primary server
export function usePrimaryBackend(): Backend | null {
  const { backends } = useActiveBackendContext();
  return selectPrimaryBackend(backends);
}

export function useProjects() {
  const primary = usePrimaryBackend();
  const primaryId = primary?.id ?? "none";
  const revision = primary?.connectionRevision ?? 0;
  // eslint-disable-next-line @tanstack/query/exhaustive-deps
  return useQuery({
    queryKey: PROJECTS_QUERY_KEYS.list(primaryId, revision),
    queryFn: () => ProjectsService.getProjects(primary as Backend),
    enabled: primary !== null,
    meta: { disableToast: true },
  });
}

export function useSaveProjects() {
  const primary = usePrimaryBackend();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (projects: Project[]) => {
      if (!primary) throw new Error("No primary backend");
      await ProjectsService.saveProjects(primary, projects);
    },
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: PROJECTS_QUERY_KEYS.all }),
  });
}
