import React from "react";
import { useTranslation } from "react-i18next";
import { BrandButton } from "#/components/features/settings/brand-button";
import { useActiveBackendContext } from "#/contexts/active-backend-context";
import { useBackendsHealth } from "#/hooks/query/use-backends-health";
import {
  usePrimaryBackend,
  useProjects,
  useSaveProjects,
} from "#/hooks/query/use-projects";
import { I18nKey } from "#/i18n/declaration";
import type { Project } from "#/types/project";
import { displayErrorToast } from "#/utils/custom-toast-handlers";
import { ProjectCard } from "./project-card";
import { ProjectFormModal } from "./project-form-modal";

// @spec PRJ-005 — Projects list
export function ProjectsList() {
  const { t } = useTranslation("openhands");
  const { backends } = useActiveBackendContext();
  const health = useBackendsHealth(backends);
  const primary = usePrimaryBackend();
  const projects = useProjects();
  const save = useSaveProjects();
  const [isCreating, setIsCreating] = React.useState(false);

  if (!primary) return <p>{t(I18nKey.PROJECTS$NO_PRIMARY)}</p>;

  // @spec PRJ-007 — Primary unreachable: no local fallback, no stale save
  if (projects.isError) {
    return (
      <div role="alert">
        <p>{t(I18nKey.PROJECTS$PRIMARY_UNREACHABLE, { name: primary.name })}</p>
        <BrandButton
          type="button"
          variant="secondary"
          testId="projects-retry"
          onClick={() => projects.refetch()}
        >
          {t(I18nKey.PROJECTS$RETRY)}
        </BrandButton>
      </div>
    );
  }
  if (!projects.data) return null;

  const create = async (project: Project) => {
    try {
      await save.mutateAsync((current) => [...current, project]);
      setIsCreating(false);
    } catch {
      displayErrorToast(t(I18nKey.PROJECTS$SAVE_FAILED));
    }
  };

  return (
    <section className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-xl font-medium leading-6 text-foreground">
          {t(I18nKey.PROJECTS$TITLE)}
        </h1>
        <BrandButton
          type="button"
          variant="primary"
          testId="projects-new"
          onClick={() => setIsCreating(true)}
        >
          {t(I18nKey.PROJECTS$NEW)}
        </BrandButton>
      </div>
      {projects.data.length === 0 ? <p>{t(I18nKey.PROJECTS$EMPTY)}</p> : null}
      <ul className="flex flex-col gap-3">
        {projects.data.map((p) => (
          <ProjectCard
            key={p.id}
            project={p}
            backends={backends}
            health={health}
          />
        ))}
      </ul>
      {isCreating ? (
        <ProjectFormModal
          onClose={() => setIsCreating(false)}
          onSubmit={create}
        />
      ) : null}
    </section>
  );
}
