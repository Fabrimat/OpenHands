import type { Backend } from "#/api/backend-registry/types";
import type { Automation } from "#/types/automation";
import type { Project } from "#/types/project";
import type { SupervisorSettings } from "#/types/supervisor";
import { hostsMatch, normalizeHost } from "./project-matching";
import {
  SUMMARY_AUTOMATION_NAME,
  SUPERVISOR_MARKER,
  buildServerSupervisorPrompt,
  buildSummaryPrompt,
  projectsForHost,
  supervisorAutomationName,
  supervisorCronSchedule,
} from "./supervisor-prompt";

export const SUPERVISOR_STAGGER_MINUTES = 5;
export const SUMMARY_TARGET_KEY = "summary";

export interface DesiredAutomation {
  name: string;
  prompt: string;
  trigger: { type: "cron"; schedule: string; timezone: string };
  timeout: number;
  enabled: boolean;
}

export interface ServerTarget {
  key: string;
  label: string;
  backend: Backend | null;
  desired: DesiredAutomation | null;
}

export type SyncAction = "create" | "update" | "disable" | "noop" | "conflict";

function findBackend(host: string, backends: Backend[]): Backend | null {
  return (
    backends.find((b) => b.kind === "local" && hostsMatch(b.host, host)) ?? null
  );
}

// @spec PRJ-204 — Stateless reconciliation
export function buildSupervisorTargets(
  settings: SupervisorSettings,
  projects: Project[],
  backends: Backend[],
  primary: Backend | null,
): ServerTarget[] {
  const desiredFor = (
    name: string,
    prompt: string,
    time: string,
    offset: number,
  ): DesiredAutomation => ({
    name,
    prompt,
    trigger: {
      type: "cron",
      schedule: supervisorCronSchedule(time, offset),
      timezone: settings.timezone,
    },
    // ponytail: server max timeout is not fetched; a server that rejects it shows the API error on its row.
    timeout: settings.timeout_seconds,
    enabled: true,
  });

  const serverTargets = settings.servers.map((server, index): ServerTarget => {
    const own = projectsForHost(projects, server.host);
    const wanted = settings.enabled && server.enabled && own.length > 0;
    return {
      key: normalizeHost(server.host),
      label: server.label,
      backend: findBackend(server.host, backends),
      desired: wanted
        ? desiredFor(
            supervisorAutomationName(server.label),
            buildServerSupervisorPrompt(
              server.label,
              own,
              settings.summary_tracker,
            ),
            settings.run_time,
            index * SUPERVISOR_STAGGER_MINUTES,
          )
        : null,
    };
  });

  const activeLabels = serverTargets
    .filter((t) => t.desired)
    .map((t) => t.label);
  const summary: ServerTarget = {
    key: SUMMARY_TARGET_KEY,
    label: SUMMARY_TARGET_KEY,
    backend: primary,
    desired:
      settings.enabled && activeLabels.length > 0 && settings.summary_tracker
        ? desiredFor(
            SUMMARY_AUTOMATION_NAME,
            buildSummaryPrompt(settings, activeLabels),
            settings.summary_time,
            0,
          )
        : null,
  };
  return [...serverTargets, summary];
}

function sameTrigger(
  a: Automation["trigger"],
  b: DesiredAutomation["trigger"],
): boolean {
  return (
    a?.schedule === b.schedule &&
    a?.timezone === b.timezone &&
    a?.type !== "event"
  );
}

export function diffAutomation(
  existing: Automation | undefined,
  desired: DesiredAutomation | null,
): SyncAction {
  if (!existing) return desired ? "create" : "noop";
  if (!existing.prompt?.startsWith(SUPERVISOR_MARKER)) return "conflict";
  if (!desired) return existing.enabled ? "disable" : "noop";
  const same =
    existing.prompt === desired.prompt &&
    sameTrigger(existing.trigger, desired.trigger) &&
    (existing.timeout ?? null) === desired.timeout &&
    existing.enabled === desired.enabled;
  return same ? "noop" : "update";
}
