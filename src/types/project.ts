// @spec PRJ-001 — Projects persist on the primary server
import type { TrackerLink } from "./tracker";
import { isValidTrackerLink } from "#/utils/trackers";

export interface ProjectLocation {
  host: string;
  path: string;
}

export interface Project {
  id: string;
  name: string;
  repo_url: string;
  locations: ProjectLocation[];
  tracker?: TrackerLink;
  notes?: string;
}

function isValidLocation(v: unknown): v is ProjectLocation {
  if (typeof v !== "object" || v === null) return false;
  const l = v as Partial<ProjectLocation>;
  return typeof l.host === "string" && typeof l.path === "string";
}

// Minor — Tracker URL: only `http:`/`https:` links are accepted by the
// project form (defense against malformed input).
export function isHttpUrl(value: string): boolean {
  try {
    return ["http:", "https:"].includes(new URL(value).protocol);
  } catch {
    return false;
  }
}

export function isValidProject(v: unknown): v is Project {
  if (typeof v !== "object" || v === null) return false;
  const p = v as Partial<Project>;
  return (
    typeof p.id === "string" &&
    p.id.length > 0 &&
    typeof p.name === "string" &&
    typeof p.repo_url === "string" &&
    Array.isArray(p.locations) &&
    p.locations.every(isValidLocation) &&
    (p.tracker === undefined || isValidTrackerLink(p.tracker))
  );
}
