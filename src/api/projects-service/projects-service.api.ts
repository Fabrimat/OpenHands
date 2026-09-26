import { SettingsClient } from "@openhands/typescript-client/clients";
import { getAgentServerClientOptions } from "../agent-server-client-options";
import type { Backend } from "../backend-registry/types";
import { isValidProject, type Project } from "#/types/project";
import {
  isValidSupervisorSettings,
  type SupervisorSettings,
  DEFAULT_SUPERVISOR_SETTINGS,
} from "#/types/supervisor";

// @spec PRJ-001 — Projects persist on the primary server
function clientFor(backend: Backend) {
  return new SettingsClient(
    getAgentServerClientOptions({ host: backend.host, apiKey: backend.apiKey }),
  );
}

export const ProjectsService = {
  async getProjects(backend: Backend): Promise<Project[]> {
    const response = await clientFor(backend).getSettings();
    const raw = (response.misc_settings as { projects?: unknown } | undefined)
      ?.projects;
    return Array.isArray(raw) ? raw.filter(isValidProject) : [];
  },

  async saveProjects(backend: Backend, projects: Project[]): Promise<void> {
    // misc_settings_diff replaces lists wholesale: always send the full array.
    await clientFor(backend).updateSettings({
      misc_settings_diff: { projects },
    });
  },

  // @spec PRJ-201 — Supervisor settings persist on the primary server
  async getSupervisorSettings(backend: Backend): Promise<SupervisorSettings> {
    const response = await clientFor(backend).getSettings();
    const raw = (response.misc_settings as { supervisor?: unknown } | undefined)
      ?.supervisor;
    return isValidSupervisorSettings(raw) ? raw : DEFAULT_SUPERVISOR_SETTINGS;
  },

  async saveSupervisorSettings(
    backend: Backend,
    settings: SupervisorSettings,
  ): Promise<void> {
    // Deep-merged server-side; every field is always sent, nothing needs clearing.
    await clientFor(backend).updateSettings({
      misc_settings_diff: { supervisor: settings },
    });
  },
};
