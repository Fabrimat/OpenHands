import React from "react";
import { beforeEach, describe, it, expect, vi } from "vitest";
import { fireEvent, screen } from "@testing-library/react";
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
import AutomationService from "#/api/automation-service/automation-service.api";
import { SupervisorPanel } from "#/components/features/projects/supervisor-panel";
import { I18nKey } from "#/i18n/declaration";

const pc1 = {
  id: "pc1",
  name: "pc1",
  host: "http://pc1:8000",
  apiKey: "k",
  kind: "local" as const,
  isPrimary: true,
};
const vps1 = {
  id: "vps1",
  name: "vps1",
  host: "http://vps1:8000",
  apiKey: "k",
  kind: "local" as const,
};

function renderPanel() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return renderWithProviders(
    <QueryClientProvider client={qc}>
      <ActiveBackendProvider>
        <SupervisorPanel />
      </ActiveBackendProvider>
    </QueryClientProvider>,
  );
}

describe("SupervisorPanel", () => {
  beforeEach(() => {
    window.localStorage.clear();
    __resetActiveStoreForTests();
    setRegisteredBackends([pc1, vps1]);
    setActiveSelection({ backendId: "pc1" });
  });

  // @spec PRJ-207, PRJ-208 — Panel rows and isolation
  it("shows per-server state and syncs on demand", async () => {
    vi.spyOn(ProjectsService, "getProjects").mockResolvedValue([
      {
        id: "1",
        name: "App",
        repo_url: "github.com/fab/app",
        locations: [{ host: "http://pc1:8000", path: "/srv/app" }],
      },
    ]);
    vi.spyOn(ProjectsService, "getSupervisorSettings").mockResolvedValue({
      enabled: true,
      timezone: "Europe/Rome",
      run_time: "08:00",
      summary_time: "09:00",
      timeout_seconds: 1800,
      summary_clickup_list_id: "",
      servers: [
        { host: "http://pc1:8000", label: "pc1", enabled: true },
        { host: "http://vps1:8000", label: "vps1", enabled: true },
      ],
    });
    vi.spyOn(AutomationService, "listAutomationsForBackend").mockImplementation(
      async (backend) => {
        if (backend.host === vps1.host) throw new Error("Network Error");
        return { automations: [], total: 0 };
      },
    );
    const create = vi
      .spyOn(AutomationService, "createAutomationForBackend")
      .mockResolvedValue({} as never);
    const user = userEvent.setup();
    renderPanel();

    expect(await screen.findByTestId("supervisor-row-pc1")).toHaveTextContent(
      I18nKey.SUPERVISOR$STATE_PENDING,
    );
    expect(await screen.findByTestId("supervisor-row-vps1")).toHaveTextContent(
      I18nKey.SUPERVISOR$STATE_OFFLINE,
    );

    await user.click(await screen.findByTestId("supervisor-sync-now"));

    expect(await screen.findByTestId("supervisor-row-pc1")).toHaveTextContent(
      I18nKey.SUPERVISOR$STATE_SYNCED,
    );
    expect(await screen.findByTestId("supervisor-row-vps1")).toHaveTextContent(
      I18nKey.SUPERVISOR$STATE_OFFLINE,
    );
    expect(create).toHaveBeenCalledTimes(1);
    expect(create.mock.calls[0][0]).toEqual(
      expect.objectContaining({ host: pc1.host }),
    );
  });

  // @spec PRJ-207 — Summary-time-too-early warning
  it("warns when the summary time is too early", async () => {
    vi.spyOn(ProjectsService, "getProjects").mockResolvedValue([]);
    vi.spyOn(ProjectsService, "getSupervisorSettings").mockResolvedValue({
      enabled: true,
      timezone: "Europe/Rome",
      run_time: "08:00",
      summary_time: "09:00",
      timeout_seconds: 1800,
      summary_clickup_list_id: "list-1",
      servers: [
        { host: "http://pc1:8000", label: "pc1", enabled: true },
        { host: "http://vps1:8000", label: "vps1", enabled: true },
      ],
    });
    vi.spyOn(AutomationService, "listAutomationsForBackend").mockResolvedValue({
      automations: [],
      total: 0,
    });
    renderPanel();

    const summaryInput = await screen.findByTestId("supervisor-summary-time");
    expect(summaryInput).toHaveValue("09:00");

    fireEvent.change(summaryInput, { target: { value: "08:30" } });
    expect(
      screen.getByText(I18nKey.SUPERVISOR$SUMMARY_TOO_EARLY),
    ).toBeInTheDocument();

    fireEvent.change(summaryInput, { target: { value: "08:40" } });
    expect(
      screen.queryByText(I18nKey.SUPERVISOR$SUMMARY_TOO_EARLY),
    ).not.toBeInTheDocument();
  });
});
