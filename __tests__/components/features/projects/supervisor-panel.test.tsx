import React from "react";
import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
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
import type { Project } from "#/types/project";
import type { SupervisorSettings } from "#/types/supervisor";

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
      summary_tracker: null,
      servers: [
        { host: "http://pc1:8000", label: "pc1", enabled: true },
        { host: "http://vps1:8000", label: "vps1", enabled: true },
      ],
    });
    // Stateful list mock: after `create` runs, a refetched list must reflect
    // the created automation, otherwise the panel's post-sync reset (which
    // falls back to the live rows query — see PRJ-208 finding #7) would
    // observe a stale empty list and re-flip the row back to "pending".
    const store: Record<string, import("#/types/automation").Automation[]> = {
      [pc1.host]: [],
    };
    vi.spyOn(AutomationService, "listAutomationsForBackend").mockImplementation(
      async (backend) => {
        if (backend.host === vps1.host) throw new Error("Network Error");
        const automations = store[backend.host] ?? [];
        return { automations, total: automations.length };
      },
    );
    const create = vi
      .spyOn(AutomationService, "createAutomationForBackend")
      .mockImplementation(async (backend, desired) => {
        const automation = {
          id: "new-1",
          name: desired.name,
          prompt: desired.prompt,
          trigger: desired.trigger,
          timeout: desired.timeout,
          enabled: desired.enabled,
          created_at: "2026-01-01T00:00:00Z",
          updated_at: "2026-01-01T00:00:00Z",
        };
        store[backend.host] = [...(store[backend.host] ?? []), automation];
        return automation as never;
      });
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
      summary_tracker: { provider: "clickup", ref: "list-1" },
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

  // @spec PRJ-207 — The warning uses the enabled server's actual index in
  // `settings.servers` (its real stagger offset), not the count of enabled
  // servers: a disabled first server must not understate the last enabled
  // server's stagger.
  it("warns using the enabled server's real stagger offset when earlier servers are disabled", async () => {
    vi.spyOn(ProjectsService, "getProjects").mockResolvedValue([]);
    vi.spyOn(ProjectsService, "getSupervisorSettings").mockResolvedValue({
      enabled: true,
      timezone: "Europe/Rome",
      run_time: "08:00",
      summary_time: "09:00",
      timeout_seconds: 1800,
      summary_tracker: { provider: "clickup", ref: "list-1" },
      servers: [
        { host: "http://pc1:8000", label: "pc1", enabled: false },
        { host: "http://vps1:8000", label: "vps1", enabled: false },
        { host: "http://vps2:8000", label: "vps2", enabled: true },
      ],
    });
    vi.spyOn(AutomationService, "listAutomationsForBackend").mockResolvedValue({
      automations: [],
      total: 0,
    });
    renderPanel();

    const summaryInput = await screen.findByTestId("supervisor-summary-time");
    expect(summaryInput).toHaveValue("09:00");

    // vps2 is index 2 -> real stagger 10 min -> runs at 08:10, plus the
    // 30-minute timeout -> not-too-early threshold is 08:40. A naive
    // enabled-count formula (1 enabled server -> offset 0) would place the
    // threshold at 08:30 and miss this case.
    fireEvent.change(summaryInput, { target: { value: "08:30" } });
    expect(
      screen.getByText(I18nKey.SUPERVISOR$SUMMARY_TOO_EARLY),
    ).toBeInTheDocument();

    fireEvent.change(summaryInput, { target: { value: "08:40" } });
    expect(
      screen.queryByText(I18nKey.SUPERVISOR$SUMMARY_TOO_EARLY),
    ).not.toBeInTheDocument();
  });

  // @spec PRJ-201 — Clearing the timeout must disable Save and show an
  // inline error instead of silently resetting all settings on save.
  it("disables Save and shows an inline error when the timeout is cleared", async () => {
    vi.spyOn(ProjectsService, "getProjects").mockResolvedValue([]);
    vi.spyOn(ProjectsService, "getSupervisorSettings").mockResolvedValue({
      enabled: true,
      timezone: "Europe/Rome",
      run_time: "08:00",
      summary_time: "09:00",
      timeout_seconds: 1800,
      summary_tracker: null,
      servers: [{ host: "http://pc1:8000", label: "pc1", enabled: true }],
    });
    vi.spyOn(AutomationService, "listAutomationsForBackend").mockResolvedValue({
      automations: [],
      total: 0,
    });
    renderPanel();

    const timeoutInput = await screen.findByTestId("supervisor-timeout");
    const saveButton = await screen.findByTestId("supervisor-save");
    expect(saveButton).toBeEnabled();

    fireEvent.change(timeoutInput, { target: { value: "" } });

    expect(
      screen.getByText(I18nKey.SUPERVISOR$TIMEOUT_INVALID),
    ).toBeInTheDocument();
    expect(saveButton).toBeDisabled();
  });

  // @spec PRJ-206 — Auto re-sync uses freshly-saved settings, not the
  // pre-save render-time snapshot, so a renamed label never creates a stale
  // `Supervisore — <old label>` automation.
  it("creates the automation under the new label after renaming and saving", async () => {
    const projects: Project[] = [
      {
        id: "1",
        name: "App",
        repo_url: "github.com/fab/app",
        locations: [{ host: "http://pc1:8000", path: "/srv/app" }],
      },
    ];
    vi.spyOn(ProjectsService, "getProjects").mockResolvedValue(projects);

    // Stateful settings store (mirroring a real backend) so the sync's own
    // fresh re-fetch, triggered right after Save, observes the rename.
    let stored: SupervisorSettings = {
      enabled: true,
      timezone: "Europe/Rome",
      run_time: "08:00",
      summary_time: "09:00",
      timeout_seconds: 1800,
      summary_tracker: null,
      servers: [{ host: "http://pc1:8000", label: "pc1", enabled: true }],
    };
    vi.spyOn(ProjectsService, "getSupervisorSettings").mockImplementation(
      async () => stored,
    );
    vi.spyOn(ProjectsService, "saveSupervisorSettings").mockImplementation(
      async (_backend, next) => {
        stored = next;
      },
    );
    vi.spyOn(AutomationService, "listAutomationsForBackend").mockResolvedValue({
      automations: [],
      total: 0,
    });
    // `vi.spyOn` re-wraps an already-mocked method in place, so an earlier
    // test's call history on this shared spy would otherwise leak in here.
    const create = vi
      .spyOn(AutomationService, "createAutomationForBackend")
      .mockReset()
      .mockResolvedValue({} as never);
    const user = userEvent.setup();
    renderPanel();

    const labelInput = await screen.findByTestId("supervisor-row-pc1-label");
    fireEvent.change(labelInput, { target: { value: "pc1-renamed" } });
    await user.click(screen.getByTestId("supervisor-save"));

    await vi.waitFor(() =>
      expect(create).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ name: "Supervisore — pc1-renamed" }),
      ),
    );
    expect(create).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ name: "Supervisore — pc1" }),
    );
  });

  // @spec PRJ-207 — "Copy prompt" copies the row's desired prompt verbatim
  describe("copy prompt", () => {
    const originalClipboard = navigator.clipboard;

    afterEach(() => {
      Object.defineProperty(navigator, "clipboard", {
        configurable: true,
        value: originalClipboard,
      });
    });

    // @spec PRJ-207 — Available before enable+save, not only for an
    // already-enabled/persisted row (a spike deploy needs the exact prompt
    // before the supervisor is ever turned on).
    it("copies the row's desired prompt to the clipboard while disabled and never saved", async () => {
      vi.spyOn(ProjectsService, "getProjects").mockResolvedValue([
        {
          id: "1",
          name: "App",
          repo_url: "github.com/fab/app",
          locations: [{ host: "http://pc1:8000", path: "/srv/app" }],
        },
      ]);
      vi.spyOn(ProjectsService, "getSupervisorSettings").mockResolvedValue({
        enabled: false,
        timezone: "Europe/Rome",
        run_time: "08:00",
        summary_time: "09:00",
        timeout_seconds: 1800,
        summary_tracker: null,
        servers: [{ host: "http://pc1:8000", label: "pc1", enabled: false }],
      });
      // `vi.spyOn` re-wraps an already-mocked method in place, so an earlier
      // test's call history on this shared spy would otherwise leak in here.
      const saveSettings = vi
        .spyOn(ProjectsService, "saveSupervisorSettings")
        .mockReset();
      vi.spyOn(
        AutomationService,
        "listAutomationsForBackend",
      ).mockResolvedValue({ automations: [], total: 0 });
      const writeText = vi.fn().mockResolvedValue(undefined);
      const user = userEvent.setup();
      Object.defineProperty(navigator, "clipboard", {
        configurable: true,
        value: { writeText },
      });
      renderPanel();

      await user.click(await screen.findByTestId("supervisor-copy-prompt-pc1"));

      expect(writeText).toHaveBeenCalledTimes(1);
      const [copiedPrompt] = writeText.mock.calls[0];
      expect(copiedPrompt).toContain("<!-- agent-canvas:supervisor v1 -->");
      expect(copiedPrompt).toContain('"App"');
      expect(saveSettings).not.toHaveBeenCalled();
    });
  });
});
