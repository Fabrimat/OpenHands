// __tests__/hooks/query/use-project-data.test.tsx
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
import type { Project } from "#/types/project";

const search = vi.hoisted(() => vi.fn());
vi.mock("@openhands/typescript-client/clients", async (orig) => ({
  ...(await orig<object>()),
  ConversationClient: vi.fn(function ConversationClientMock(options: {
    host: string;
  }) {
    return { searchConversations: () => search(options.host) };
  }),
}));

import { useProjectConversations } from "#/hooks/query/use-project-data";

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
const project: Project = {
  id: "1",
  name: "App",
  repo_url: "github.com/fab/app",
  locations: [
    { host: "http://pc:8000", path: "/repo/app" },
    { host: "http://vps:8000", path: "/srv/app" },
    { host: "http://gone:8000", path: "/x" },
  ],
};

function wrapper({ children }: { children: React.ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return (
    <QueryClientProvider client={qc}>
      <ActiveBackendProvider>{children}</ActiveBackendProvider>
    </QueryClientProvider>
  );
}

// @spec PRJ-006, PRJ-007 — Aggregation with per-server failure isolation
describe("useProjectConversations", () => {
  beforeEach(() => {
    window.localStorage.clear();
    __resetActiveStoreForTests();
    setRegisteredBackends([pc, vps]);
    setActiveSelection({ backendId: "a" });
  });

  it("keeps matching conversations from healthy servers when one fails or is unregistered", async () => {
    search.mockImplementation(async (host: string) => {
      if (host === "http://vps:8000") throw new Error("Network Error");
      return {
        items: [
          {
            id: "c1",
            title: "in",
            updated_at: "2026-09-01T00:00:00Z",
            execution_status: "idle",
            workspace: { working_dir: "/repo/app/sub" },
          },
          {
            id: "c2",
            title: "out",
            updated_at: "2026-09-02T00:00:00Z",
            execution_status: "idle",
            workspace: { working_dir: "/repo/other" },
          },
        ],
      };
    });

    const { result } = renderHook(() => useProjectConversations(project), {
      wrapper,
    });

    await waitFor(() =>
      expect(result.current.locations[1].status).toBe("error"),
    );
    expect(result.current.conversations.map((c) => c.id)).toEqual(["c1"]);
    expect(result.current.locations.map((l) => l.status)).toEqual([
      "success",
      "error",
      "unregistered",
    ]);
  });
});
