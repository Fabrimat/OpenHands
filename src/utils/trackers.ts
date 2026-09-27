import type { TrackerLink, TrackerProviderId } from "#/types/tracker";
import { isHttpUrl } from "./url";

// @spec PRJ-003, PRJ-209 — All provider-specific tracker knowledge (display
// name, URL->ref parsing, ref validation, MCP name, and the prompt fragments
// telling the supervisor agent where/how to write) lives here. Adding a new
// provider (GitHub Issues, Linear, Plane…) means adding one entry to
// `TRACKER_PROVIDERS` plus its union member in `#/types/tracker.ts` — no
// change to supervisor-prompt.ts, supervisor-sync.ts, the project form, the
// project card/detail, or the supervisor panel.
export interface TrackerProvider {
  /** Brand name — not translated (i18next/no-literal-string exemption). */
  displayName: string;
  /** Name of the MCP server the agent uses to write, e.g. "ClickUp MCP". */
  mcpName: string;
  /** Derive a ref from a pasted URL; null when it can't be derived/invalid. */
  refFromUrl(url: string): string | null;
  /** Ref shape guard — refs are interpolated unescaped into prompt prose. */
  isValidRef(ref: string): boolean;
  /** Per-project status + suggestion-task write instructions (fragment a). */
  statusFragment(label: string): string[];
  /** Instruction for projects without a tracker, using the summary tracker's ref (fragment b). */
  noTrackerFragment(label: string, summaryRef: string): string;
  /** The summary task's write instruction (fragment c). */
  summaryFragment(ref: string, timezone: string): string;
  /**
   * The summary's READ instruction: what task/subtask titles and tag it must
   * read across the workspace to compile the summary. Must reuse the same
   * title/tag constants `statusFragment` writes, so read and write can't
   * desync.
   */
  summaryReadFragment(): string;
}

const CLICKUP_REF_PATTERN = /^[A-Za-z0-9]+$/;

// Shared with `summaryReadFragment` below so the summary's read instruction
// can never drift from the exact titles/tag `statusFragment` writes.
const CLICKUP_STATUS_TASK_TITLE = "📊 Stato progetto";
const CLICKUP_STATUS_SUBTASK_PREFIX = "📊 Stato — ";
const CLICKUP_SUGGESTION_TAG = "supervisor-suggestion";

function clickupIsValidRef(ref: string): boolean {
  return CLICKUP_REF_PATTERN.test(ref);
}

function clickupRefFromUrl(url: string): string | null {
  const segment = url.trim().split("/").filter(Boolean).pop();
  return segment && clickupIsValidRef(segment) ? segment : null;
}

export const TRACKER_PROVIDERS: Record<TrackerProviderId, TrackerProvider> = {
  clickup: {
    displayName: "ClickUp",
    mcpName: "ClickUp MCP",
    refFromUrl: clickupRefFromUrl,
    isValidRef: clickupIsValidRef,
    statusFragment: (label) => [
      "Write to ClickUp with the ClickUp MCP:",
      `- In the project's ClickUp list, find the task "${CLICKUP_STATUS_TASK_TITLE}" (create it if missing). Under it, find or create the subtask "${CLICKUP_STATUS_SUBTASK_PREFIX}${label}" and REPLACE its description with: date/time, then one section per path with branch, ahead/behind, uncommitted count, last commit date, and any issue kinds.`,
      `- For each issue, ensure an open task titled exactly "[${label}] <project name>: <kind>" exists with tag "${CLICKUP_SUGGESTION_TAG}" and a one-paragraph proposed action; do not create a duplicate if an open task with that exact title exists.`,
      `- Close every open task tagged "${CLICKUP_SUGGESTION_TAG}" whose title starts with "[${label}] " and whose condition no longer holds.`,
    ],
    noTrackerFragment: (label, ref) =>
      `- Projects whose tracker is null: in the ClickUp list with id "${ref}", find or create the task "📊 Progetti senza lista ClickUp — ${label}" and REPLACE its description with the list of these project names (do not create a duplicate if a task with that exact title already exists).`,
    summaryFragment: (ref, timezone) =>
      `In the ClickUp list with id "${ref}", find or create the task "📊 Riepilogo supervisore" and REPLACE its description with: per project, one line per server status; the open suggestions grouped by project; and a list of servers whose status subtask was NOT updated today (timezone ${timezone}). Then add one comment with today's date and a three-line digest.`,
    summaryReadFragment: () =>
      `Read, across the workspace, every "${CLICKUP_STATUS_TASK_TITLE}" task, its "${CLICKUP_STATUS_SUBTASK_PREFIX}<server>" subtasks, and all open tasks tagged "${CLICKUP_SUGGESTION_TAG}".`,
  },
};

export function isTrackerProviderId(v: unknown): v is TrackerProviderId {
  return typeof v === "string" && Object.hasOwn(TRACKER_PROVIDERS, v);
}

// @spec PRJ-209 — Provider-independent ref safety net: refs are interpolated
// unescaped into prompt prose and task titles, so this bounds every
// provider's ref regardless of that provider's own (possibly lax)
// `isValidRef` — a future provider can't reopen prompt injection just by
// under-validating. Non-empty, bounded length, no whitespace/quotes/
// backticks/control characters.
// eslint-disable-next-line no-control-regex -- intentional: excludes control characters
const SAFE_REF_PATTERN = /^[^\s"'`\x00-\x1F\x7F]{1,128}$/;

export function isSafeRef(ref: string): boolean {
  return SAFE_REF_PATTERN.test(ref);
}

// @spec PRJ-003, PRJ-201 — Shared validator for `Project.tracker` and
// `SupervisorSettings.summary_tracker`: an unknown provider id or a ref that
// fails the safety net above or that provider's own shape guard makes the
// whole tracker invalid. `url`, when present, must be `http:`/`https:` —
// read-time defense against a hostile/malformed persisted `url` (e.g.
// `javascript:...`) that would otherwise render as an `<a href>` in
// project-card/detail.
export function isValidTrackerLink(v: unknown): v is TrackerLink {
  if (typeof v !== "object" || v === null) return false;
  const t = v as Partial<TrackerLink>;
  return (
    isTrackerProviderId(t.provider) &&
    typeof t.ref === "string" &&
    isSafeRef(t.ref) &&
    TRACKER_PROVIDERS[t.provider].isValidRef(t.ref) &&
    (t.url === undefined || (typeof t.url === "string" && isHttpUrl(t.url)))
  );
}
