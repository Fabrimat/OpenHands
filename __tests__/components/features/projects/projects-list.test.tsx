import React from "react";
import { beforeEach, describe, it, expect, vi } from "vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderWithProviders } from "test-utils";
import { ActiveBackendProvider } from "#/contexts/active-backend-context";
import {
  __resetActiveStoreForTests,
  setActiveSelection,
  setRegisteredBackends,
} from "#/api/backend-registry/active-store";
import { ProjectsService } from "#/api/projects-service/projects-service.api";
import { ProjectsList } from "#/components/features/projects/projects-list";
import { I18nKey } from "#/i18n/declaration";

vi.mock("#/utils/custom-toast-handlers", () => ({
  displayErrorToast: vi.fn(),
  displaySuccessToast: vi.fn(),
}));

// PRJ-004's auto-detect effect probes git info for the first location with a
// path via RemoteWorkspace.executeCommand, which is a real websocket-backed
// call. None of these hosts have a real agent-server behind them, so stub
// the client to keep the test hermetic instead of letting it hit the
// network and resolve/reject on its own schedule after the test moves on.
vi.mock("@openhands/typescript-client/workspace/remote-workspace", () => ({
  RemoteWorkspace: vi.fn().mockImplementation(function MockRemoteWorkspace() {
    return {
      executeCommand: vi.fn().mockResolvedValue({ stdout: "", exit_code: 1 }),
    };
  }),
}));

const primary = {
  id: "p",
  name: "vps1",
  host: "http://vps1:8000",
  apiKey: "k",
  kind: "local" as const,
  isPrimary: true,
};

const cloud = {
  id: "c",
  name: "Cloud",
  host: "https://app.all-hands.dev",
  apiKey: "ck",
  kind: "cloud" as const,
};

function renderList() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return renderWithProviders(
    <QueryClientProvider client={qc}>
      <ActiveBackendProvider>
        <ProjectsList />
      </ActiveBackendProvider>
    </QueryClientProvider>,
  );
}

describe("ProjectsList", () => {
  beforeEach(() => {
    window.localStorage.clear();
    __resetActiveStoreForTests();
    setRegisteredBackends([primary]);
    setActiveSelection({ backendId: "p" });
  });

  // @spec PRJ-003 — Project CRUD
  it("creates a project with a normalized repo URL", async () => {
    vi.spyOn(ProjectsService, "getProjects").mockResolvedValue([]);
    const save = vi.spyOn(ProjectsService, "saveProjects").mockResolvedValue();
    const user = userEvent.setup();
    renderList();

    await user.click(await screen.findByTestId("projects-new"));
    await user.type(screen.getByTestId("project-form-name"), "App");
    await user.type(
      screen.getByTestId("project-form-repo"),
      "https://github.com/Fab/App.git",
    );
    await user.type(screen.getByTestId("project-form-path-0"), "/srv/app");
    await user.click(screen.getByTestId("project-form-submit"));

    expect(save).toHaveBeenCalledWith(expect.objectContaining({ id: "p" }), [
      expect.objectContaining({
        name: "App",
        repo_url: "github.com/fab/app",
        locations: [{ host: "http://vps1:8000", path: "/srv/app" }],
      }),
    ]);
  });

  // @spec PRJ-003 — Project CRUD (default location host stays a local backend)
  it("defaults a new location's server to the local primary when the active backend is Cloud", async () => {
    setRegisteredBackends([cloud, primary]);
    setActiveSelection({ backendId: "c" });
    vi.spyOn(ProjectsService, "getProjects").mockResolvedValue([]);
    const user = userEvent.setup();
    renderList();

    await user.click(await screen.findByTestId("projects-new"));

    expect(screen.getByTestId("project-form-server-0")).toHaveValue(
      primary.host,
    );
    expect(
      screen.queryByTestId("project-form-browse-0"),
    ).not.toBeInTheDocument();
  });

  // @spec PRJ-007 — Primary unreachable
  it("shows a retryable error naming the primary server when loading fails", async () => {
    vi.spyOn(ProjectsService, "getProjects").mockRejectedValue(
      new Error("Network Error"),
    );
    renderList();
    expect(
      await screen.findByText(I18nKey.PROJECTS$PRIMARY_UNREACHABLE),
    ).toBeInTheDocument();
    expect(screen.getByTestId("projects-retry")).toBeInTheDocument();
    expect(screen.queryByTestId("projects-new")).not.toBeInTheDocument();
  });

  // Final-review fix — loopback hosts persisted in shared project data
  it("warns when a new location's default host is a loopback address", async () => {
    const loopbackPrimary = {
      id: "lp",
      name: "pc",
      host: "http://localhost:8000",
      apiKey: "k",
      kind: "local" as const,
      isPrimary: true,
    };
    setRegisteredBackends([loopbackPrimary]);
    setActiveSelection({ backendId: "lp" });
    vi.spyOn(ProjectsService, "getProjects").mockResolvedValue([]);
    const user = userEvent.setup();
    renderList();

    await user.click(await screen.findByTestId("projects-new"));

    expect(
      screen.getByTestId("project-form-loopback-warning-0"),
    ).toBeInTheDocument();
  });

  // Final-review fix — ClickUp URL: only http:/https: links are accepted
  it("rejects a non-http(s) ClickUp URL", async () => {
    vi.spyOn(ProjectsService, "getProjects").mockResolvedValue([]);
    // `vi.spyOn` re-wraps an already-mocked method in place, so an earlier
    // test's call history on this shared spy would otherwise leak in here.
    const save = vi
      .spyOn(ProjectsService, "saveProjects")
      .mockReset()
      .mockResolvedValue();
    const user = userEvent.setup();
    renderList();

    await user.click(await screen.findByTestId("projects-new"));
    await user.type(screen.getByTestId("project-form-name"), "App");
    await user.type(
      screen.getByTestId("project-form-repo"),
      "github.com/fab/app",
    );
    await user.type(screen.getByTestId("project-form-path-0"), "/srv/app");
    await user.type(
      screen.getByTestId("project-form-clickup"),
      "javascript:alert(1)",
    );
    await user.click(screen.getByTestId("project-form-submit"));

    expect(
      await screen.findByText(I18nKey.PROJECTS$CLICKUP_URL_INVALID),
    ).toBeInTheDocument();
    expect(save).not.toHaveBeenCalled();
  });
});
