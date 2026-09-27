import { describe, it, expect } from "vitest";
import { isValidProject } from "#/types/project";

const validLocations = [{ host: "http://vps1:8000", path: "/srv/app" }];

// @spec PRJ-003 — Read-time defense: a hostile/malformed tracker `url` must
// not validate, since it is rendered as an `<a href>` in project-card/detail.
describe("isValidProject", () => {
  it("rejects a project whose tracker.url is not http(s)", () => {
    expect(
      isValidProject({
        id: "1",
        name: "App",
        repo_url: "github.com/fab/app",
        locations: validLocations,
        tracker: {
          provider: "clickup",
          ref: "ABC123",
          url: "javascript:alert(1)",
        },
      }),
    ).toBe(false);
  });

  it("accepts a project whose tracker has a valid http(s) url", () => {
    expect(
      isValidProject({
        id: "1",
        name: "App",
        repo_url: "github.com/fab/app",
        locations: validLocations,
        tracker: {
          provider: "clickup",
          ref: "ABC123",
          url: "https://app.clickup.com/1/v/li/900123",
        },
      }),
    ).toBe(true);
  });
});
