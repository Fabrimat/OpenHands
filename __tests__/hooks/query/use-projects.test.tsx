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
import { ProjectsService } from "#/api/projects-service/projects-service.api";
import { useProjects, useSaveProjects } from "#/hooks/query/use-projects";

const active = {
  id: "a",
  name: "pc",
  host: "http://pc:8000",
  apiKey: "k",
  kind: "local" as const,
};
const primary = {
  id: "p",
  name: "vps",
  host: "http://vps:8000",
  apiKey: "k2",
  kind: "local" as const,
  isPrimary: true,
};

function wrapper({ children }: { children: React.ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return (
    <QueryClientProvider client={qc}>
      <ActiveBackendProvider>{children}</ActiveBackendProvider>
    </QueryClientProvider>
  );
}

// @spec PRJ-001 — Projects persist on the primary server
describe("useProjects", () => {
  beforeEach(() => {
    window.localStorage.clear();
    __resetActiveStoreForTests();
    setRegisteredBackends([active, primary]);
    setActiveSelection({ backendId: "a" });
  });

  it("loads from the primary backend, not the active one", async () => {
    const spy = vi.spyOn(ProjectsService, "getProjects").mockResolvedValue([]);
    const { result } = renderHook(() => useProjects(), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(spy).toHaveBeenCalledWith(expect.objectContaining({ id: "p" }));
  });

  it("saves to the primary backend", async () => {
    vi.spyOn(ProjectsService, "getProjects").mockResolvedValue([]);
    const save = vi.spyOn(ProjectsService, "saveProjects").mockResolvedValue();
    const { result } = renderHook(() => useSaveProjects(), { wrapper });
    await result.current.mutateAsync([]);
    expect(save).toHaveBeenCalledWith(expect.objectContaining({ id: "p" }), []);
  });
});
