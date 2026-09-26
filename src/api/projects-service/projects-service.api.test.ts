import { beforeEach, describe, it, expect, vi } from "vitest";
import type { Backend } from "#/api/backend-registry/types";
import { DEFAULT_SUPERVISOR_SETTINGS } from "#/types/supervisor";

const getSettings = vi.hoisted(() => vi.fn());
const updateSettings = vi.hoisted(() => vi.fn());
const ctor = vi.hoisted(() => vi.fn());
vi.mock("@openhands/typescript-client/clients", () => ({
  SettingsClient: vi.fn(function SettingsClientMock(options: unknown) {
    ctor(options);
    return { getSettings, updateSettings };
  }),
}));

import { ProjectsService } from "./projects-service.api";

const primary: Backend = {
  id: "p",
  name: "vps1",
  host: "http://vps1:8000",
  apiKey: "secret",
  kind: "local",
};
const project = {
  id: "1",
  name: "App",
  repo_url: "github.com/fab/app",
  locations: [{ host: "http://vps1:8000", path: "/srv/app" }],
};

// @spec PRJ-001 — Projects persist on the primary server
describe("ProjectsService", () => {
  beforeEach(() => vi.clearAllMocks());

  it("reads projects from the primary host and drops invalid entries", async () => {
    getSettings.mockResolvedValue({
      misc_settings: { projects: [project, { id: 3 }, "junk"] },
    });
    const result = await ProjectsService.getProjects(primary);
    expect(ctor).toHaveBeenCalledWith(
      expect.objectContaining({ host: "http://vps1:8000", apiKey: "secret" }),
    );
    expect(result).toEqual([project]);
  });

  it("returns an empty list when misc_settings.projects is not an array", async () => {
    getSettings.mockResolvedValue({ misc_settings: { projects: "oops" } });
    expect(await ProjectsService.getProjects(primary)).toEqual([]);
  });

  it("saves the full array through misc_settings_diff", async () => {
    updateSettings.mockResolvedValue({});
    await ProjectsService.saveProjects(primary, [project]);
    expect(updateSettings).toHaveBeenCalledWith({
      misc_settings_diff: { projects: [project] },
    });
  });
});

// @spec PRJ-201 — Supervisor settings persist on the primary server
describe("ProjectsService supervisor settings", () => {
  beforeEach(() => vi.clearAllMocks());

  it("falls back to disabled defaults when stored settings are invalid", async () => {
    getSettings.mockResolvedValue({
      misc_settings: { supervisor: { enabled: true, run_time: "25:00" } },
    });
    expect(await ProjectsService.getSupervisorSettings(primary)).toEqual(
      DEFAULT_SUPERVISOR_SETTINGS,
    );
  });

  it("saves the whole object through misc_settings_diff", async () => {
    updateSettings.mockResolvedValue({});
    const settings = { ...DEFAULT_SUPERVISOR_SETTINGS, enabled: true };
    await ProjectsService.saveSupervisorSettings(primary, settings);
    expect(updateSettings).toHaveBeenCalledWith({
      misc_settings_diff: { supervisor: settings },
    });
  });
});
