import React from "react";
import type { Backend } from "#/api/backend-registry/types";
import {
  ENVIRONMENT_SWITCH_SETACTIVE_DELAY_MS,
  triggerEnvironmentSwitch,
} from "#/components/features/backends/environment-switch-store";
import { useActiveBackendContext } from "#/contexts/active-backend-context";

// @spec PRJ-009 — Cross-server actions
export function useSwitchBackend() {
  const { active, setActive } = useActiveBackendContext();
  return React.useCallback(
    async (target: Backend) => {
      if (active.backend.id === target.id) return;
      triggerEnvironmentSwitch(target.name);
      await new Promise<void>((r) => {
        setTimeout(r, ENVIRONMENT_SWITCH_SETACTIVE_DELAY_MS);
      });
      setActive(target.id);
    },
    [active.backend.id, setActive],
  );
}
