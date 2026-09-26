import React from "react";
import { beforeEach, describe, it, expect, vi } from "vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderWithProviders } from "test-utils";
import type { NavigationContextValue } from "#/context/navigation-context";
import { ActiveBackendProvider } from "#/contexts/active-backend-context";
import {
  __resetActiveStoreForTests,
  getActiveBackend,
  setActiveSelection,
  setRegisteredBackends,
} from "#/api/backend-registry/active-store";
import { ProjectsService } from "#/api/projects-service/projects-service.api";
import AutomationService from "#/api/automation-service/automation-service.api";
import { Dashboard } from "#/components/features/dashboard/dashboard";
import { I18nKey } from "#/i18n/declaration";

vi.mock("#/utils/custom-toast-handlers", () => ({
  displayErrorToast: vi.fn(),
  displaySuccessToast: vi.fn(),
}));

const search = vi.hoisted(() => vi.fn());
vi.mock("@openhands/typescript-client/clients", async (orig) => ({
  ...(await orig<object>()),
  ConversationClient: vi.fn(function ConversationClientMock(options: {
    host: string;
  }) {
    return { searchConversations: () => search(options.host) };
  }),
}));

const pc = {
  id: "a",
  name: "pc",
  host: "http://pc:8000",
  apiKey: "k",
  kind: "local" as const,
  isPrimary: true,
};
const vps = {
  id: "b",
  name: "vps",
  host: "http://vps:8000",
  apiKey: "k",
  kind: "local" as const,
};

const project = {
  id: "1",
  name: "App",
  repo_url: "github.com/fab/app",
  locations: [{ host: "http://pc:8000", path: "/repo/app" }],
};

function renderDashboard(navigation?: Partial<NavigationContextValue>) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return renderWithProviders(
    <QueryClientProvider client={qc}>
      <ActiveBackendProvider>
        <Dashboard />
      </ActiveBackendProvider>
    </QueryClientProvider>,
    { navigation },
  );
}

describe("Dashboard", () => {
  beforeEach(() => {
    window.localStorage.clear();
    __resetActiveStoreForTests();
    setRegisteredBackends([pc, vps]);
    setActiveSelection({ backendId: "a" });
    vi.spyOn(ProjectsService, "getProjects").mockResolvedValue([project]);
    vi.spyOn(AutomationService, "listAutomationsForBackend").mockResolvedValue({
      automations: [],
      total: 0,
    });
  });

  // @spec PRJ-102 — Activity grouped by project
  it("groups active conversations by project and puts unmatched ones under Unassigned", async () => {
    search.mockImplementation(async (host: string) => ({
      items:
        host === "http://pc:8000"
          ? [
              {
                id: "c1",
                title: "Fix login",
                updated_at: "2026-09-01T00:00:00Z",
                execution_status: "running",
                workspace: { working_dir: "/repo/app" },
              },
            ]
          : [
              {
                id: "c2",
                title: "Rogue task",
                updated_at: "2026-09-01T00:00:00Z",
                execution_status: "running",
                workspace: { working_dir: "/other/proj" },
              },
            ],
    }));
    renderDashboard();

    expect(await screen.findByText("Fix login")).toBeInTheDocument();
    expect(screen.getByText("App")).toBeInTheDocument();
    expect(screen.getByText(I18nKey.DASHBOARD$UNASSIGNED)).toBeInTheDocument();
    expect(screen.getByText("Rogue task")).toBeInTheDocument();
  });

  // @spec PRJ-103 — Active filter
  it("hides idle conversations until the show-all-recent toggle is enabled", async () => {
    search.mockImplementation(async (host: string) => ({
      items:
        host === "http://pc:8000"
          ? [
              {
                id: "c1",
                title: "Idle task",
                updated_at: "2026-09-01T00:00:00Z",
                execution_status: "idle",
                workspace: { working_dir: "/repo/app" },
              },
            ]
          : [],
    }));
    const user = userEvent.setup();
    renderDashboard();

    await screen.findByTestId(`dashboard-server-${pc.id}`);
    expect(screen.queryByText("Idle task")).not.toBeInTheDocument();

    await user.click(
      screen.getByRole("switch", {
        name: I18nKey.DASHBOARD$SHOW_ALL_RECENT,
      }),
    );

    expect(await screen.findByText("Idle task")).toBeInTheDocument();
  });

  // @spec PRJ-104 — Auto-refresh and per-server failure isolation
  it("shows unreachable on the failing server's row while the healthy server still renders its counts", async () => {
    search.mockImplementation(async (host: string) => {
      if (host === "http://vps:8000") throw new Error("Network Error");
      return { items: [] };
    });
    renderDashboard();

    expect(
      await screen.findByText(I18nKey.PROJECTS$SERVER_UNREACHABLE),
    ).toBeInTheDocument();
    const pcRow = screen.getByTestId(`dashboard-server-${pc.id}`);
    expect(pcRow).toHaveTextContent(I18nKey.DASHBOARD$ACTIVE_AGENTS);
  });

  // @spec PRJ-105 — Cross-server navigation
  it("switches to the conversation's server before navigating to it", async () => {
    search.mockImplementation(async (host: string) => ({
      items:
        host === "http://vps:8000"
          ? [
              {
                id: "c9",
                title: "Cross-server task",
                updated_at: "2026-09-01T00:00:00Z",
                execution_status: "running",
                workspace: { working_dir: "/srv/app" },
              },
            ]
          : [],
    }));
    const navigateMock = vi.fn();
    const user = userEvent.setup();
    renderDashboard({ navigate: navigateMock });

    await user.click(await screen.findByText("Cross-server task"));

    await vi.waitFor(() =>
      expect(navigateMock).toHaveBeenCalledWith("/conversations/c9"),
    );
    expect(getActiveBackend().backend.id).toBe("b");
  });
});
