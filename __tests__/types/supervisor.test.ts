import { describe, it, expect } from "vitest";
import {
  DEFAULT_SUPERVISOR_SETTINGS,
  isValidSupervisorSettings,
  isValidTimezone,
} from "#/types/supervisor";

// @spec PRJ-201 — Invalid timezone/timeout/tracker/label must not be
// accepted as valid persisted settings (guards a silent reset to defaults).
describe("isValidTimezone", () => {
  it.each([
    ["Europe/Rome", true],
    ["Not/AZone", false],
    ["", false],
  ])("%s -> %s", (tz, want) => {
    expect(isValidTimezone(tz)).toBe(want);
  });
});

describe("isValidSupervisorSettings", () => {
  it("accepts the defaults", () => {
    expect(isValidSupervisorSettings(DEFAULT_SUPERVISOR_SETTINGS)).toBe(true);
  });

  it.each([
    ["invalid timezone", { timezone: "Not/AZone" }],
    ["timeout below the floor", { timeout_seconds: 59 }],
    ["timeout above the ceiling", { timeout_seconds: 86401 }],
    ["non-integer timeout", { timeout_seconds: 1800.5 }],
    [
      "non-alphanumeric tracker ref",
      { summary_tracker: { provider: "clickup", ref: "abc-123" } },
    ],
    [
      "unknown tracker provider",
      { summary_tracker: { provider: "bogus", ref: "ABC123" } },
    ],
  ])("rejects %s", (_name, patch) => {
    expect(
      isValidSupervisorSettings({ ...DEFAULT_SUPERVISOR_SETTINGS, ...patch }),
    ).toBe(false);
  });

  it("accepts a null summary_tracker (no summary)", () => {
    expect(
      isValidSupervisorSettings({
        ...DEFAULT_SUPERVISOR_SETTINGS,
        summary_tracker: null,
      }),
    ).toBe(true);
  });

  it.each([
    ["uppercase letters", "VPS1"],
    ["spaces", "vps 1"],
    ["empty", ""],
  ])("rejects a server label with %s", (_name, label) => {
    expect(
      isValidSupervisorSettings({
        ...DEFAULT_SUPERVISOR_SETTINGS,
        servers: [{ host: "http://vps1:8000", label, enabled: true }],
      }),
    ).toBe(false);
  });
});
