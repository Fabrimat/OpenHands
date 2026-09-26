import { useTranslation } from "react-i18next";
import type { Backend } from "#/api/backend-registry/types";
import { NavigationLink } from "#/components/shared/navigation-link";
import { ToggleSwitch } from "#/ui/toggle-switch";
import { useNavigation } from "#/context/navigation-context";
import { useSwitchBackend } from "#/hooks/use-switch-backend";
import { I18nKey } from "#/i18n/declaration";
import type { ActivityGroup } from "#/utils/group-activity-by-project";
import { displayErrorToast } from "#/utils/custom-toast-handlers";

interface DashboardActivitySectionProps {
  groups: ActivityGroup[];
  showAllRecent: boolean;
  onToggleShowAllRecent: () => void;
}

// @spec PRJ-102 — Activity grouped by project
// @spec PRJ-103 — Active filter
export function DashboardActivitySection({
  groups,
  showAllRecent,
  onToggleShowAllRecent,
}: DashboardActivitySectionProps) {
  const { t } = useTranslation("openhands");
  const switchBackend = useSwitchBackend();
  const { navigate } = useNavigation();

  // @spec PRJ-105 — Cross-server navigation
  const openConversation = async (backend: Backend, id: string) => {
    try {
      await switchBackend(backend);
      navigate(`/conversations/${id}`);
    } catch {
      displayErrorToast(t(I18nKey.PROJECTS$CONVERSATION_START_FAILED));
    }
  };

  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-4">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-[var(--oh-muted)]">
          {t(I18nKey.DASHBOARD$ACTIVITY)}
        </h2>
        <ToggleSwitch
          enabled={showAllRecent}
          label={t(I18nKey.DASHBOARD$SHOW_ALL_RECENT)}
          onToggle={onToggleShowAllRecent}
        />
      </div>

      {groups.length === 0 ? (
        <p className="text-sm text-[var(--oh-muted)]">
          {t(I18nKey.DASHBOARD$EMPTY)}
        </p>
      ) : null}

      {groups.map((group) => (
        <div
          key={group.project?.id ?? "unassigned"}
          data-testid={`dashboard-group-${group.project?.id ?? "unassigned"}`}
          className="flex flex-col gap-2 rounded-lg border border-[var(--oh-border)] bg-base-secondary p-4"
        >
          {group.project ? (
            <NavigationLink
              to={`/projects/${group.project.id}`}
              className="w-fit text-sm font-medium text-white hover:underline"
            >
              {group.project.name}
            </NavigationLink>
          ) : (
            <span className="text-sm font-medium text-white">
              {t(I18nKey.DASHBOARD$UNASSIGNED)}
            </span>
          )}

          <ul className="flex flex-col gap-1">
            {group.conversations.map((c) => (
              <li
                key={`${c.backend.id}:${c.id}`}
                className="flex items-center gap-2 text-sm"
              >
                <button
                  type="button"
                  data-testid={`dashboard-conversation-${c.id}`}
                  className="text-white hover:underline"
                  onClick={() => openConversation(c.backend, c.id)}
                >
                  {c.title}
                </button>
                <span className="text-xs text-[var(--oh-muted)]">
                  {c.execution_status ?? "—"}
                </span>
                <span className="text-xs text-[var(--oh-muted)]">
                  {c.backend.name}
                </span>
              </li>
            ))}
          </ul>

          {group.automations.length > 0 ? (
            <ul className="flex flex-col gap-1">
              {group.automations.map((a) => (
                <li
                  key={`${a.backend.id}:${a.id}`}
                  className="flex items-center gap-2 text-xs text-[var(--oh-muted)]"
                >
                  <span>{a.name}</span>
                  <span>{a.backend.name}</span>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ))}
    </section>
  );
}
