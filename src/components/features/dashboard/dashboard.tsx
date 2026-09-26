import React from "react";
import { useTranslation } from "react-i18next";
import { useAllServersActivity } from "#/hooks/query/use-all-servers-activity";
import { useBackendsHealth } from "#/hooks/query/use-backends-health";
import { useProjects } from "#/hooks/query/use-projects";
import { I18nKey } from "#/i18n/declaration";
import { groupActivityByProject } from "#/utils/group-activity-by-project";
import { DashboardActivitySection } from "./dashboard-activity-section";
import { DashboardServersSection } from "./dashboard-servers-section";

// @spec PRJ-101 — Dashboard aggregates all servers
export function Dashboard() {
  const { t } = useTranslation("openhands");
  const { servers, conversations, automations } = useAllServersActivity();
  const health = useBackendsHealth(servers.map((s) => s.backend));
  const projects = useProjects();
  const [showAllRecent, setShowAllRecent] = React.useState(false);

  const groups = groupActivityByProject(
    conversations,
    automations,
    projects.data ?? [],
    { activeOnly: !showAllRecent },
  );

  return (
    <section className="flex flex-col gap-6">
      <h1 className="text-xl font-medium leading-6 text-foreground">
        {t(I18nKey.DASHBOARD$TITLE)}
      </h1>
      <DashboardServersSection servers={servers} health={health} />
      <DashboardActivitySection
        groups={groups}
        showAllRecent={showAllRecent}
        onToggleShowAllRecent={() => setShowAllRecent((v) => !v)}
      />
    </section>
  );
}
