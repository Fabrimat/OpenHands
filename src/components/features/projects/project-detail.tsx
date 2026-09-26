import React from "react";
import { useTranslation } from "react-i18next";
import { useQueryClient } from "@tanstack/react-query";
import type { Backend } from "#/api/backend-registry/types";
import AgentServerConversationService from "#/api/conversation-service/agent-server-conversation-service.api";
import { BrandButton } from "#/components/features/settings/brand-button";
import { NavigationLink } from "#/components/shared/navigation-link";
import { useNavigation } from "#/context/navigation-context";
import {
  useProjectAutomations,
  useProjectConversations,
} from "#/hooks/query/use-project-data";
import { useProjects, useSaveProjects } from "#/hooks/query/use-projects";
import { useSwitchBackend } from "#/hooks/use-switch-backend";
import { useTracking } from "#/hooks/use-tracking";
import { I18nKey } from "#/i18n/declaration";
import type { Project } from "#/types/project";
import { displayErrorToast } from "#/utils/custom-toast-handlers";
import { ProjectFormModal } from "./project-form-modal";
import { ProjectLocationRow } from "./project-location-row";

export function ProjectDetail({ projectId }: { projectId: string }) {
  const { t } = useTranslation("openhands");
  const projects = useProjects();
  const project = projects.data?.find((p) => p.id === projectId);

  if (projects.isLoading) return null;
  if (!project) return <p>{t(I18nKey.PROJECTS$NOT_FOUND)}</p>;
  return <ProjectDetailBody project={project} all={projects.data ?? []} />;
}

