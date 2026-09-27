// @spec PRJ-201 — Supervisor settings persist on the primary server
export const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

// @spec PRJ-209 — Restrict label/list-id shape so both are safe to interpolate
// into prompt prose and ClickUp task titles without escaping.
export const LABEL_PATTERN = /^[a-z0-9-]{1,32}$/;
export const LIST_ID_PATTERN = /^[A-Za-z0-9]*$/; // empty allowed = no summary

export const TIMEOUT_MIN_SECONDS = 60;
export const TIMEOUT_MAX_SECONDS = 86400;

export interface SupervisorServer {
  host: string;
  label: string;
  enabled: boolean;
}

export interface SupervisorSettings {
  enabled: boolean;
  timezone: string;
  run_time: string;
  summary_time: string;
  timeout_seconds: number;
  summary_clickup_list_id: string;
  servers: SupervisorServer[];
}

export const DEFAULT_SUPERVISOR_SETTINGS: SupervisorSettings = {
  enabled: false,
  timezone: "Europe/Rome",
  run_time: "08:00",
  summary_time: "09:00",
  timeout_seconds: 1800,
  summary_clickup_list_id: "",
  servers: [],
};

// @spec PRJ-201 — Invalid IANA timezones must not be accepted as valid
// settings (guards against a silent-reset-to-defaults surprise and against
// an unusable cron trigger being sent to the automation service).
export function isValidTimezone(tz: unknown): tz is string {
  if (typeof tz !== "string" || tz.trim() === "") return false;
  try {
    new Intl.DateTimeFormat("en", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

function isValidServer(v: unknown): v is SupervisorServer {
  if (typeof v !== "object" || v === null) return false;
  const s = v as Partial<SupervisorServer>;
  return (
    typeof s.host === "string" &&
    typeof s.label === "string" &&
    LABEL_PATTERN.test(s.label) &&
    typeof s.enabled === "boolean"
  );
}

export function isValidSupervisorSettings(v: unknown): v is SupervisorSettings {
  if (typeof v !== "object" || v === null) return false;
  const s = v as Partial<SupervisorSettings>;
  return (
    typeof s.enabled === "boolean" &&
    isValidTimezone(s.timezone) &&
    typeof s.run_time === "string" &&
    TIME_PATTERN.test(s.run_time) &&
    typeof s.summary_time === "string" &&
    TIME_PATTERN.test(s.summary_time) &&
    typeof s.timeout_seconds === "number" &&
    Number.isInteger(s.timeout_seconds) &&
    s.timeout_seconds >= TIMEOUT_MIN_SECONDS &&
    s.timeout_seconds <= TIMEOUT_MAX_SECONDS &&
    typeof s.summary_clickup_list_id === "string" &&
    LIST_ID_PATTERN.test(s.summary_clickup_list_id) &&
    Array.isArray(s.servers) &&
    s.servers.every(isValidServer)
  );
}
