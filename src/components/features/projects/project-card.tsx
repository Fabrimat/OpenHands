import { useTranslation } from "react-i18next";
import type { Backend } from "#/api/backend-registry/types";
import type { BackendHealth } from "#/hooks/query/use-backends-health";
import { BackendStatusDot } from "#/components/features/backends/backend-status-dot";
import { NavigationLink } from "#/components/shared/navigation-link";
import {
  useProjectAutomations,
  useProjectConversations,
} from "#/hooks/query/use-project-data";
import { I18nKey } from "#/i18n/declaration";
import type { Project } from "#/types/project";
import { resolveLocationBackend } from "#/utils/project-matching";

interface ProjectCardCountsProps {
  project: Project;
}

/**
 * Mounted per card so the conversation/automation fetches are scoped to
 * each project; React Query dedupes the underlying per-backend queries
 * across cards since the query key is per backend, not per project.
 */
function ProjectCardCounts({ project }: ProjectCardCountsProps) {
  const { t } = useTranslation("openhands");
  const { conversations } = useProjectConversations(project);
  const { automations } = useProjectAutomations(project);
  return (
    <div className="flex gap-3 text-xs text-[var(--oh-muted)]">
      <span>
        {t(I18nKey.PROJECTS$CONVERSATIONS)}: {conversations.length}
      </span>
      <span>
        {t(I18nKey.PROJECTS$AUTOMATIONS)}: {automations.length}
      </span>
    </div>
  );
}

interface ProjectCardProps {
  project: Project;
  backends: Backend[];
  health: Record<string, BackendHealth>;
}

// @spec PRJ-005 — Projects list
export function ProjectCard({ project, backends, health }: ProjectCardProps) {
  const { t } = useTranslation("openhands");
  return (
    <li
      data-testid={`project-card-${project.id}`}
      className="flex flex-col gap-2 rounded-lg border border-[var(--oh-border)] bg-base-secondary p-4"
    >
      <NavigationLink
        to={`/projects/${project.id}`}
        className="text-sm font-medium text-white hover:underline"
      >
        {project.name}
      </NavigationLink>
      <span className="text-xs text-[var(--oh-muted)]">{project.repo_url}</span>
      <ul className="flex flex-col gap-1">
        {project.locations.map((loc) => {
          const backend = resolveLocationBackend(loc, backends);
          const connected = backend
            ? (health[backend.id]?.isConnected ?? null)
            : null;
          return (
            <li
              key={`${loc.host}${loc.path}`}
              title={backend?.name ?? t(I18nKey.PROJECTS$SERVER_NOT_REGISTERED)}
              className="flex items-center gap-2 text-xs text-[var(--oh-text-tertiary)]"
            >
              <BackendStatusDot isConnected={connected} />
              {backend?.name ?? loc.host}
            </li>
          );
        })}
      </ul>
      <ProjectCardCounts project={project} />
      {project.clickup?.url ? (
        <a
          href={project.clickup.url}
          target="_blank"
          rel="noreferrer"
          className="text-xs text-primary hover:underline w-fit"
        >
          {t(I18nKey.PROJECTS$OPEN_CLICKUP)}
        </a>
      ) : null}
    </li>
  );
}
