// __tests__/hooks/query/use-mcp-fleet.test.tsx
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
import {
  McpFleetService,
  pushToBackends,
  removeFromBackends,
} from "#/api/mcp-service/mcp-fleet.api";
import {
  useMcpFleet,
  usePushMcpToBackends,
  useRemoveMcpFromBackends,
} from "#/hooks/query/use-mcp-fleet";

vi.mock("#/api/mcp-service/mcp-fleet.api", async (orig) => ({
  ...(await orig<object>()),
  pushToBackends: vi.fn(),
  removeFromBackends: vi.fn(),
}));

const a: Backend = {
  id: "a",
  name: "a",
  host: "https://a.example",
  apiKey: "k",
  kind: "local",
};
const b: Backend = {
  id: "b",
  name: "b",
  host: "https://b.example",
  apiKey: "k",
  kind: "local",
};
const cloud: Backend = {
  id: "c",
  name: "c",
  host: "https://app.all-hands.dev",
  apiKey: "k",
  kind: "cloud",
};

function makeWrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const invalidateSpy = vi.spyOn(qc, "invalidateQueries");
  function wrapper({ children }: { children: React.ReactNode }) {
    return (
      <QueryClientProvider client={qc}>
        <ActiveBackendProvider>{children}</ActiveBackendProvider>
      </QueryClientProvider>
    );
  }
  return { wrapper, invalidateSpy };
}

beforeEach(() => {
  window.localStorage.clear();
  __resetActiveStoreForTests();
  vi.restoreAllMocks();
});

// @spec PRJ-601 — All-servers MCP view (per-backend failure isolation)
describe("useMcpFleet", () => {
  it("gives one column per local backend, ignores cloud, and reports a null config for an erroring backend", async () => {
    setRegisteredBackends([a, b, cloud]);
    setActiveSelection({ backendId: "a" });
    vi.spyOn(McpFleetService, "getConfig").mockImplementation(
      async (backend) => {
        if (backend.id === "b") throw new Error("ECONNREFUSED");
        return { x: { transport: "stdio", command: "npx" } };
      },
    );
    const { wrapper } = makeWrapper();

    const { result } = renderHook(() => useMcpFleet(), { wrapper });

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.columns.map((col) => col.backend.id)).toEqual([
      "a",
      "b",
    ]);
    const columnB = result.current.columns.find(
      (col) => col.backend.id === "b",
    );
    expect(columnB?.config).toBeNull();
    expect(result.current.statuses).toEqual(["success", "error"]);
  });
});

function expectFleetInvalidation(invalidateSpy: {
  mock: { calls: unknown[][] };
}) {
  const invalidatedKeys = (
    invalidateSpy.mock.calls as { queryKey?: unknown }[][]
  ).map((call) => call[0]?.queryKey);
  expect(invalidatedKeys).toContainEqual(["mcp-fleet"]);
  expect(invalidatedKeys).toContainEqual(["settings", "personal"]);
}

// @spec PRJ-603 — Completion invalidates the fleet and settings queries
describe("usePushMcpToBackends", () => {
  it("invalidates the fleet and personal-settings queries on settle", async () => {
    vi.mocked(pushToBackends).mockResolvedValue([{ backendId: "a", ok: true }]);
    setRegisteredBackends([a]);
    setActiveSelection({ backendId: "a" });
    const { wrapper, invalidateSpy } = makeWrapper();

    const { result } = renderHook(() => usePushMcpToBackends(), { wrapper });
    await result.current.mutateAsync({
      targets: [{ backend: a, previous: undefined }],
      server: { id: "x", type: "stdio", command: "npx" },
    });

    expectFleetInvalidation(invalidateSpy);
  });
});

// @spec PRJ-604 — Completion invalidates the fleet and settings queries
describe("useRemoveMcpFromBackends", () => {
  it("invalidates the fleet and personal-settings queries on settle", async () => {
    vi.mocked(removeFromBackends).mockResolvedValue([
      { backendId: "a", ok: true },
    ]);
    setRegisteredBackends([a]);
    setActiveSelection({ backendId: "a" });
    const { wrapper, invalidateSpy } = makeWrapper();

    const { result } = renderHook(() => useRemoveMcpFromBackends(), {
      wrapper,
    });
    await result.current.mutateAsync({ backends: [a], key: "x" });

    expectFleetInvalidation(invalidateSpy);
  });
});
