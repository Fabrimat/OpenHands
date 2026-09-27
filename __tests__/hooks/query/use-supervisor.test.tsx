// __tests__/hooks/query/use-supervisor.test.tsx
import React from "react";
import { beforeEach, describe, it, expect, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ActiveBackendProvider } from "#/contexts/active-backend-context";
import {
  __resetActiveStoreForTests,
  setActiveSelection,
  setRegisteredBackends,
} from "#/api/backend-registry/active-store";
import type { Backend } from "#/api/backend-registry/types";
import { ProjectsService } from "#/api/projects-service/projects-service.api";
import AutomationService from "#/api/automation-service/automation-service.api";
import type { Automation } from "#/types/automation";
import type { Project } from "#/types/project";
import type { SupervisorSettings } from "#/types/supervisor";
import { SUPERVISOR_MARKER } from "#/utils/supervisor-prompt";
import { useProjects } from "#/hooks/query/use-projects";
import {
  useSupervisorRows,
  useSupervisorSettings,
  useSupervisorSync,
} from "#/hooks/query/use-supervisor";

// The mutation re-fetches settings/projects itself, so this wait isn't
// strictly required for correctness — but it mirrors how a real "Sync now"
// button behaves (only enabled once both queries have resolved) and keeps
// the harness from invoking the mutation before the backend registry/spies
// below have settled.
function useSyncHarness() {
  const settingsQuery = useSupervisorSettings();
  const projectsQuery = useProjects();
  const sync = useSupervisorSync();
  return { ready: settingsQuery.isSuccess && projectsQuery.isSuccess, sync };
}

