import type { TrackerLink } from "#/types/tracker";
import { isValidTrackerLink } from "./trackers";

// @spec PRJ-003, PRJ-201 — Migrate legacy ClickUp-only persisted shapes to
// the generic `tracker` / `summary_tracker` fields on READ, so upgrading
// never loses previously-saved data. Validation (via `isValidProject` /
// `isValidSupervisorSettings`) always runs AFTER this normalizer.

// Name of the pre-tracker-abstraction settings field that `summary_tracker`
// replaced. `saveSupervisorSettings` also sends this key set to `null` so a
// deep-merged write deletes it server-side instead of leaving it to linger.
export const LEGACY_SUMMARY_TRACKER_KEY = "summary_clickup_list_id";

// Name of the pre-tracker-abstraction `Project` field that `tracker` replaced.
export const LEGACY_PROJECT_TRACKER_KEY = "clickup";

interface LegacyClickup {
  list_id: string;
  url: string;
}

function isLegacyClickup(v: unknown): v is LegacyClickup {
  if (typeof v !== "object" || v === null) return false;
  const c = v as Partial<LegacyClickup>;
  return typeof c.list_id === "string" && typeof c.url === "string";
}

// Project: legacy `clickup: {list_id, url}` -> `tracker: {provider, ref, url}`.
// If `tracker` is already present it wins and the legacy key is dropped
// either way, so a save never resurrects it. A legacy `list_id` was never
// validated against today's stricter ref shape (old values can contain
// hyphens, query strings, etc.) — attach the migrated tracker only if it
// actually validates; otherwise drop it (same as the malformed-shape branch)
// so the project itself survives instead of being filtered out by
// `isValidProject` and erased on the next `saveProjects`.
export function normalizeProjectTracker(raw: unknown): unknown {
  if (typeof raw !== "object" || raw === null) return raw;
  const obj = { ...(raw as Record<string, unknown>) };
  if (!(LEGACY_PROJECT_TRACKER_KEY in obj)) return raw;
  const legacy = obj[LEGACY_PROJECT_TRACKER_KEY];
  delete obj[LEGACY_PROJECT_TRACKER_KEY];
  if (obj.tracker !== undefined) return obj;
  if (isLegacyClickup(legacy)) {
    const tracker: TrackerLink = {
      provider: "clickup",
      ref: legacy.list_id,
      url: legacy.url,
    };
    if (isValidTrackerLink(tracker)) return { ...obj, tracker };
  }
  return obj;
}

// Supervisor settings: the legacy list-id field (string, `""` = no summary,
// `null` once a save has cleared it) -> `summary_tracker`. If `summary_tracker`
// is already present it wins; the legacy key is dropped either way. A
// migrated tracker that doesn't validate (same stricter-ref-shape concern as
// `normalizeProjectTracker`) falls back to `null` rather than invalidating
// the whole settings object (which would silently reset every other field to
// its default via the isValidSupervisorSettings guard).
export function normalizeSupervisorSettingsTracker(raw: unknown): unknown {
  if (typeof raw !== "object" || raw === null) return raw;
  const obj = { ...(raw as Record<string, unknown>) };
  const legacy = obj[LEGACY_SUMMARY_TRACKER_KEY];
  delete obj[LEGACY_SUMMARY_TRACKER_KEY];
  if (obj.summary_tracker !== undefined) return obj;
  if (typeof legacy === "string" && legacy !== "") {
    const summary_tracker: TrackerLink = { provider: "clickup", ref: legacy };
    if (isValidTrackerLink(summary_tracker)) return { ...obj, summary_tracker };
  }
  return { ...obj, summary_tracker: null };
}