function ProjectDetailBody({
  project,
  all,
}: {
  project: Project;
  all: Project[];
}) {
  const { t } = useTranslation("openhands");
  const { navigate } = useNavigation();
  const switchBackend = useSwitchBackend();
  const save = useSaveProjects();
  const queryClient = useQueryClient();
  const { trackConversationCreated } = useTracking();
  const { locations, conversations } = useProjectConversations(project);
  const { automations, failedBackendIds } = useProjectAutomations(project);
  const [editing, setEditing] = React.useState(false);
  const [confirmingDelete, setConfirmingDelete] = React.useState(false);

  const persist = async (next: Project[]) => {
    try {
      await save.mutateAsync(next);
      return true;
    } catch {
      displayErrorToast(t(I18nKey.PROJECTS$SAVE_FAILED));
      return false;
    }
  };

  // @spec PRJ-009 — Cross-server actions: switch the active backend before
  // starting/opening a conversation on a different server. Calls the
  // service directly (not the `useCreateConversation` mutation) because
  // that hook captures the active backend from a render-time hook closure,
  // which would race the just-triggered switch; the service instead reads
  // `getActiveBackend()` live at call time, so it always targets the server
  // we just switched to. Since that bypasses `useCreateConversation`'s own
  // `onSuccess`, its query invalidations and the canonical
  // `conversation_start_requested` tracking event are mirrored here
  // (see `use-create-conversation.ts`'s `onSuccess`); a failed switch or
  // create is caught so a bad server surfaces an error toast instead of an
  // unhandled rejection.
  const startConversation = async (backend: Backend, path: string) => {
    try {
      await switchBackend(backend);
      const result = await AgentServerConversationService.createConversation({
        workingDirOverride: path,
        workspaceMode: "local_repo",
      });
      const conversationId = result.app_conversation_id
        ? result.app_conversation_id
        : `task-${result.id}`;

      trackConversationCreated({
        conversationId,
        taskId: result.id,
        hasRepository: false,
        hasWorkspace: true,
        workspaceMode: "local_repo",
        hasInitialQuery: false,
        hasParentConversation: false,
        entryPoint: "project_detail",
      });
      queryClient.invalidateQueries({ queryKey: ["user", "conversations"] });
      queryClient.invalidateQueries({ queryKey: ["start-tasks"] });

      navigate(`/conversations/${conversationId}`);
    } catch {
      displayErrorToast(t(I18nKey.PROJECTS$CONVERSATION_START_FAILED));
    }
  };

  const openConversation = async (backend: Backend, id: string) => {
    try {
      await switchBackend(backend);
      navigate(`/conversations/${id}`);
    } catch {
      displayErrorToast(t(I18nKey.PROJECTS$CONVERSATION_START_FAILED));
    }
  };

  return (
    <section className="flex flex-col gap-4">
      <NavigationLink
        to="/projects"
        className="w-fit text-xs text-[var(--oh-muted)] hover:underline"
      >
        {t(I18nKey.PROJECTS$TITLE)}
      </NavigationLink>

      <header className="flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-medium leading-6 text-foreground">
          {project.name}
        </h1>
        <span className="text-xs text-[var(--oh-muted)]">
          {project.repo_url}
        </span>
        {project.clickup?.url ? (
          <a
            href={project.clickup.url}
            target="_blank"
            rel="noreferrer"
            className="text-xs text-primary hover:underline"
          >
            {t(I18nKey.PROJECTS$OPEN_CLICKUP)}
          </a>
        ) : null}
        <div className="ml-auto flex gap-2">
          <BrandButton
            type="button"
            variant="secondary"
            testId="project-edit"
            onClick={() => setEditing(true)}
          >
            {t(I18nKey.PROJECTS$EDIT)}
          </BrandButton>
          <BrandButton
            type="button"
            variant="danger"
            testId="project-delete"
            onClick={() => setConfirmingDelete(true)}
          >
            {t(I18nKey.PROJECTS$DELETE)}
          </BrandButton>
        </div>
      </header>

      {/* @spec PRJ-003 — Delete requires confirmation */}
      {confirmingDelete ? (
        <div
          role="alertdialog"
          className="flex flex-col gap-3 rounded-lg border border-[var(--oh-border)] bg-base-secondary p-4"
        >
          <p className="text-sm">
            {t(I18nKey.PROJECTS$DELETE_CONFIRM, { name: project.name })}
          </p>
          <div className="flex justify-end gap-2">
            <BrandButton
              type="button"
              variant="secondary"
              onClick={() => setConfirmingDelete(false)}
            >
              {t(I18nKey.PROJECTS$CANCEL)}
            </BrandButton>
            <BrandButton
              type="button"
              variant="danger"
              testId="project-delete-confirm"
              onClick={async () => {
                if (await persist(all.filter((p) => p.id !== project.id))) {
                  navigate("/projects");
                }
              }}
            >
              {t(I18nKey.PROJECTS$DELETE)}
            </BrandButton>
          </div>
        </div>
      ) : null}

      <h2 className="text-sm font-semibold uppercase tracking-wide text-[var(--oh-muted)]">
        {t(I18nKey.PROJECTS$LOCATIONS)}
      </h2>
      <ul className="flex flex-col gap-2">
        {locations.map((l, i) => (
          <ProjectLocationRow
            key={`${l.location.host}${l.location.path}`}
            index={i}
            location={l.location}
            backend={l.backend}
            status={l.status}
            onNewConversation={startConversation}
          />
        ))}
      </ul>

      <h2 className="text-sm font-semibold uppercase tracking-wide text-[var(--oh-muted)]">
        {t(I18nKey.PROJECTS$CONVERSATIONS)}
      </h2>
      {conversations.length === 0 ? (
        <p className="text-sm text-[var(--oh-muted)]">
          {t(I18nKey.PROJECTS$NO_CONVERSATIONS)}
        </p>
      ) : null}
      <ul className="flex flex-col gap-1">
        {conversations.map((c) => (
          <li
            key={`${c.backend.id}:${c.id}`}
            data-testid={`project-conversation-${c.id}`}
            className="flex items-center gap-2 text-sm"
          >
            <button
              type="button"
              className="text-white hover:underline"
              onClick={() => openConversation(c.backend, c.id)}
            >
              {c.title}
            </button>
            <span className="text-xs text-[var(--oh-muted)]">
              {c.backend.name}
            </span>
          </li>
        ))}
      </ul>

      {/* @spec PRJ-006, PRJ-007 — Automations aggregate across servers; per-server failures shown inline (conversations above already surface unreachable servers per location) */}
      <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-[var(--oh-muted)]">
        {t(I18nKey.PROJECTS$AUTOMATIONS)}
        {failedBackendIds.length > 0 ? (
          <span className="text-xs font-normal normal-case text-red-400">
            {t(I18nKey.PROJECTS$SERVER_UNREACHABLE)}
          </span>
        ) : null}
      </h2>
      {automations.length === 0 ? (
        <p className="text-sm text-[var(--oh-muted)]">
          {t(I18nKey.PROJECTS$NO_AUTOMATIONS)}
        </p>
      ) : null}
      <ul className="flex flex-col gap-1">
        {automations.map((a) => (
          <li
            key={`${a.backend.id}:${a.id}`}
            className="flex items-center gap-2 text-sm"
          >
            <span>{a.name}</span>
            <span className="text-xs text-[var(--oh-muted)]">
              {a.backend.name}
            </span>
          </li>
        ))}
      </ul>

      {editing ? (
        <ProjectFormModal
          initial={project}
          onClose={() => setEditing(false)}
          onSubmit={async (updated) => {
            if (
              await persist(all.map((p) => (p.id === updated.id ? updated : p)))
            ) {
              setEditing(false);
            }
          }}
        />
      ) : null}
    </section>
  );
}