function wrapper({ children }: { children: React.ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return (
    <QueryClientProvider client={qc}>
      <ActiveBackendProvider>{children}</ActiveBackendProvider>
    </QueryClientProvider>
  );
}

function backend(id: string, isPrimary = false): Backend {
  return {
    id,
    name: id,
    host: `http://${id}:8000`,
    apiKey: "k",
    kind: "local",
    isPrimary,
  };
}

function projectOn(id: string): Project {
  return {
    id,
    name: id,
    repo_url: `github.com/fab/${id}`,
    locations: [{ host: `http://${id}:8000`, path: `/repo/${id}` }],
  };
}

const pc1 = backend("pc1", true);
const vps1 = backend("vps1");

const settings: SupervisorSettings = {
  enabled: true,
  timezone: "Europe/Rome",
  run_time: "08:00",
  summary_time: "09:00",
  timeout_seconds: 1800,
  summary_clickup_list_id: "S",
  servers: [
    { host: "http://pc1:8000", label: "pc1", enabled: true },
    { host: "http://vps1:8000", label: "vps1", enabled: true },
    { host: "http://gone:8000", label: "gone", enabled: true },
  ],
};

beforeEach(() => {
  window.localStorage.clear();
  __resetActiveStoreForTests();
  vi.restoreAllMocks();
});

// @spec PRJ-204, PRJ-208 — Sync isolates per-server failures
describe("useSupervisorSync", () => {
  beforeEach(() => {
    setRegisteredBackends([pc1, vps1]);
    setActiveSelection({ backendId: "pc1" });
    vi.spyOn(ProjectsService, "getProjects").mockResolvedValue([
      projectOn("pc1"),
      projectOn("vps1"),
    ]);
    vi.spyOn(ProjectsService, "getSupervisorSettings").mockResolvedValue(
      settings,
    );
  });

  it("creates on healthy servers and reports per-row errors without stopping", async () => {
    vi.spyOn(AutomationService, "listAutomationsForBackend").mockResolvedValue({
      automations: [],
      total: 0,
    });
    const create = vi
      .spyOn(AutomationService, "createAutomationForBackend")
      .mockImplementation(async (target) => {
        if (target.id === "vps1") throw new Error("timeout must be <= 900");
        return { id: "new" } as never;
      });

    const { result } = renderHook(() => useSyncHarness(), { wrapper });
    await waitFor(() => expect(result.current.ready).toBe(true));
    const rows = await result.current.sync.mutateAsync();

    const byLabel = Object.fromEntries(rows.map((r) => [r.target.label, r]));
    expect(byLabel.pc1.state).toBe("synced");
    expect(byLabel.vps1.state).toBe("error");
    expect(byLabel.vps1.error).toContain("timeout must be <= 900");
    expect(byLabel.gone.state).toBe("unregistered");
    expect(create).toHaveBeenCalledTimes(3); // pc1, vps1, summary on pc1
  });

  // Controller ruling: a renamed server label must not leave the old
  // `Supervisore — <oldlabel>` automation running forever.
  // @spec PRJ-204 — Rename cleanup disables stale marker-only automations
  it("disables a stale renamed supervisor automation but never a marker-less one", async () => {
    const stale = {
      id: "old1",
      name: "Supervisore — old-pc1",
      enabled: true,
      prompt: `${SUPERVISOR_MARKER}\nstale prompt for a renamed label`,
      trigger: { type: "cron", schedule: "0 8 * * *", timezone: "Europe/Rome" },
      timeout: 1800,
      created_at: "2026-01-01T00:00:00Z",
      updated_at: "2026-01-01T00:00:00Z",
    };
    const markerless = {
      id: "unrelated1",
      name: "Supervisore — something-else",
      enabled: true,
      prompt: "hand-written automation, no marker",
      trigger: { type: "cron", schedule: "0 9 * * *", timezone: "Europe/Rome" },
      timeout: 900,
      created_at: "2026-01-01T00:00:00Z",
      updated_at: "2026-01-01T00:00:00Z",
    };
    // Single-server settings: no summary automation, so the sweep only runs once.
    vi.spyOn(ProjectsService, "getSupervisorSettings").mockResolvedValue({
      ...settings,
      summary_clickup_list_id: "",
      servers: [{ host: "http://pc1:8000", label: "pc1", enabled: true }],
    });
    vi.spyOn(AutomationService, "listAutomationsForBackend").mockResolvedValue({
      automations: [stale, markerless],
      total: 2,
    });
    vi.spyOn(AutomationService, "createAutomationForBackend").mockResolvedValue(
      {
        id: "new",
      } as never,
    );
    const update = vi
      .spyOn(AutomationService, "updateAutomationForBackend")
      .mockResolvedValue({} as never);

    const { result } = renderHook(() => useSyncHarness(), { wrapper });
    await waitFor(() => expect(result.current.ready).toBe(true));
    const rows = await result.current.sync.mutateAsync();

    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({ id: "pc1" }),
      "old1",
      { enabled: false },
    );
    expect(update).not.toHaveBeenCalledWith(
      expect.anything(),
      "unrelated1",
      expect.anything(),
    );
    expect(rows.find((r) => r.target.label === "pc1")?.state).toBe("synced");
  });

  // Controller ruling: a race between two syncs (or a manual "Sync now"
  // racing an auto re-sync) must not leave a permanent duplicate automation.
  // @spec PRJ-204, PRJ-208 — Self-heal keeps only the reconciled automation
  it("disables a duplicate automation sharing the desired name, keeping the reconciled one", async () => {
    const kept: Automation = {
      id: "kept",
      name: "Supervisore — pc1",
      enabled: true,
      prompt: `${SUPERVISOR_MARKER}\nsame prompt`,
      trigger: { type: "cron", schedule: "0 8 * * *", timezone: "Europe/Rome" },
      timeout: 1800,
      created_at: "2026-01-01T00:00:00Z",
      updated_at: "2026-01-01T00:00:00Z",
    };
    const duplicate: Automation = {
      ...kept,
      id: "duplicate",
    };
    vi.spyOn(ProjectsService, "getSupervisorSettings").mockResolvedValue({
      ...settings,
      summary_clickup_list_id: "",
      servers: [{ host: "http://pc1:8000", label: "pc1", enabled: true }],
    });
    vi.spyOn(AutomationService, "listAutomationsForBackend").mockResolvedValue({
      automations: [kept, duplicate],
      total: 2,
    });
    const update = vi
      .spyOn(AutomationService, "updateAutomationForBackend")
      .mockResolvedValue({} as never);

    const { result } = renderHook(() => useSyncHarness(), { wrapper });
    await waitFor(() => expect(result.current.ready).toBe(true));
    const rows = await result.current.sync.mutateAsync();

    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({ id: "pc1" }),
      "duplicate",
      { enabled: false },
    );
    // "kept" may still receive its own reconciling update (e.g. a refreshed
    // prompt), but it must never be the one disabled.
    expect(update).not.toHaveBeenCalledWith(
      expect.anything(),
      "kept",
      expect.objectContaining({ enabled: false }),
    );
    expect(rows.find((r) => r.target.label === "pc1")?.state).toBe("synced");
  });

  // @spec PRJ-204, PRJ-208 — Concurrent syncs serialize via mutation `scope`
  it("serializes two back-to-back sync calls so a target is created only once", async () => {
    vi.spyOn(ProjectsService, "getSupervisorSettings").mockResolvedValue({
      ...settings,
      summary_clickup_list_id: "",
      servers: [{ host: "http://pc1:8000", label: "pc1", enabled: true }],
    });
    // Stateful list mock: the second (serialized) run must see the first
    // run's freshly-created automation, or it would create a second one.
    const store: Record<string, Automation[]> = { "http://pc1:8000": [] };
    vi.spyOn(AutomationService, "listAutomationsForBackend").mockImplementation(
      async (backend) => {
        const automations = store[backend.host] ?? [];
        return { automations, total: automations.length };
      },
    );
    const create = vi
      .spyOn(AutomationService, "createAutomationForBackend")
      .mockImplementation(async (backend, desired) => {
        const automation: Automation = {
          id: `new-${(store[backend.host] ?? []).length}`,
          name: desired.name,
          prompt: desired.prompt,
          trigger: desired.trigger,
          timeout: desired.timeout,
          enabled: desired.enabled,
          created_at: "2026-01-01T00:00:00Z",
          updated_at: "2026-01-01T00:00:00Z",
        };
        store[backend.host] = [...(store[backend.host] ?? []), automation];
        return automation;
      });

    const { result } = renderHook(() => useSyncHarness(), { wrapper });
    await waitFor(() => expect(result.current.ready).toBe(true));

    const [rowsA, rowsB] = await Promise.all([
      result.current.sync.mutateAsync(),
      result.current.sync.mutateAsync(),
    ]);

    expect(create).toHaveBeenCalledTimes(1);
    expect(rowsA.find((r) => r.target.label === "pc1")?.state).toBe("synced");
    expect(rowsB.find((r) => r.target.label === "pc1")?.state).toBe("synced");
  });
});

// @spec PRJ-207 — Row sync state
describe("useSupervisorRows", () => {
  it("reports an offline server without blocking a healthy one", async () => {
    setRegisteredBackends([pc1, vps1]);
    setActiveSelection({ backendId: "pc1" });
    vi.spyOn(ProjectsService, "getProjects").mockResolvedValue([
      projectOn("pc1"),
      projectOn("vps1"),
    ]);
    vi.spyOn(ProjectsService, "getSupervisorSettings").mockResolvedValue(
      settings,
    );
    vi.spyOn(AutomationService, "listAutomationsForBackend").mockImplementation(
      async (target) => {
        if (target.id === "vps1") throw new Error("ECONNREFUSED");
        return { automations: [], total: 0 };
      },
    );

    const { result } = renderHook(() => useSupervisorRows(), { wrapper });

    await waitFor(() => {
      const byLabel = Object.fromEntries(
        result.current.map((r) => [r.target.label, r]),
      );
      expect(byLabel.vps1.state).toBe("offline");
      expect(byLabel.pc1.state).toBe("pending");
    });
  });
});
