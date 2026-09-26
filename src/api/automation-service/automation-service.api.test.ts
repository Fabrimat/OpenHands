import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  setActiveSelection,
  setRegisteredBackends,
} from "#/api/backend-registry/active-store";
import type { Backend } from "#/api/backend-registry/types";
import type { Automation, AutomationSpec } from "#/types/automation";
import type { GitSyncStatus } from "#/types/git-sync";
import AutomationService from "./automation-service.api";

const {
  localAxios,
  callCloudProxy,
  clearPendingLocalTelemetryRevocation,
  getTelemetryConsent,
  getTelemetryDistinctId,
  getTelemetryDistinctIdForConsentSync,
} = vi.hoisted(() => ({
  localAxios: {
    interceptors: { request: { use: vi.fn() } },
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
  },
  callCloudProxy: vi.fn(),
  clearPendingLocalTelemetryRevocation: vi.fn(),
  getTelemetryConsent: vi.fn(),
  getTelemetryDistinctId: vi.fn(),
  getTelemetryDistinctIdForConsentSync: vi.fn(),
}));

vi.mock("axios", () => ({
  default: {
    create: () => localAxios,
    post: vi.fn(),
  },
}));

vi.mock("#/api/cloud/proxy", () => ({
  callCloudProxy,
}));

vi.mock("#/services/telemetry", () => ({
  clearPendingLocalTelemetryRevocation,
  getTelemetryConsent,
  getTelemetryDistinctId,
  getTelemetryDistinctIdForConsentSync,
}));

const localBackend: Backend = {
  id: "local-test",
  name: "Local test backend",
  host: "http://localhost:3000",
  apiKey: "test-session-key",
  kind: "local",
};

const cloudBackend: Backend = {
  id: "cloud-test",
  name: "Cloud test backend",
  host: "https://app.example.test",
  apiKey: "cloud-api-key",
  kind: "cloud",
};

const spec: AutomationSpec = {
  name: "Imported review",
  prompt: "Review open pull requests.",
  trigger: {
    type: "cron",
    schedule: "0 9 * * *",
    schedule_human: "Daily at 09:00",
  },
  enabled: true,
  repository: "openhands/agent-canvas",
  branch: "main",
  plugins: ["github:openhands/extensions"],
  model: "fast",
  timezone: "America/Los_Angeles",
};

const createdAutomation: Automation = {
  id: "created-automation",
  name: spec.name,
  prompt: spec.prompt,
  trigger: { type: "cron", schedule: spec.trigger.schedule },
  enabled: true,
  model: spec.model,
  created_at: "2026-07-10T00:00:00Z",
  updated_at: "2026-07-10T00:00:00Z",
};

describe("AutomationService.getSdkVersion", () => {
  beforeEach(() => {
    setRegisteredBackends([localBackend]);
    setActiveSelection({ backendId: localBackend.id });
  });

  afterEach(() => {
    setActiveSelection(null);
    setRegisteredBackends([]);
    vi.clearAllMocks();
  });

  it("fetches the local automation SDK version from the automation sidecar", async () => {
    localAxios.get.mockResolvedValueOnce({ data: { sdk_version: "1.36.1" } });

    await expect(AutomationService.getSdkVersion()).resolves.toBe("1.36.1");

    expect(localAxios.get).toHaveBeenCalledWith("/api/automation/sdk-version", {
      timeout: 5000,
    });
  });

  it("fetches the cloud automation SDK version through the cloud proxy", async () => {
    setRegisteredBackends([cloudBackend]);
    setActiveSelection({ backendId: cloudBackend.id, orgId: "org-1" });
    callCloudProxy.mockResolvedValueOnce({ sdk_version: "1.36.2" });

    await expect(AutomationService.getSdkVersion()).resolves.toBe("1.36.2");

    expect(callCloudProxy).toHaveBeenCalledWith(
      expect.objectContaining({
        backend: cloudBackend,
        method: "GET",
        path: "/api/automation/sdk-version",
        headers: expect.objectContaining({ "X-Org-Id": "org-1" }),
        timeoutSeconds: 5,
      }),
    );
  });

  it("returns null when the SDK version endpoint is unavailable", async () => {
    localAxios.get.mockRejectedValueOnce(new Error("not running"));

    await expect(AutomationService.getSdkVersion()).resolves.toBeNull();
  });
});

