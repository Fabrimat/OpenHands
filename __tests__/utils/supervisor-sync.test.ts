import { describe, it, expect } from "vitest";
import {
  buildSupervisorTargets,
  diffAutomation,
  type DesiredAutomation,
} from "#/utils/supervisor-sync";
import { DEFAULT_SUPERVISOR_SETTINGS } from "#/types/supervisor";
import { SUPERVISOR_MARKER } from "#/utils/supervisor-prompt";
import type { Automation } from "#/types/automation";

const desired: DesiredAutomation = {
  name: "Supervisore — vps1",
  prompt: `${SUPERVISOR_MARKER}\nx`,
  trigger: { type: "cron", schedule: "0 8 * * *", timezone: "Europe/Rome" },
  timeout: 1800,
  enabled: true,
};
const existing = (over: Partial<Automation> = {}) =>
  ({
    id: "a1",
    name: desired.name,
    prompt: desired.prompt,
    trigger: desired.trigger,
    timeout: 1800,
    enabled: true,
    created_at: "",
    updated_at: "",
    ...over,
  }) as Automation;

// @spec PRJ-204 — Stateless reconciliation
describe("diffAutomation", () => {
  it.each([
    ["create", undefined, desired],
    ["noop", existing(), desired],
    ["update", existing({ prompt: `${SUPERVISOR_MARKER}\nold` }), desired],
    [
      "update",
      existing({
        trigger: {
          type: "cron",
          schedule: "5 8 * * *",
          timezone: "Europe/Rome",
        },
      }),
      desired,
    ],
    ["disable", existing(), null],
    ["noop", existing({ enabled: false }), null],
    ["noop", undefined, null],
    ["conflict", existing({ prompt: "user prompt" }), desired],
    ["conflict", existing({ prompt: "user prompt" }), null],
  ] as const)("-> %s", (action, ex, want) => {
    expect(diffAutomation(ex, want)).toBe(action);
  });
});

describe("buildSupervisorTargets", () => {
  const vps1 = {
    id: "b1",
    name: "VPS one",
    host: "http://vps1:8000",
    apiKey: "k",
    kind: "local" as const,
  };
  const project = {
    id: "1",
    name: "App",
    repo_url: "github.com/fab/app",
    locations: [{ host: "http://vps1:8000", path: "/srv/app" }],
  };
  const settings = {
    ...DEFAULT_SUPERVISOR_SETTINGS,
    enabled: true,
    summary_tracker: { provider: "clickup" as const, ref: "S" },
    servers: [
      { host: "http://pc1:8000", label: "pc1", enabled: true },
      { host: "http://vps1:8000", label: "vps1", enabled: true },
      { host: "http://gone:8000", label: "gone", enabled: true },
    ],
  };

  it("staggers by server order, disables servers without projects, and marks unregistered hosts", () => {
    const targets = buildSupervisorTargets(settings, [project], [vps1], vps1);
    const byLabel = Object.fromEntries(targets.map((t) => [t.label, t]));
    expect(byLabel.vps1.desired?.trigger.schedule).toBe("5 8 * * *");
    expect(byLabel.pc1.desired).toBeNull(); // no projects on pc1
    expect(byLabel.gone.backend).toBeNull();
    expect(byLabel.summary.desired?.trigger.schedule).toBe("0 9 * * *");
  });

  it("desires nothing when the global switch is off", () => {
    const targets = buildSupervisorTargets(
      { ...settings, enabled: false },
      [project],
      [vps1],
      vps1,
    );
    expect(targets.every((t) => t.desired === null)).toBe(true);
  });
});
