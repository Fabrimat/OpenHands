/**
 * Mock-LLM E2E test: Projects Supervisor sync.
 *
 * Covers the client-side reconciliation half of phase 3 (PRJ-204, PRJ-205):
 * creating a project, enabling the supervisor from the panel, and confirming
 * the real automation backend ends up with the expected per-server and
 * summary automations — then disabling the supervisor and confirming both
 * are turned off (never deleted). No LLM run is involved; the mock LLM
 * server is untouched by this spec.
 *
 * Modelled on `mock-llm-projects.spec.ts` (project CRUD) and the API helpers
 * in `mock-llm-automation.spec.ts` (real automation backend, reached through
 * the ingress, authenticated with the session API key).
 */

import { test, expect, type APIRequestContext } from "@playwright/test";
import { SettingsClient } from "@openhands/typescript-client/clients";
import {
  seedLocalStorage,
  routeSessionApiKey,
  dismissAnalyticsModal,
  waitForTestId,
  BACKEND_URL,
  SESSION_API_KEY,
} from "../utils/mock-llm-helpers";

const PROJECT_NAME = "Supervisor E2E Project";
const SUMMARY_LIST_ID = "E2E";
const SERVER_AUTOMATION_NAME = "Supervisore — local";
const SUMMARY_AUTOMATION_NAME = "Supervisore — riepilogo";
const SUPERVISOR_MARKER = "<!-- agent-canvas:supervisor v1 -->";

const AUTOMATION_API_BASE = `${BACKEND_URL}/api/automation/v1`;

interface AutomationRecord {
  id: string;
  name: string;
  enabled: boolean;
  prompt?: string | null;
  trigger?: { schedule?: string; timezone?: string; type?: string } | null;
}

/** List automations from the real automation backend via the ingress. */
async function listAutomations(
  request: APIRequestContext,
  retries = 10,
): Promise<{ automations?: AutomationRecord[]; items?: AutomationRecord[] }> {
  let lastStatus = 0;
  for (let i = 0; i < retries; i++) {
    const resp = await request.get(AUTOMATION_API_BASE, {
      headers: { "X-Session-API-Key": SESSION_API_KEY },
    });
    lastStatus = resp.status();
    if (resp.ok()) return resp.json();
    if (lastStatus === 502 || lastStatus === 503) {
      await new Promise((r) => setTimeout(r, 1_000));
      continue;
    }
    break;
  }
  throw new Error(
    `GET automations returned ${lastStatus} after ${retries} retries`,
  );
}

/** Poll the real automation backend until an automation with `name` exists. */
async function waitForAutomationNamed(
  request: APIRequestContext,
  name: string,
  timeoutMs = 30_000,
): Promise<AutomationRecord> {
  const deadline = Date.now() + timeoutMs;
  let lastCount = -1;
  while (Date.now() < deadline) {
    const data = await listAutomations(request);
    const automations = data.automations ?? data.items ?? [];
    lastCount = automations.length;
    const match = automations.find((a) => a.name === name);
    if (match) return match;
    await new Promise((r) => setTimeout(r, 1_000));
  }
  throw new Error(
    `Automation named "${name}" not found after ${timeoutMs}ms (last list had ${lastCount} automations)`,
  );
}

async function getAutomation(
  request: APIRequestContext,
  id: string,
): Promise<AutomationRecord> {
  const resp = await request.get(
    `${AUTOMATION_API_BASE}/${encodeURIComponent(id)}`,
    {
      headers: { "X-Session-API-Key": SESSION_API_KEY },
    },
  );
  expect(resp.ok(), `GET automation ${id}: ${resp.status()}`).toBe(true);
  return resp.json();
}

async function deleteAutomation(request: APIRequestContext, id: string) {
  await request.delete(`${AUTOMATION_API_BASE}/${encodeURIComponent(id)}`, {
    headers: { "X-Session-API-Key": SESSION_API_KEY },
  });
}

test.describe.configure({ mode: "serial" });