describe("AutomationService.syncTelemetryConsent", () => {
  beforeEach(() => {
    setRegisteredBackends([localBackend]);
    setActiveSelection({ backendId: localBackend.id });
    getTelemetryConsent.mockReturnValue("pending");
    getTelemetryDistinctIdForConsentSync.mockResolvedValue("ph-fe-sync");
    localAxios.post.mockResolvedValue({ data: { consent_granted: true } });
  });

  afterEach(() => {
    setActiveSelection(null);
    setRegisteredBackends([]);
    vi.clearAllMocks();
  });

  it("posts local telemetry consent with the frontend PostHog distinct ID", async () => {
    await AutomationService.syncTelemetryConsent("granted");

    expect(localAxios.post).toHaveBeenCalledWith(
      "/api/automation/v1/telemetry/consent",
      {
        consent_granted: true,
        frontend_distinct_id: "ph-fe-sync",
      },
      { timeout: 5000 },
    );
  });

  it("uses the current telemetry consent when no explicit value is supplied", async () => {
    getTelemetryConsent.mockReturnValue("denied");

    await AutomationService.syncTelemetryConsent();

    expect(localAxios.post).toHaveBeenCalledWith(
      "/api/automation/v1/telemetry/consent",
      {
        consent_granted: false,
        frontend_distinct_id: "ph-fe-sync",
      },
      { timeout: 5000 },
    );
    expect(clearPendingLocalTelemetryRevocation).toHaveBeenCalledWith(
      "ph-fe-sync",
    );
  });

  it("skips cloud backends because cloud consent is handled by auth", async () => {
    setRegisteredBackends([cloudBackend]);
    setActiveSelection({ backendId: cloudBackend.id, orgId: "org-1" });

    await AutomationService.syncTelemetryConsent("granted");

    expect(localAxios.post).not.toHaveBeenCalled();
  });
});

describe("AutomationService.createAutomation", () => {
  beforeEach(() => {
    setRegisteredBackends([localBackend]);
    setActiveSelection({ backendId: localBackend.id });
    localAxios.post.mockResolvedValue({ data: createdAutomation });
    localAxios.patch.mockImplementation(
      async (_path: string, body: Partial<Automation>) => ({
        data: { ...createdAutomation, ...body },
      }),
    );
  });

  afterEach(() => {
    setActiveSelection(null);
    setRegisteredBackends([]);
    vi.clearAllMocks();
  });

  it("creates plugin automations through the preset API and disables them", async () => {
    const created = await AutomationService.createAutomation(spec);

    expect(localAxios.post).toHaveBeenCalledWith(
      "/api/automation/v1/preset/plugin",
      {
        name: spec.name,
        prompt: spec.prompt,
        model: spec.model,
        trigger: {
          type: "event",
          source: "agent-canvas-import",
          on: expect.stringMatching(/^pending\./),
        },
        repos: [
          {
            url: spec.repository,
            ref: spec.branch,
            provider: "github",
          },
        ],
        plugins: [{ source: spec.plugins![0] }],
      },
      {
        baseURL: localBackend.host,
        headers: expect.objectContaining({
          "X-Session-API-Key": localBackend.apiKey,
        }),
      },
    );
    expect(localAxios.patch).toHaveBeenCalledWith(
      "/api/automation/v1/created-automation",
      {
        trigger: {
          type: "cron",
          schedule: spec.trigger.schedule,
          timezone: spec.timezone,
        },
        enabled: false,
      },
      {
        baseURL: localBackend.host,
        headers: expect.objectContaining({
          "X-Session-API-Key": localBackend.apiKey,
        }),
      },
    );
    expect(created.enabled).toBe(false);
  });

  it("uses the prompt preset path when no plugins are configured", async () => {
    await AutomationService.createAutomation({
      ...spec,
      plugins: undefined,
    });

    expect(localAxios.post).toHaveBeenCalledWith(
      "/api/automation/v1/preset/prompt",
      expect.not.objectContaining({ plugins: expect.anything() }),
      expect.any(Object),
    );
  });

  it("applies the imported event trigger while disabling the automation", async () => {
    const eventTrigger = {
      type: "event",
      source: "github",
      on: ["pull_request.opened", "pull_request.synchronize"],
      filter: "repository.full_name == 'openhands/agent-canvas'",
    };

    await AutomationService.createAutomation({
      ...spec,
      trigger: eventTrigger,
    });

    expect(localAxios.patch).toHaveBeenCalledWith(
      "/api/automation/v1/created-automation",
      { trigger: eventTrigger, enabled: false },
      expect.any(Object),
    );
  });

  it("uses the selected cloud backend and organization for both requests", async () => {
    setRegisteredBackends([cloudBackend]);
    setActiveSelection({ backendId: cloudBackend.id, orgId: "org-1" });
    callCloudProxy
      .mockResolvedValueOnce(createdAutomation)
      .mockResolvedValueOnce({ ...createdAutomation, enabled: false });

    const created = await AutomationService.createAutomation(spec);

    expect(callCloudProxy).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        backend: cloudBackend,
        method: "POST",
        path: "/api/automation/v1/preset/plugin",
        body: expect.objectContaining({ name: spec.name }),
        headers: expect.objectContaining({ "X-Org-Id": "org-1" }),
      }),
    );
    expect(callCloudProxy).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        backend: cloudBackend,
        method: "PATCH",
        path: "/api/automation/v1/created-automation",
        body: expect.objectContaining({ enabled: false }),
        headers: expect.objectContaining({ "X-Org-Id": "org-1" }),
      }),
    );
    expect(created.enabled).toBe(false);
  });

  it("removes the inert automation when disabling it fails", async () => {
    const updateError = new Error("update failed");
    localAxios.patch.mockRejectedValueOnce(updateError);

    await expect(AutomationService.createAutomation(spec)).rejects.toBe(
      updateError,
    );

    expect(localAxios.delete).toHaveBeenCalledWith(
      "/api/automation/v1/created-automation",
      {
        baseURL: localBackend.host,
        headers: expect.objectContaining({
          "X-Session-API-Key": localBackend.apiKey,
        }),
      },
    );
  });

  it("includes the timeout in the create request when the spec sets one", async () => {
    await AutomationService.createAutomation({ ...spec, timeout: 1200 });

    expect(localAxios.post).toHaveBeenCalledWith(
      "/api/automation/v1/preset/plugin",
      expect.objectContaining({ timeout: 1200 }),
      expect.any(Object),
    );
  });
});

