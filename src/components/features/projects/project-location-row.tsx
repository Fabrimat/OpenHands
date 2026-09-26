import { useTranslation } from "react-i18next";
import type { Backend } from "#/api/backend-registry/types";
import { BrandButton } from "#/components/features/settings/brand-button";
import { useProjectGitInfo } from "#/hooks/query/use-project-data";
import { I18nKey } from "#/i18n/declaration";
import type { ProjectLocation } from "#/types/project";

interface ProjectLocationRowProps {
  index: number;
  location: ProjectLocation;
  backend: Backend | null;
  status: "unregistered" | "loading" | "error" | "success";
  onNewConversation: (backend: Backend, path: string) => void;
}

// @spec PRJ-006 — Per-location server health, path and branch
export function ProjectLocationRow({
  index,
  location,
  backend,
  status,
  onNewConversation,
}: ProjectLocationRowProps) {
  const { t } = useTranslation("openhands");
  const git = useProjectGitInfo(
    location,
    status === "success" ? backend : null,
  );

  return (
    <li
      data-testid={`project-location-${index}`}
      className="flex flex-wrap items-center gap-3 rounded-lg border border-[var(--oh-border)] bg-base-secondary p-3 text-sm"
    >
      <span className="font-medium text-white">
        {backend?.name ?? location.host}
      </span>
      <code className="text-xs text-[var(--oh-muted)]">{location.path}</code>
      {git.data?.branch ? (
        <span className="text-xs text-[var(--oh-text-tertiary)]">
          {git.data.branch}
        </span>
      ) : null}
      {status === "unregistered" ? (
        <span className="text-xs text-[var(--oh-muted)]">
          {t(I18nKey.PROJECTS$SERVER_NOT_REGISTERED)}
        </span>
      ) : null}
      {status === "error" ? (
        <span className="text-xs text-red-400">
          {t(I18nKey.PROJECTS$SERVER_UNREACHABLE)}
        </span>
      ) : null}
      {backend ? (
        <BrandButton
          type="button"
          variant="secondary"
          className="ml-auto"
          testId={`project-location-new-conversation-${index}`}
          onClick={() => onNewConversation(backend, location.path)}
        >
          {t(I18nKey.PROJECTS$NEW_CONVERSATION_HERE)}
        </BrandButton>
      ) : null}
    </li>
  );
}
