import { describe, it, expect } from "vitest";
import {
  hostsMatch,
  normalizeRepoUrl,
  matchesProjectLocation,
  matchesProjectRepository,
  resolveLocationBackend,
} from "#/utils/project-matching";
import type { Backend } from "#/api/backend-registry/types";

// @spec PRJ-008 — Path and repo matching
describe("matchesProjectLocation", () => {
  it.each([
    ["/srv/app", "/srv/app", true],
    ["/srv/app/sub", "/srv/app/", true],
    ["/srv/app2", "/srv/app", false],
    ["D:\\Repos\\MyApp\\src", "d:/repos/myapp", true],
    [null, "/srv/app", false],
  ])("%s under %s -> %s", (workingDir, path, expected) => {
    expect(matchesProjectLocation(workingDir, path)).toBe(expected);
  });
});

describe("normalizeRepoUrl", () => {
  it("treats https, ssh shorthand and bare forms as equal", () => {
    const forms = [
      "https://github.com/Fab/MyApp.git",
      "git@github.com:Fab/MyApp.git",
      "github.com/fab/myapp/",
    ].map(normalizeRepoUrl);
    expect(new Set(forms)).toEqual(new Set(["github.com/fab/myapp"]));
  });
});

describe("matchesProjectRepository", () => {
  it("matches owner/repo against the project repo, case-insensitively", () => {
    expect(matchesProjectRepository("github.com/fab/myapp", "Fab/MyApp")).toBe(
      true,
    );
    expect(matchesProjectRepository("github.com/fab/myapp", "fab/other")).toBe(
      false,
    );
    expect(matchesProjectRepository("github.com/fab/myapp", undefined)).toBe(
      false,
    );
  });
});

// @spec PRJ-001 — Locations resolve by normalized host
describe("hostsMatch / resolveLocationBackend", () => {
  const vps: Backend = {
    id: "b1",
    name: "vps1",
    host: "http://vps1:8000",
    apiKey: "k",
    kind: "local",
  };
  const pc: Backend = {
    id: "b2",
    name: "pc",
    host: "http://localhost:8000",
    apiKey: "k",
    kind: "local",
  };

  it("ignores case and trailing slashes, treats loopbacks on the same port as equal", () => {
    expect(hostsMatch("http://VPS1:8000/", "http://vps1:8000")).toBe(true);
    expect(hostsMatch("http://127.0.0.1:8000", "http://localhost:8000")).toBe(
      true,
    );
    expect(hostsMatch("http://127.0.0.1:9000", "http://localhost:8000")).toBe(
      false,
    );
  });

  it("returns null for a host not in the registry", () => {
    expect(
      resolveLocationBackend({ host: "http://vps1:8000/", path: "/x" }, [
        vps,
        pc,
      ]),
    ).toBe(vps);
    expect(
      resolveLocationBackend({ host: "http://vps9:8000", path: "/x" }, [
        vps,
        pc,
      ]),
    ).toBeNull();
  });
});
