import {
  useMutation,
  useQueries,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import AutomationService from "#/api/automation-service/automation-service.api";
import type { Backend } from "#/api/backend-registry/types";
import { ProjectsService } from "#/api/projects-service/projects-service.api";
import { useActiveBackendContext } from "#/contexts/active-backend-context";
import type { Automation } from "#/types/automation";
import type { SupervisorSettings } from "#/types/supervisor";
import { getApiErrorMessage } from "#/utils/api-error-message";
import {
  SUMMARY_AUTOMATION_NAME,
  SUPERVISOR_MARKER,
  supervisorAutomationName,
} from "#/utils/supervisor-prompt";
import {
  buildSupervisorTargets,
  diffAutomation,
  SUMMARY_TARGET_KEY,
  type ServerTarget,
  type SyncAction,
} from "#/utils/supervisor-sync";
import { SUPERVISOR_QUERY_KEYS } from "./query-keys";
import { usePrimaryBackend, useProjects } from "./use-projects";

export type RowState =
  | "synced"
  | "pending"
  | "offline"
  | "conflict"
  | "unregistered"
  | "error";

export interface SupervisorRow {
  target: ServerTarget;
  state: RowState;
  action: SyncAction | null;
  error: string | null;
}

// @spec PRJ-201 — Supervisor settings persist on the primary server
export function useSupervisorSettings() {
  const primary = usePrimaryBackend();
  // eslint-disable-next-line @tanstack/query/exhaustive-deps
  return useQuery({
    queryKey: SUPERVISOR_QUERY_KEYS.settings(
      primary?.id ?? "none",
      primary?.connectionRevision ?? 0,
    ),
    queryFn: () => ProjectsService.getSupervisorSettings(primary as Backend),
    enabled: primary !== null,
    meta: { disableToast: true },
  });
}

export function useSaveSupervisorSettings() {
  const primary = usePrimaryBackend();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (settings: SupervisorSettings) => {
      if (!primary) throw new Error("No primary backend");
      await ProjectsService.saveSupervisorSettings(primary, settings);
    },
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: SUPERVISOR_QUERY_KEYS.all }),
  });
}

function useTargets(): ServerTarget[] {
  const { backends } = useActiveBackendContext();
  const primary = usePrimaryBackend();
  const settings = useSupervisorSettings().data;
  const projects = useProjects().data;
  if (!settings || !projects) return [];
  return buildSupervisorTargets(settings, projects, backends, primary);
}

const findByName = (automations: Automation[], name: string | undefined) =>
  name ? automations.find((a) => a.name === name) : undefined;

// Name even when desired is null, so a now-unwanted automation can still be
// found and disabled.
function nameOf(t: ServerTarget): string {
  return t.key === SUMMARY_TARGET_KEY
    ? SUMMARY_AUTOMATION_NAME
    : supervisorAutomationName(t.label);
}

function errorMessage(e: unknown): string {
  return getApiErrorMessage(e, e instanceof Error ? e.message : String(e));
}

// @spec PRJ-207 — Row sync state
export function useSupervisorRows(): SupervisorRow[] {
  const targets = useTargets();
  const queries = useQueries({
    queries: targets.map((t) => ({
      queryKey: SUPERVISOR_QUERY_KEYS.state(
        t.backend?.id ?? `none:${t.key}`,
        t.backend?.connectionRevision ?? 0,
      ),
      enabled: t.backend !== null,
      meta: { disableToast: true },
      queryFn: () =>
        AutomationService.listAutomationsForBackend(t.backend as Backend),
    })),
  });
  return targets.map((target, i) => {
    const q = queries[i];
    if (!target.backend) {
      return { target, state: "unregistered", action: null, error: null };
    }
    if (q.isError) {
      return {
        target,
        state: "offline",
        action: null,
        error: errorMessage(q.error),
      };
    }
    if (!q.data) return { target, state: "pending", action: null, error: null };
    const action = diffAutomation(
      findByName(q.data.automations, nameOf(target)),
      target.desired,
    );
    const state: RowState =
      action === "noop"
        ? "synced"
        : action === "conflict"
          ? "conflict"
          : "pending";
    return { target, state, action, error: null };
  });
}

// A server label rename leaves the old `Supervisore — <oldlabel>` automation
// enabled and untouched by name-based reconciliation (it doesn't match the
// new desired name, so diffAutomation never sees it). Sweep every marked
// supervisor automation on the server that doesn't match the current desired
// name (or the summary name, which shares the same server) and disable it.
const SUPERVISOR_NAME_PREFIX = supervisorAutomationName("");

async function disableRenamedAutomations(
  backend: Backend,
  listed: Automation[],
  desiredName: string,
): Promise<void> {
  const stale = listed.filter(
    (a) =>
      a.enabled &&
      a.name !== desiredName &&
      a.name !== SUMMARY_AUTOMATION_NAME &&
      a.name.startsWith(SUPERVISOR_NAME_PREFIX) &&
      a.prompt?.startsWith(SUPERVISOR_MARKER),
  );
  await Promise.all(
    stale.map((a) =>
      AutomationService.updateAutomationForBackend(backend, a.id, {
        enabled: false,
      }),
    ),
  );
}

