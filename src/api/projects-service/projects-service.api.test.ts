import { beforeEach, describe, it, expect, vi } from "vitest";
import type { Backend } from "#/api/backend-registry/types";
import { DEFAULT_SUPERVISOR_SETTINGS } from "#/types/supervisor";
import type { TrackerProviderId } from "#/types/tracker";
import { TRACKER_PROVIDERS } from "#/utils/trackers";
import {
  LEGACY_PROJECT_TRACKER_KEY,
  LEGACY_SUMMARY_TRACKER_KEY,
} from "#/utils/tracker-migration";

// The only registered provider today; referenced by variable (rather than
// hardcoding the provider id) so this file has no provider-specific literal
// text of its own — all such knowledge stays in trackers.ts /
// tracker-migration.ts.
const [provider] = Object.keys(TRACKER_PROVIDERS) as TrackerProviderId[];

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

  // @spec PRJ-003, PRJ-201 — Migration on read: legacy field wins only when
  // the new field is absent (a real legacy blob never had `summary_tracker`)
  it("migrates a legacy summary tracker id to summary_tracker on read", async () => {
    const { summary_tracker: _omit, ...legacyBase } =
      DEFAULT_SUPERVISOR_SETTINGS;
    getSettings.mockResolvedValue({
      misc_settings: {
        supervisor: { ...legacyBase, [LEGACY_SUMMARY_TRACKER_KEY]: "LIST1" },
      },
    });
    const result = await ProjectsService.getSupervisorSettings(primary);
    expect(result.summary_tracker).toEqual({ provider, ref: "LIST1" });
  });

  it("saves the whole object through misc_settings_diff, clearing the legacy field", async () => {
    updateSettings.mockResolvedValue({});
    const settings = { ...DEFAULT_SUPERVISOR_SETTINGS, enabled: true };
    await ProjectsService.saveSupervisorSettings(primary, settings);
    expect(updateSettings).toHaveBeenCalledWith({
      misc_settings_diff: {
        supervisor: { ...settings, [LEGACY_SUMMARY_TRACKER_KEY]: null },
      },
    });
  });
});

// @spec PRJ-003 — Migration on read: legacy tracker field
describe("ProjectsService project tracker migration", () => {
  beforeEach(() => vi.clearAllMocks());

  it("migrates a legacy tracker field to tracker on read", async () => {
    getSettings.mockResolvedValue({
      misc_settings: {
        projects: [
          {
            ...project,
            [LEGACY_PROJECT_TRACKER_KEY]: { list_id: "L1", url: "http://x" },
          },
        ],
      },
    });
    const result = await ProjectsService.getProjects(primary);
    expect(result).toEqual([
      { ...project, tracker: { provider, ref: "L1", url: "http://x" } },
    ]);
  });

  it("drops an invalid tracker provider instead of keeping the project invalid-but-present", async () => {
    getSettings.mockResolvedValue({
      misc_settings: {
        projects: [
          { ...project, id: "2", tracker: { provider: "bogus", ref: "x" } },
        ],
      },
    });
    expect(await ProjectsService.getProjects(primary)).toEqual([]);
  });
});
