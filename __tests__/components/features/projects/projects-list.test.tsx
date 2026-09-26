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

const primary = {
  id: "p",
  name: "vps1",
  host: "http://vps1:8000",
  apiKey: "k",
  kind: "local" as const,
  isPrimary: true,
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
});
