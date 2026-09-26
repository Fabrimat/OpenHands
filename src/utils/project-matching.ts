import { isLoopbackUrl } from "#/api/backend-registry/storage";
import type { Backend } from "#/api/backend-registry/types";
import type { ProjectLocation } from "#/types/project";
import { parseGitRemoteUrl } from "./parse-git-remote-url";

// @spec PRJ-008 — Path and repo matching

export function normalizeHost(host: string): string {
  return host.trim().replace(/\/+$/, "").toLowerCase();
}

function portOf(host: string): string {
  try {
    const url = new URL(host);
    return url.port || (url.protocol === "https:" ? "443" : "80");
  } catch {
    return "";
  }
}

export function hostsMatch(a: string, b: string): boolean {
  const na = normalizeHost(a);
  const nb = normalizeHost(b);
  if (na === nb) return true;
  // isLoopbackUrl compares hostnames only, so the port must match too.
  return isLoopbackUrl(na) && isLoopbackUrl(nb) && portOf(na) === portOf(nb);
}

export function normalizeRepoUrl(url: string): string {
  const trimmed = url.trim().replace(/\/+$/, "");
  const parsed =
    parseGitRemoteUrl(trimmed) ?? parseGitRemoteUrl(`https://${trimmed}`);
  if (!parsed) return trimmed.toLowerCase();
  return `${parsed.host}/${parsed.repository}`
    .replace(/\.git$/, "")
    .toLowerCase();
}

function normalizePath(path: string): string {
  const slashed = path.trim().replace(/\\/g, "/").replace(/\/+$/, "");
  // Windows drive paths are case-insensitive; POSIX paths are not.
  return /^[a-zA-Z]:/.test(slashed) ? slashed.toLowerCase() : slashed;
}

export function matchesProjectLocation(
  workingDir: string | null | undefined,
  path: string,
): boolean {
  if (!workingDir) return false;
  const dir = normalizePath(workingDir);
  const root = normalizePath(path);
  if (!root) return false;
  return dir === root || dir.startsWith(`${root}/`);
}

export function matchesProjectRepository(
  projectRepoUrl: string,
  repository: string | null | undefined,
): boolean {
  if (!repository) return false;
  const repo = repository
    .trim()
    .replace(/\.git$/, "")
    .toLowerCase();
  return normalizeRepoUrl(projectRepoUrl).endsWith(`/${repo}`);
}

export function resolveLocationBackend(
  location: ProjectLocation,
  backends: Backend[],
): Backend | null {
  return (
    backends.find(
      (b) => b.kind === "local" && hostsMatch(b.host, location.host),
    ) ?? null
  );
}
