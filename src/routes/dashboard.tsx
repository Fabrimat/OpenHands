import { Dashboard } from "#/components/features/dashboard/dashboard";
import { settingsLikeMainScrollClassName } from "#/utils/settings-like-page-layout-classes";

export default function DashboardRoute() {
  return (
    <main className={settingsLikeMainScrollClassName}>
      <Dashboard />
    </main>
  );
}
