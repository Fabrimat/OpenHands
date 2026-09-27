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

  // @spec PRJ-003 — A legacy `list_id` was never validated against today's
  // stricter ref shape (e.g. a raw URL segment like "6-1-1" with hyphens).
  // The project must survive, just without a tracker — not be dropped
  // entirely by a later `isValidProject` filter (which would erase it from
  // the server on the next `saveProjects`).
  it("drops a legacy clickup field whose list_id fails today's ref shape, keeping the project untracked", () => {
    expect(
      normalizeProjectTracker({
        id: "1",
        clickup: { list_id: "6-1-1", url: "http://x" },
      }),
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
    ).toEqual({
      enabled: true,
      summary_tracker: { provider: "clickup", ref: "LIST1" },
    });
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

  // @spec PRJ-201 — A legacy list id that fails today's stricter ref shape
  // must fall back to `summary_tracker: null` rather than propagate an
  // invalid tracker that would fail `isValidSupervisorSettings` and reset
  // every other persisted setting (timezone, servers, ...) to its default.
  it("falls back to null when the legacy list id fails today's ref shape", () => {
    expect(
      normalizeSupervisorSettingsTracker({
        enabled: true,
        summary_clickup_list_id: "6-1-1",
      }),
    ).toEqual({ enabled: true, summary_tracker: null });
  });
});