const gitSyncStatus: GitSyncStatus = {
  enabled: true,
  repo_url: "https://example.com/org/repo.git",
  branch: "main",
  path: "automations",
  encryption_enabled: false,
  interval_seconds: 0,
  last_synced_commit: "abc123",
  last_synced_at: "2026-07-10T00:00:00Z",
  last_error: null,
  last_error_at: null,
  dirty_count: 0,
};

describe("AutomationService git sync", () => {
  beforeEach(() => {
    setRegisteredBackends([localBackend]);
    setActiveSelection({ backendId: localBackend.id });
  });

  afterEach(() => {
    setActiveSelection(null);
    setRegisteredBackends([]);
    vi.clearAllMocks();
  });

  it("fetches status from the local automation backend", async () => {
    localAxios.get.mockResolvedValueOnce({ data: gitSyncStatus });

    await expect(AutomationService.getGitSyncStatus()).resolves.toEqual(
      gitSyncStatus,
    );

    expect(localAxios.get).toHaveBeenCalledWith(
      "/api/automation/v1/git-sync/status",
    );
  });

  it("fetches status through the cloud proxy", async () => {
    setRegisteredBackends([cloudBackend]);
    setActiveSelection({ backendId: cloudBackend.id, orgId: "org-1" });
    callCloudProxy.mockResolvedValueOnce(gitSyncStatus);

    await expect(AutomationService.getGitSyncStatus()).resolves.toEqual(
      gitSyncStatus,
    );

    expect(callCloudProxy).toHaveBeenCalledWith(
      expect.objectContaining({
        backend: cloudBackend,
        method: "GET",
        path: "/api/automation/v1/git-sync/status",
      }),
    );
  });

  it("sends a partial config update", async () => {
    localAxios.put.mockResolvedValueOnce({ data: gitSyncStatus });

    await expect(
      AutomationService.updateGitSyncConfig({ branch: "develop" }),
    ).resolves.toEqual(gitSyncStatus);

    expect(localAxios.put).toHaveBeenCalledWith(
      "/api/automation/v1/git-sync/config",
      { branch: "develop" },
    );
  });

  it("sends a null override through the cloud proxy", async () => {
    setRegisteredBackends([cloudBackend]);
    setActiveSelection({ backendId: cloudBackend.id, orgId: "org-1" });
    callCloudProxy.mockResolvedValueOnce(gitSyncStatus);

    await AutomationService.updateGitSyncConfig({ token: null });

    expect(callCloudProxy).toHaveBeenCalledWith(
      expect.objectContaining({
        backend: cloudBackend,
        method: "PUT",
        path: "/api/automation/v1/git-sync/config",
        body: { token: null },
      }),
    );
  });

  it("triggers a sync cycle", async () => {
    localAxios.post.mockResolvedValueOnce({ data: { triggered: true } });

    await expect(AutomationService.triggerGitSync()).resolves.toEqual({
      triggered: true,
    });

    expect(localAxios.post).toHaveBeenCalledWith(
      "/api/automation/v1/git-sync/sync",
    );
  });
});

