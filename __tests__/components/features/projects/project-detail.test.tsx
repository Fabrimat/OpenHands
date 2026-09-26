import React from "react";
import { beforeEach, describe, it, expect, vi } from "vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderWithProviders } from "test-utils";
import { ActiveBackendProvider } from "#/contexts/active-backend-context";
import {
  __resetActiveStoreForTests,
  getActiveBackend,
  setActiveSelection,
  setRegisteredBackends,
} from "#/api/backend-registry/active-store";
import { ProjectsService } from "#/api/projects-service/projects-service.api";
import AutomationService from "#/api/automation-service/automation-service.api";
import AgentServerConversationService from "#/api/conversation-service/agent-server-conversation-service.api";
import { ProjectDetail } from "#/components/features/projects/project-detail";
import { I18nKey } from "#/i18n/declaration";

const search = vi.hoisted(() => vi.fn());
vi.mock("@openhands/typescript-client/clients", async (orig) => ({
  ...(await orig<object>()),
  ConversationClient: vi.fn(function M(options: { host: string }) {
    return { searchConversations: () => search(options.host) };
  }),
}));
vi.mock("@openhands/typescript-client/workspace/remote-workspace", () => ({
  RemoteWorkspace: vi.fn(function M() {
    return {
      executeCommand: vi.fn().mockResolvedValue({
        stdout: "git@github.com:fab/app.git\nmain",
        exit_code: 0,
      }),
    };
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
  locations: [
    { host: "http://pc:8000", path: "/repo/app" },
    { host: "http://vps:8000", path: "/srv/app" },
  ],
};

function renderDetail() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return renderWithProviders(
    <QueryClientProvider client={qc}>
      <ActiveBackendProvider>
        <ProjectDetail projectId="1" />
      </ActiveBackendProvider>
    </QueryClientProvider>,
  );
}

describe("ProjectDetail", () => {
  beforeEach(() => {
    vi.useRealTimers();
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

  // @spec PRJ-006, PRJ-007 — Aggregation with failure isolation
  it("shows conversations from a healthy server while another is unreachable", async () => {
    search.mockImplementation(async (host: string) => {
      if (host === "http://vps:8000") throw new Error("Network Error");
      return {
        items: [
          {
            id: "c1",
            title: "Fix login",
            updated_at: "2026-09-01T00:00:00Z",
            execution_status: "idle",
            workspace: { working_dir: "/repo/app" },
          },
        ],
      };
    });
    renderDetail();
    expect(await screen.findByText("Fix login")).toBeInTheDocument();
    expect(
      await screen.findByText(I18nKey.PROJECTS$SERVER_UNREACHABLE),
    ).toBeInTheDocument();
  });

  // @spec PRJ-009 — Cross-server actions (Review Focus #1: local_repo mode)
  it("switches to the location's server and starts a local_repo conversation in its path", async () => {
    search.mockResolvedValue({ items: [] });
    const create = vi
      .spyOn(AgentServerConversationService, "createConversation")
      .mockResolvedValue({ conversation_id: "new" } as never);
    const user = userEvent.setup();
    renderDetail();

    await user.click(
      await screen.findByTestId("project-location-new-conversation-1"),
    );

    await vi.waitFor(() => expect(create).toHaveBeenCalled(), {
      timeout: 3000,
    });
    expect(getActiveBackend().backend.id).toBe("b");
    expect(create.mock.calls[0]).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          workingDirOverride: "/srv/app",
          workspaceMode: "local_repo",
        }),
      ]),
    );
  });

  // @spec PRJ-003 — Delete requires confirmation
  it("deletes only after confirmation", async () => {
    search.mockResolvedValue({ items: [] });
    const save = vi.spyOn(ProjectsService, "saveProjects").mockResolvedValue();
    const user = userEvent.setup();
    renderDetail();

    await user.click(await screen.findByTestId("project-delete"));
    expect(save).not.toHaveBeenCalled();
    await user.click(screen.getByTestId("project-delete-confirm"));

    expect(save).toHaveBeenCalledWith(expect.objectContaining({ id: "a" }), []);
  });
});
