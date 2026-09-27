import { describe, it, expect } from "vitest";
import {
  normalizeProjectTracker,
  normalizeSupervisorSettingsTracker,
} from "#/utils/tracker-migration";

// @spec PRJ-003 — Migration on read: legacy `clickup` project field
describe("normalizeProjectTracker", () => {
  it("migrates a legacy clickup field to tracker", () => {
    expect(
      normalizeProjectTracker({
        id: "1",
        clickup: { list_id: "L1", url: "http://x" },
      }),
    ).toEqual({
      id: "1",
      tracker: { provider: "clickup", ref: "L1", url: "http://x" },
    });
  });

  it("prefers an already-present tracker over the legacy clickup field", () => {
    expect(
      normalizeProjectTracker({
        id: "1",
        clickup: { list_id: "OLD", url: "http://old" },
        tracker: { provider: "clickup", ref: "NEW" },
      }),
    ).toEqual({ id: "1", tracker: { provider: "clickup", ref: "NEW" } });
  });

  it("drops a malformed legacy clickup field without adding a tracker", () => {
    expect(
      normalizeProjectTracker({ id: "1", clickup: { list_id: 5 } }),
    ).toEqual({ id: "1" });
  });

  it("passes through projects with neither field unchanged", () => {
    const project = { id: "1", name: "App" };
    expect(normalizeProjectTracker(project)).toBe(project);
  });

  it("passes through non-object input unchanged", () => {
    expect(normalizeProjectTracker("junk")).toBe("junk");
  });
});

// @spec PRJ-003, PRJ-201 — Migration on read: legacy summary list id
describe("normalizeSupervisorSettingsTracker", () => {
  it("maps a non-empty legacy list id to summary_tracker", () => {
    expect(
      normalizeSupervisorSettingsTracker({
        enabled: true,
        summary_clickup_list_id: "LIST1",
      }),
    ).toEqual({ enabled: true, summary_tracker: { provider: "clickup", ref: "LIST1" } });
  });

  it("maps an empty legacy list id to null", () => {
    expect(
      normalizeSupervisorSettingsTracker({
        enabled: true,
        summary_clickup_list_id: "",
      }),
    ).toEqual({ enabled: true, summary_tracker: null });
  });

  it("accepts a null legacy list id (post-clear) as no summary", () => {
    expect(
      normalizeSupervisorSettingsTracker({
        enabled: true,
        summary_clickup_list_id: null,
      }),
    ).toEqual({ enabled: true, summary_tracker: null });
  });

  it("prefers an already-present summary_tracker over the legacy field", () => {
    expect(
      normalizeSupervisorSettingsTracker({
        enabled: true,
        summary_clickup_list_id: "OLD",
        summary_tracker: { provider: "clickup", ref: "NEW" },
      }),
    ).toEqual({
      enabled: true,
      summary_tracker: { provider: "clickup", ref: "NEW" },
    });
  });

  it("defaults to null when neither field is present", () => {
    expect(normalizeSupervisorSettingsTracker({ enabled: true })).toEqual({
      enabled: true,
      summary_tracker: null,
    });
  });
});
