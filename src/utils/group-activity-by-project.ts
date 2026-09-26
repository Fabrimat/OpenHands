import type { Backend } from "#/api/backend-registry/types";
import type { ProjectAutomation } from "#/hooks/query/use-project-data";
import type { Project } from "#/types/project";
import {
  hostsMatch,
  matchesProjectLocation,
  matchesProjectRepository,
} from "#/utils/project-matching";

// @spec PRJ-102, PRJ-103
export const ACTIVE_EXECUTION_STATUSES: ReadonlySet<string> = new Set([
  "running",
  "waiting_for_confirmation",
  "error",
  "stuck",
]);

export interface ActivityConversation {
  id: string;
  title: string;
  updated_at: string | null;
  execution_status: string | null;
  working_dir: string | null;
  backend: Backend;
}

export interface ActivityGroup {
  project: Project | null;
  conversations: ActivityConversation[];
  automations: ProjectAutomation[];
}

function findProjectForConversation(
  conversation: ActivityConversation,
  projects: Project[],
): Project | null {
  return (
    projects.find((project) =>
      project.locations.some(
        (location) =>
          hostsMatch(location.host, conversation.backend.host) &&
          matchesProjectLocation(conversation.working_dir, location.path),
      ),
    ) ?? null
  );
}

function findProjectForAutomation(
  automation: ProjectAutomation,
  projects: Project[],
): Project | null {
  return (
    projects.find((project) =>
      matchesProjectRepository(project.repo_url, automation.repository),
    ) ?? null
  );
}

function sortByUpdatedAtDesc(
  conversations: ActivityConversation[],
): ActivityConversation[] {
  return [...conversations].sort((a, b) =>
    (b.updated_at ?? "").localeCompare(a.updated_at ?? ""),
  );
}

// @spec PRJ-102, PRJ-103
export function groupActivityByProject(
  conversations: ActivityConversation[],
  automations: ProjectAutomation[],
  projects: Project[],
  options: { activeOnly: boolean },
): ActivityGroup[] {
  const filteredConversations = options.activeOnly
    ? conversations.filter(
        (c) =>
          c.execution_status !== null &&
          ACTIVE_EXECUTION_STATUSES.has(c.execution_status),
      )
    : conversations;
  const enabledAutomations = automations.filter((a) => a.enabled);

  const byProjectId = new Map<string, ActivityGroup>(
    projects.map((project) => [
      project.id,
      { project, conversations: [], automations: [] },
    ]),
  );
  const unassigned: ActivityGroup = {
    project: null,
    conversations: [],
    automations: [],
  };

  filteredConversations.forEach((conversation) => {
    const project = findProjectForConversation(conversation, projects);
    const group = project ? byProjectId.get(project.id) : undefined;
    (group ?? unassigned).conversations.push(conversation);
  });

  enabledAutomations.forEach((automation) => {
    const project = findProjectForAutomation(automation, projects);
    const group = project ? byProjectId.get(project.id) : undefined;
    (group ?? unassigned).automations.push(automation);
  });

  const result: ActivityGroup[] = [];
  projects.forEach((project) => {
    const group = byProjectId.get(project.id);
    if (
      group &&
      (group.conversations.length > 0 || group.automations.length > 0)
    ) {
      result.push({
        ...group,
        conversations: sortByUpdatedAtDesc(group.conversations),
      });
    }
  });
  if (
    unassigned.conversations.length > 0 ||
    unassigned.automations.length > 0
  ) {
    result.push({
      ...unassigned,
      conversations: sortByUpdatedAtDesc(unassigned.conversations),
    });
  }

  return result;
}
