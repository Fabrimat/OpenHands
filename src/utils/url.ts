// Minor — Tracker URL: only `http:`/`https:` links are accepted, both as a
// read-time defense against malformed/hostile persisted data (e.g. a
// `javascript:` URL rendered as an `<a href>` in project-card/detail) and by
// the project form's own input validation. Kept in its own tiny module so
// both `#/types/project.ts` and `#/utils/trackers.ts` can use it without an
// import cycle between them.
export function isHttpUrl(value: string): boolean {
  try {
    return ["http:", "https:"].includes(new URL(value).protocol);
  } catch {
    return false;
  }
}
