import { describe, it, expect } from "vitest";
import {
  groupActivityByProject,
  type ActivityConversation,
} from "#/utils/group-activity-by-project";
import type { Backend } from "#/api/backend-registry/types";
import type { ProjectAutomation } from "#/hooks/query/use-project-data";
import type { Project } from "#/types/project";

const pc: Backend = {
  id: "a",
  name: "pc",
  host: "http://pc:8000",
  apiKey: "k",
  kind: "local",
};
const vps: Backend = {
  id: "b",
  name: "vps",
  host: "http://vps:8000",
  apiKey: "k",
  kind: "local",
};

const project: Project = {
  id: "1",
  name: "App",
  repo_url: "github.com/fab/app",
  locations: [{ host: "http://pc:8000", path: "/repo/app" }],
};

function conversation(
  overrides: Partial<ActivityConversation>,
): ActivityConversation {
  return {
    id: "c1",
    title: "c1",
    updated_at: "2026-09-01T00:00:00Z",
    execution_status: null,
    working_dir: null,
    backend: pc,
    ...overrides,
  };
}

function automation(overrides: Partial<ProjectAutomation>): ProjectAutomation {
  return {
    id: "auto1",
    name: "auto1",
    trigger: { type: "cron" },
    enabled: true,
    created_at: "2026-09-01T00:00:00Z",
    updated_at: "2026-09-01T00:00:00Z",
    prompt: null,
    backend: pc,
    ...overrides,
  };
}

// @spec PRJ-102, PRJ-103
describe("groupActivityByProject", () => {
  it("assigns a conversation on a matching host+path to its project, and to Unassigned on a different host", () => {
    const matching = conversation({ id: "c1", working_dir: "/repo/app" });
    const wrongHost = conversation({
      id: "c2",
      working_dir: "/repo/app",
      backend: vps,
    });

    const groups = groupActivityByProject(
      [matching, wrongHost],
      [],
      [project],
      { activeOnly: false },
    );

    expect(groups).toHaveLength(2);
    expect(groups[0]).toMatchObject({
      project,
      conversations: [{ id: "c1" }],
    });
    expect(groups[1]).toMatchObject({
      project: null,
      conversations: [{ id: "c2" }],
    });
  });

  it("hides idle conversations when activeOnly is set, but keeps running ones", () => {
    const idle = conversation({
      id: "c1",
      working_dir: "/repo/app",
      execution_status: "idle",
    });
    const running = conversation({
      id: "c2",
      working_dir: "/repo/app",
      execution_status: "running",
    });

    const groups = groupActivityByProject([idle, running], [], [project], {
      activeOnly: true,
    });

    expect(groups).toHaveLength(1);
    expect(groups[0].conversations.map((c) => c.id)).toEqual(["c2"]);
  });

  it("excludes disabled automations and groups enabled ones by repository match", () => {
    const disabled = automation({
      id: "d1",
      enabled: false,
      repository: "fab/app",
    });
    const enabled = automation({
      id: "e1",
      enabled: true,
      repository: "fab/app",
    });

    const groups = groupActivityByProject([], [disabled, enabled], [project], {
      activeOnly: false,
    });

    expect(groups).toHaveLength(1);
    expect(groups[0].automations.map((a) => a.id)).toEqual(["e1"]);
  });

  it("omits empty project groups and puts a non-empty Unassigned group last", () => {
    const emptyProject: Project = {
      id: "2",
      name: "Empty",
      repo_url: "github.com/fab/empty",
      locations: [{ host: "http://pc:8000", path: "/repo/empty" }],
    };
    const unassignedConversation = conversation({
      id: "c1",
      working_dir: "/repo/unowned",
    });

    const groups = groupActivityByProject(
      [unassignedConversation],
      [],
      [emptyProject, project],
      { activeOnly: false },
    );

    expect(groups).toHaveLength(1);
    expect(groups[0].project).toBeNull();
  });
});
