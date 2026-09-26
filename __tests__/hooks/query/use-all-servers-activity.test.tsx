// __tests__/hooks/query/use-all-servers-activity.test.tsx
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
import AutomationService from "#/api/automation-service/automation-service.api";

const search = vi.hoisted(() => vi.fn());
vi.mock("@openhands/typescript-client/clients", async (orig) => ({
  ...(await orig<object>()),
  ConversationClient: vi.fn(function ConversationClientMock(options: {
    host: string;
  }) {
    return { searchConversations: () => search(options.host) };
  }),
}));

import { useAllServersActivity } from "#/hooks/query/use-all-servers-activity";

const pc = {
  id: "a",
  name: "pc",
  host: "http://pc:8000",
  apiKey: "k",
  kind: "local" as const,
};
const vps = {
  id: "b",
  name: "vps",
  host: "http://vps:8000",
  apiKey: "k",
  kind: "local" as const,
};
const cloud = {
  id: "c",
  name: "cloud",
  host: "https://app.all-hands.dev",
  apiKey: "k",
  kind: "cloud" as const,
};

function wrapper({ children }: { children: React.ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return (
    <QueryClientProvider client={qc}>
      <ActiveBackendProvider>{children}</ActiveBackendProvider>
    </QueryClientProvider>
  );
}

// @spec PRJ-101, PRJ-104 — All-servers activity aggregation with failure isolation
describe("useAllServersActivity", () => {
  beforeEach(() => {
    window.localStorage.clear();
    __resetActiveStoreForTests();
    setRegisteredBackends([pc, vps, cloud]);
    setActiveSelection({ backendId: "a" });
    vi.spyOn(AutomationService, "listAutomationsForBackend").mockResolvedValue({
      automations: [],
      total: 0,
    });
  });

  it("marks a server with a failing conversation search as error while the other stays healthy, and ignores cloud backends", async () => {
    search.mockImplementation(async (host: string) => {
      if (host === "http://vps:8000") throw new Error("Network Error");
      return {
        items: [
          {
            id: "c1",
            title: "Fix login",
            updated_at: "2026-09-01T00:00:00Z",
            execution_status: "running",
            workspace: { working_dir: "/repo/app" },
          },
        ],
      };
    });

    const { result } = renderHook(() => useAllServersActivity(), { wrapper });

    await waitFor(() =>
      expect(
        result.current.servers.find((s) => s.backend.id === "b")?.status,
      ).toBe("error"),
    );

    expect(result.current.servers).toHaveLength(2);
    const pcServer = result.current.servers.find((s) => s.backend.id === "a");
    expect(pcServer?.status).toBe("success");
    expect(pcServer?.conversations).toEqual([
      {
        id: "c1",
        title: "Fix login",
        updated_at: "2026-09-01T00:00:00Z",
        execution_status: "running",
        working_dir: "/repo/app",
        backend: pc,
      },
    ]);
    expect(result.current.conversations.map((c) => c.id)).toEqual(["c1"]);
  });
});
