import { useParams } from "react-router";
import { ProjectDetail } from "#/components/features/projects/project-detail";
import { settingsLikeMainScrollClassName } from "#/utils/settings-like-page-layout-classes";

export default function ProjectDetailRoute() {
  const { projectId } = useParams();
  return (
    <main className={settingsLikeMainScrollClassName}>
      <ProjectDetail projectId={projectId ?? ""} />
    </main>
  );
}
