import { ProjectsList } from "#/components/features/projects/projects-list";
import { settingsLikeMainScrollClassName } from "#/utils/settings-like-page-layout-classes";

export default function ProjectsListRoute() {
  return (
    <main className={settingsLikeMainScrollClassName}>
      <ProjectsList />
    </main>
  );
}
