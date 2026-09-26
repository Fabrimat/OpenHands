import { useTranslation } from "react-i18next";
import type { ServerActivity } from "#/hooks/query/use-all-servers-activity";
import type { BackendHealth } from "#/hooks/query/use-backends-health";
import { BackendStatusDot } from "#/components/features/backends/backend-status-dot";
import { ACTIVE_EXECUTION_STATUSES } from "#/utils/group-activity-by-project";
import { I18nKey } from "#/i18n/declaration";

interface DashboardServersSectionProps {
  servers: ServerActivity[];
  health: Record<string, BackendHealth>;
}

// @spec PRJ-101 — Dashboard aggregates all servers
// @spec PRJ-104 — Auto-refresh and isolation
export function DashboardServersSection({
  servers,
  health,
}: DashboardServersSectionProps) {
  const { t } = useTranslation("openhands");
  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-[var(--oh-muted)]">
        {t(I18nKey.DASHBOARD$SERVERS)}
      </h2>
      <ul className="flex flex-col gap-2">
        {servers.map((server) => {
          const activeAgents = server.conversations.filter(
            (c) =>
              c.execution_status !== null &&
              ACTIVE_EXECUTION_STATUSES.has(c.execution_status),
          ).length;
          const enabledAutomations = server.automations.filter(
            (a) => a.enabled,
          ).length;
          return (
            <li
              key={server.backend.id}
              data-testid={`dashboard-server-${server.backend.id}`}
              className="flex items-center gap-3 rounded-lg border border-[var(--oh-border)] bg-base-secondary p-3 text-sm"
            >
              <BackendStatusDot
                isConnected={health[server.backend.id]?.isConnected ?? null}
              />
              <span className="font-medium text-white">
                {server.backend.name}
              </span>
              {server.status === "error" ? (
                <span className="text-xs text-red-400">
                  {t(I18nKey.PROJECTS$SERVER_UNREACHABLE)}
                </span>
              ) : (
                <span className="flex gap-3 text-xs text-[var(--oh-muted)]">
                  <span>
                    {t(I18nKey.DASHBOARD$ACTIVE_AGENTS)}: {activeAgents}
                  </span>
                  <span>
                    {t(I18nKey.PROJECTS$AUTOMATIONS)}: {enabledAutomations}
                  </span>
                </span>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
