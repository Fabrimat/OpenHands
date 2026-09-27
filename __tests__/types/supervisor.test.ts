import { describe, it, expect } from "vitest";
import {
  DEFAULT_SUPERVISOR_SETTINGS,
  isValidSupervisorSettings,
  isValidTimezone,
} from "#/types/supervisor";

// @spec PRJ-201 — Invalid timezone/timeout/list-id/label must not be
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
    ["non-alphanumeric list id", { summary_clickup_list_id: "abc-123" }],
  ])("rejects %s", (_name, patch) => {
    expect(
      isValidSupervisorSettings({ ...DEFAULT_SUPERVISOR_SETTINGS, ...patch }),
    ).toBe(false);
  });

  it("accepts an empty summary_clickup_list_id (no summary)", () => {
    expect(
      isValidSupervisorSettings({
        ...DEFAULT_SUPERVISOR_SETTINGS,
        summary_clickup_list_id: "",
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
