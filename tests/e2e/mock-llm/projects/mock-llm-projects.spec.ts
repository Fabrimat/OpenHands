/**
 * Mock-LLM E2E test: Projects.
 *
 * Covers the phase-1 happy path: create a project with a location on the
 * (single, local) backend under test, start a conversation from that
 * location via "New conversation here", and confirm the project's detail
 * view lists the conversation that was just created in its path.
 *
 * The location's path only needs to exist on disk — `workingDirOverride`
 * conversations use `workspaceMode: "local_repo"`, same as the folder-browser
 * workspace flow (`mock-llm-folder-workspace.spec.ts`), which also launches a
 * conversation against a plain (non-git-initialized) directory. So this spec
 * reuses that spec's directory-resolution helper rather than inventing a new
 * fixture path.
 */

import * as fs from "fs";
import { test, expect } from "@playwright/test";
import { SettingsClient } from "@openhands/typescript-client/clients";
import {
  seedLocalStorage,
  routeSessionApiKey,
  dismissAnalyticsModal,
  waitForTestId,
  waitForPath,
  ensureMockLLMProfile,
  resetMockLLM,
  deleteConversation,
  BACKEND_URL,
  SESSION_API_KEY,
} from "../utils/mock-llm-helpers";
import { resolveFolderWorkspacePaths } from "../utils/folder-workspace-paths";

const {
  hostDirBase: HOST_DIR_BASE,
  hostDir: HOST_DIR,
  testDir: WORKSPACE_PATH,
} = resolveFolderWorkspacePaths();

const PROJECT_NAME = "E2E Project";

test.describe.configure({ mode: "serial" });

test.describe("mock-LLM projects — create, start conversation, view in detail", () => {
  let conversationId: string | null = null;

  test.beforeAll(async ({ browser }) => {
    // Create the location's checkout directory (host-side path for Docker
    // compat — see folder-workspace-paths.ts).
    fs.mkdirSync(HOST_DIR, { recursive: true });

    // beforeAll only has worker-scoped fixtures, so create a temporary page
    // to configure the mock LLM profile via the Settings UI.
    const page = await browser.newPage();
    try {
      await seedLocalStorage(page);
      await ensureMockLLMProfile(page);
    } finally {
      await page.close();
    }
  });

  test.beforeEach(async ({ page }) => {
    await seedLocalStorage(page);
  });

  test.afterEach(async ({ request }) => {
    await resetMockLLM(request);
    if (conversationId) {
      try {
        await deleteConversation(request, conversationId);
      } catch {
        // best-effort
      }
      conversationId = null;
    }
  });

  test.afterAll(async () => {
    try {
      fs.rmSync(HOST_DIR_BASE, { recursive: true, force: true });
    } catch {
      // best-effort
    }
    // Best-effort: clear the project this spec persisted to the (shared,
    // real) primary backend's misc_settings, so a reused local STATE_DIR
    // doesn't accumulate stale projects across repeated test runs.
    try {
      await new SettingsClient({
        host: BACKEND_URL,
        apiKey: SESSION_API_KEY,
      }).updateSettings({ misc_settings_diff: { projects: [] } });
    } catch {
      // best-effort
    }
  });

  // @spec PRJ-003, PRJ-005, PRJ-006, PRJ-009 — Project CRUD, projects list,
  // cross-server "new conversation here", and detail-view conversation list
  test("creates a project and lists a conversation started in its path", async ({
    page,
  }) => {
    await routeSessionApiKey(page);
    await page.goto("/projects", { waitUntil: "domcontentloaded" });
    await dismissAnalyticsModal(page);

    // ── Create the project ──
    await waitForTestId(page, "projects-new");
    await page.getByTestId("projects-new").click();

    await waitForTestId(page, "project-form");
    await page.getByTestId("project-form-name").fill(PROJECT_NAME);
    await page.getByTestId("project-form-repo").fill("github.com/e2e/project");
    await page.getByTestId("project-form-path-0").fill(WORKSPACE_PATH);
    await page.getByTestId("project-form-submit").click();
    await expect(page.getByTestId("project-form-modal")).toBeHidden({
      timeout: 10_000,
    });

    // ── Open the project and start a conversation from its location ──
    await page.getByRole("link", { name: PROJECT_NAME }).click();
    await waitForPath(page, /\/projects\/[^/]+$/);

    const newConversationButton = page.getByTestId(
      "project-location-new-conversation-0",
    );
    // Disabled until the location's server status resolves to "success".
    await expect(newConversationButton).toBeEnabled({ timeout: 15_000 });
    await newConversationButton.click();

    await waitForPath(page, /\/conversations\/[^/]+$/, 30_000);
    const match = page.url().match(/\/conversations\/([^/?#]+)/);
    conversationId = match?.[1] ? decodeURIComponent(match[1]) : null;
    expect(
      conversationId,
      "should have landed on a conversation page",
    ).toBeTruthy();

    // ── Revisit the project detail view and confirm the conversation shows ──
    await page.goto("/projects", { waitUntil: "domcontentloaded" });
    await page.getByRole("link", { name: PROJECT_NAME }).click();
    await waitForPath(page, /\/projects\/[^/]+$/);

    await expect(
      page.locator('[data-testid^="project-conversation-"]'),
    ).not.toHaveCount(0, { timeout: 15_000 });
  });
});