describe("AutomationService.createAutomationForBackend", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("creates an automation on the specified backend without repos", async () => {
    // @spec PRJ-205 — Automations created per backend (single POST, no import dance)
    localAxios.post.mockResolvedValueOnce({ data: createdAutomation });

    const desired = {
      name: "Backend-specific automation",
      prompt: "Run a task",
      trigger: {
        type: "cron" as const,
        schedule: "0 10 * * *",
        timezone: "UTC",
      },
      timeout: 300,
      enabled: true,
    };

    await expect(
      AutomationService.createAutomationForBackend(localBackend, desired),
    ).resolves.toEqual(createdAutomation);

    expect(localAxios.post).toHaveBeenCalledWith(
      "/api/automation/v1/preset/prompt",
      {
        name: desired.name,
        prompt: desired.prompt,
        trigger: desired.trigger,
        timeout: desired.timeout,
        enabled: true,
      },
      {
        baseURL: localBackend.host,
        headers: expect.objectContaining({
          "X-Session-API-Key": localBackend.apiKey,
        }),
      },
    );
  });

  it("does not include repos in the create request", async () => {
    localAxios.post.mockResolvedValueOnce({ data: createdAutomation });

    const desired = {
      name: "No repos automation",
      prompt: "Run a task",
      trigger: {
        type: "cron" as const,
        schedule: "0 10 * * *",
        timezone: "UTC",
      },
      timeout: 300,
      enabled: true,
    };

    await AutomationService.createAutomationForBackend(localBackend, desired);

    const callArgs = localAxios.post.mock.calls[0];
    const body = callArgs[1];
    expect(body).not.toHaveProperty("repos");
  });

  it("uses the backend session key in the X-Session-API-Key header", async () => {
    const customBackend = { ...localBackend, apiKey: "custom-session-key" };
    localAxios.post.mockResolvedValueOnce({ data: createdAutomation });

    const desired = {
      name: "Custom backend automation",
      prompt: "Run a task",
      trigger: {
        type: "cron" as const,
        schedule: "0 10 * * *",
        timezone: "UTC",
      },
      timeout: 300,
      enabled: true,
    };

    await AutomationService.createAutomationForBackend(customBackend, desired);

    expect(localAxios.post).toHaveBeenCalledWith(
      "/api/automation/v1/preset/prompt",
      expect.any(Object),
      {
        baseURL: customBackend.host,
        headers: expect.objectContaining({
          "X-Session-API-Key": "custom-session-key",
        }),
      },
    );
  });
});

describe("AutomationService.updateAutomationForBackend", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("patches an automation on the specified backend", async () => {
    // @spec PRJ-205 — Automations created per backend (single POST, no import dance)
    const updatedAutomation = {
      ...createdAutomation,
      name: "Updated automation",
    };
    localAxios.patch.mockResolvedValueOnce({ data: updatedAutomation });

    const patch = {
      name: "Updated automation",
      enabled: false,
    };

    await expect(
      AutomationService.updateAutomationForBackend(
        localBackend,
        createdAutomation.id,
        patch,
      ),
    ).resolves.toEqual(updatedAutomation);

    expect(localAxios.patch).toHaveBeenCalledWith(
      `/api/automation/v1/${createdAutomation.id}`,
      patch,
      {
        baseURL: localBackend.host,
        headers: expect.objectContaining({
          "X-Session-API-Key": localBackend.apiKey,
        }),
      },
    );
  });

  it("uses the backend session key in the X-Session-API-Key header", async () => {
    const customBackend = { ...localBackend, apiKey: "custom-session-key" };
    const updatedAutomation = {
      ...createdAutomation,
      enabled: false,
    };
    localAxios.patch.mockResolvedValueOnce({ data: updatedAutomation });

    const patch = { enabled: false };

    await AutomationService.updateAutomationForBackend(
      customBackend,
      createdAutomation.id,
      patch,
    );

    expect(localAxios.patch).toHaveBeenCalledWith(
      `/api/automation/v1/${createdAutomation.id}`,
      patch,
      {
        baseURL: customBackend.host,
        headers: expect.objectContaining({
          "X-Session-API-Key": "custom-session-key",
        }),
      },
    );
  });
});