// A concurrent sync (two "Sync now" clicks, or a manual click racing an
// auto re-sync from a project/settings save) can each see no automation
// named `desiredName` yet and both create one, leaving a permanent
// duplicate. After reconciling, disable every *other* enabled, marker-carrying
// automation on this server sharing the exact desired name — keeping only
// the one this run just reconciled (`keepId`, undefined when this run
// itself created the automation, since a fresh create can't already be a
// duplicate of anything in the pre-create `listed` snapshot).
async function disableDuplicateAutomations(
  backend: Backend,
  listed: Automation[],
  desiredName: string,
  keepId: string | undefined,
): Promise<void> {
  const duplicates = listed.filter(
    (a) =>
      a.enabled &&
      a.id !== keepId &&
      a.name === desiredName &&
      a.prompt?.startsWith(SUPERVISOR_MARKER),
  );
  await Promise.all(
    duplicates.map((a) =>
      AutomationService.updateAutomationForBackend(backend, a.id, {
        enabled: false,
      }),
    ),
  );
}

// Extracted so `useSupervisorSync` can run it against freshly-fetched
// settings/projects (see below) instead of the render-time query cache.
async function runSupervisorSync(
  targets: ServerTarget[],
): Promise<SupervisorRow[]> {
  const rows: SupervisorRow[] = [];
  for (const target of targets) {
    if (!target.backend) {
      rows.push({ target, state: "unregistered", action: null, error: null });
      continue;
    }
    let listed: Automation[];
    try {
      listed = (
        await AutomationService.listAutomationsForBackend(target.backend)
      ).automations;
    } catch (e) {
      rows.push({
        target,
        state: "offline",
        action: null,
        error: errorMessage(e),
      });

      continue;
    }
    const existing = findByName(listed, nameOf(target));
    const action = diffAutomation(existing, target.desired);
    try {
      if (action === "create") {
        await AutomationService.createAutomationForBackend(
          target.backend,
          target.desired!,
        );
      }
      if (action === "update") {
        await AutomationService.updateAutomationForBackend(
          target.backend,
          existing!.id,
          target.desired!,
        );
      }
      if (action === "disable") {
        await AutomationService.updateAutomationForBackend(
          target.backend,
          existing!.id,
          {
            enabled: false,
          },
        );
      }
      await disableDuplicateAutomations(
        target.backend,
        listed,
        nameOf(target),
        existing?.id,
      );
      if (target.key !== SUMMARY_TARGET_KEY) {
        await disableRenamedAutomations(target.backend, listed, nameOf(target));
      }
      rows.push({
        target,
        state: action === "conflict" ? "conflict" : "synced",
        action,
        error: null,
      });
    } catch (e) {
      rows.push({ target, state: "error", action, error: errorMessage(e) });
    }
  }
  return rows;
}

// @spec PRJ-204, PRJ-206, PRJ-208 — Sync isolates per-server failures and
// runs against freshly-fetched settings/projects (not the render-time query
// cache), so a sync triggered right after a project or supervisor-settings
// save reflects that save instead of racing React Query's cache update.
export function useSupervisorSync() {
  const { backends } = useActiveBackendContext();
  const primary = usePrimaryBackend();
  const queryClient = useQueryClient();
  // `onSettled` below closes over `mutation` to reset it; the callback only
  // runs after a `mutate()` call, by which point `mutation` is assigned.
  const mutation = useMutation({
    mutationFn: async (): Promise<SupervisorRow[]> => {
      if (!primary) return [];
      const [settings, projects] = await Promise.all([
        ProjectsService.getSupervisorSettings(primary),
        ProjectsService.getProjects(primary),
      ]);
      const targets = buildSupervisorTargets(
        settings,
        projects,
        backends,
        primary,
      );
      return runSupervisorSync(targets);
    },
    // @spec PRJ-204, PRJ-208 — Concurrent syncs (two "Sync now" clicks, or a
    // manual click racing an auto re-sync triggered by a project/settings
    // save) share this scope id so TanStack Query serializes their
    // `mutationFn` calls instead of racing them; a serialized second run
    // then sees the first run's freshly-created/updated automations instead
    // of also creating them.
    scope: { id: "supervisor-sync" },
    onSettled: async () => {
      await queryClient.invalidateQueries({
        queryKey: SUPERVISOR_QUERY_KEYS.all,
      });
      // Once the invalidated rows/settings queries have refetched, drop this
      // mutation's own snapshot so the panel goes back to reflecting the
      // live rows query (`rowFor` in supervisor-panel.tsx otherwise prefers
      // `sync.data` forever, even after it goes stale).
      mutation.reset();
    },
  });
  return mutation;
}