test.describe("mock-LLM supervisor — sync creates then disables automations", () => {
  let serverAutomationId: string | null = null;
  let summaryAutomationId: string | null = null;

  test.beforeEach(async ({ page }) => {
    await seedLocalStorage(page);
  });

  test.afterEach(async ({ request }) => {
    for (const id of [serverAutomationId, summaryAutomationId]) {
      if (!id) continue;
      try {
        await deleteAutomation(request, id);
      } catch {
        // best-effort
      }
    }
    serverAutomationId = null;
    summaryAutomationId = null;

    // Best-effort: clear the project and supervisor settings this spec
    // persisted to the (shared, real) primary backend's misc_settings, so a
    // reused local STATE_DIR doesn't accumulate stale state across runs.
    try {
      await new SettingsClient({
        host: BACKEND_URL,
        apiKey: SESSION_API_KEY,
      }).updateSettings({
        misc_settings_diff: {
          projects: [],
          supervisor: {
            enabled: false,
            timezone: "Europe/Rome",
            run_time: "08:00",
            summary_time: "09:00",
            timeout_seconds: 1800,
            summary_clickup_list_id: "",
            servers: [],
          },
        },
      });
    } catch {
      // best-effort
    }
  });

  // @spec PRJ-204, PRJ-205, PRJ-207 — Supervisor panel sync creates the
  // per-server and summary automations, then disables (never deletes) them.
  test("enabling the supervisor creates automations; disabling turns them off", async ({
    page,
    request,
  }) => {
    await routeSessionApiKey(page);
    await page.goto("/projects", { waitUntil: "domcontentloaded" });
    await dismissAnalyticsModal(page);

    // ── Create a project on this (the only registered) backend ──
    await waitForTestId(page, "projects-new");
    await page.getByTestId("projects-new").click();
    await waitForTestId(page, "project-form");
    await page.getByTestId("project-form-name").fill(PROJECT_NAME);
    await page
      .getByTestId("project-form-repo")
      .fill("github.com/e2e/supervisor");
    await page.getByTestId("project-form-path-0").fill("/tmp/e2e-supervisor");
    await page.getByTestId("project-form-submit").click();
    await expect(page.getByTestId("project-form-modal")).toBeHidden({
      timeout: 10_000,
    });

    // ── Expand the Supervisor panel ──
    await page.getByTestId("supervisor-panel").locator("summary").click();
    await waitForTestId(page, "supervisor-add-servers");

    // ── Add all local servers, fill the summary list id, enable, save ──
    await page.getByTestId("supervisor-add-servers").click();
    await expect(page.getByTestId("supervisor-row-local")).toBeVisible({
      timeout: 10_000,
    });
    await page.getByTestId("supervisor-summary-list").fill(SUMMARY_LIST_ID);
    // The switch's checkbox input is visually hidden (native `hidden`
    // attribute); click the wrapping <label> so the browser's native
    // label-forwards-click-to-control behavior toggles it.
    await page.getByTestId("supervisor-enabled").locator("..").click();
    await page.getByTestId("supervisor-save").click();

    // ── Assert the per-server automation was created as desired ──
    const server = await waitForAutomationNamed(
      request,
      SERVER_AUTOMATION_NAME,
    );
    serverAutomationId = server.id;
    expect(server.enabled).toBe(true);
    expect(server.trigger?.schedule).toBe("0 8 * * *");
    expect(server.trigger?.timezone).toBe("Europe/Rome");
    expect(server.prompt?.startsWith(SUPERVISOR_MARKER)).toBe(true);

    // ── Assert the summary automation was created as desired ──
    const summary = await waitForAutomationNamed(
      request,
      SUMMARY_AUTOMATION_NAME,
    );
    summaryAutomationId = summary.id;
    expect(summary.enabled).toBe(true);
    expect(summary.trigger?.schedule).toBe("0 9 * * *");
    expect(summary.trigger?.timezone).toBe("Europe/Rome");
    expect(summary.prompt?.startsWith(SUPERVISOR_MARKER)).toBe(true);

    // ── Disable the supervisor and save ──
    await page.getByTestId("supervisor-enabled").locator("..").click();
    await page.getByTestId("supervisor-save").click();

    // ── Assert both automations are disabled, never deleted ──
    await expect
      .poll(
        async () => (await getAutomation(request, serverAutomationId!)).enabled,
        {
          timeout: 30_000,
        },
      )
      .toBe(false);
    await expect
      .poll(
        async () =>
          (await getAutomation(request, summaryAutomationId!)).enabled,
        { timeout: 30_000 },
      )
      .toBe(false);
  });
});
