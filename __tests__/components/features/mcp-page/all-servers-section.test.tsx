import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { MCPConfig, MCPServer } from "@openhands/typescript-client";
import { ActiveBackendProvider } from "#/contexts/active-backend-context";
import {
  __resetActiveStoreForTests,
  setActiveSelection,
  setRegisteredBackends,
} from "#/api/backend-registry/active-store";
import type { Backend } from "#/api/backend-registry/types";
import { McpFleetService } from "#/api/mcp-service/mcp-fleet.api";
import { REDACTED_MCP_SECRET_VALUE } from "#/utils/mcp-config";
import { AllServersSection } from "#/components/features/mcp-page/all-servers/all-servers-section";

function backend(id: string): Backend {
  return {
    id,
    name: id,
    host: `https://${id}.example`,
    apiKey: `key-${id}`,
    kind: "local",
  };
}

const backendA = backend("a");
const backendB = backend("b");
const backendC = backend("c");

function renderSection() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <ActiveBackendProvider>
        <AllServersSection />
      </ActiveBackendProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.restoreAllMocks();
  __resetActiveStoreForTests();
});

// @spec PRJ-601 — All-servers MCP view
describe("AllServersSection", () => {
  it("does not render with a single local backend", async () => {
    setRegisteredBackends([backendA]);
    setActiveSelection({ backendId: "a" });
    vi.spyOn(McpFleetService, "getConfig").mockResolvedValue({});

    renderSection();

    expect(screen.queryByTestId("mcp-fleet-section")).not.toBeInTheDocument();
  });

  // @spec PRJ-602 — Drift fingerprint
  it("renders a differs cell whose aria-label names the differing fingerprint field", async () => {
    setRegisteredBackends([backendA, backendB]);
    setActiveSelection({ backendId: "a" });
    vi.spyOn(McpFleetService, "getConfig").mockImplementation(
      async (b) =>
        ({
          shared: {
            transport: "http",
            url: `https://${b.id}.example/mcp`,
          } as MCPServer,
        }) as never,
    );

    renderSection();

    const cell = await screen.findByTestId("mcp-fleet-cell-shared-b");
    expect(cell.getAttribute("aria-label")).toContain("MCP$FLEET_FIELD_TARGET");
  });

  // @spec PRJ-603 — Push an entry to servers
  it("pushes a fresh entry to both backends and shows ok for each", async () => {
    setRegisteredBackends([backendA, backendB]);
    setActiveSelection({ backendId: "a" });
    vi.spyOn(McpFleetService, "getConfig").mockResolvedValue({});
    const pushSpy = vi
      .spyOn(McpFleetService, "push")
      .mockResolvedValue(undefined);

    renderSection();
    fireEvent.click(await screen.findByTestId("mcp-fleet-push-new"));
    const modal = await screen.findByTestId("mcp-fleet-push-modal");
    fireEvent.change(within(modal).getByTestId("server-name-input"), {
      target: { value: "fresh" },
    });
    fireEvent.change(within(modal).getByTestId("url-input"), {
      target: { value: "https://fresh.example/mcp" },
    });
    fireEvent.click(within(modal).getByTestId("submit-button"));

    await waitFor(() => expect(pushSpy).toHaveBeenCalledTimes(2));
    expect(pushSpy).toHaveBeenCalledWith(
      backendA,
      expect.objectContaining({ name: "fresh" }),
      undefined,
    );
    expect(pushSpy).toHaveBeenCalledWith(
      backendB,
      expect.objectContaining({ name: "fresh" }),
      undefined,
    );
    await waitFor(() => {
      expect(screen.getByTestId("mcp-fleet-push-result-a")).toHaveTextContent(
        "MCP$FLEET_RESULT_OK",
      );
      expect(screen.getByTestId("mcp-fleet-push-result-b")).toHaveTextContent(
        "MCP$FLEET_RESULT_OK",
      );
    });
  });

  // @spec PRJ-603 — Review Focus 5: the push key targets the existing
  // normalized entry, and "previous" is that backend's own current entry
  it('shows the backend that already has the normalized key under "will be overwritten" and pushes it with its own current entry as previous', async () => {
    const existingEntry = {
      transport: "stdio",
      command: "npx",
      args: ["old"],
    } as MCPServer;
    setRegisteredBackends([backendA, backendB]);
    setActiveSelection({ backendId: "a" });
    vi.spyOn(McpFleetService, "getConfig").mockImplementation(
      async (b): Promise<MCPConfig> =>
        b.id === "b" ? { My_Server: existingEntry } : {},
    );
    const pushSpy = vi
      .spyOn(McpFleetService, "push")
      .mockResolvedValue(undefined);

    renderSection();
    fireEvent.click(await screen.findByTestId("mcp-fleet-push-new"));
    const modal = await screen.findByTestId("mcp-fleet-push-modal");
    // MCPServerForm's own name field rejects spaces (MCP_SERVER_NAME_PATTERN
    // has no room for them), so exercise normalization with a name that
    // passes that pattern but still needs toMcpServerName's "_+" collapse
    // to reach the already-stored "My_Server" key.
    fireEvent.change(within(modal).getByTestId("server-name-input"), {
      target: { value: "My__Server" },
    });
    fireEvent.change(within(modal).getByTestId("url-input"), {
      target: { value: "https://fresh.example/mcp" },
    });
    fireEvent.click(within(modal).getByTestId("submit-button"));

    await screen.findByTestId("mcp-fleet-overwrite-target-b");
    expect(
      screen.queryByTestId("mcp-fleet-overwrite-target-a"),
    ).not.toBeInTheDocument();
    expect(pushSpy).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTestId("mcp-fleet-overwrite-confirm-button"));

    await waitFor(() => expect(pushSpy).toHaveBeenCalledTimes(2));
    expect(pushSpy).toHaveBeenCalledWith(
      backendA,
      expect.objectContaining({ name: "My__Server" }),
      undefined,
    );
    expect(pushSpy).toHaveBeenCalledWith(
      backendB,
      expect.objectContaining({ name: "My__Server" }),
      existingEntry,
    );
  });

  // @spec PRJ-603 — Partial failure; "Retry failed" resends only the failed ones
  it("retries the push only for the backend that failed", async () => {
    setRegisteredBackends([backendA, backendB]);
    setActiveSelection({ backendId: "a" });
    vi.spyOn(McpFleetService, "getConfig").mockResolvedValue({});
    const pushSpy = vi
      .spyOn(McpFleetService, "push")
      .mockImplementation(async (b) => {
        if (b.id === "b") throw new Error("ECONNREFUSED");
      });

    renderSection();
    fireEvent.click(await screen.findByTestId("mcp-fleet-push-new"));
    const modal = await screen.findByTestId("mcp-fleet-push-modal");
    fireEvent.change(within(modal).getByTestId("server-name-input"), {
      target: { value: "fresh" },
    });
    fireEvent.change(within(modal).getByTestId("url-input"), {
      target: { value: "https://fresh.example/mcp" },
    });
    fireEvent.click(within(modal).getByTestId("submit-button"));

    await waitFor(() =>
      expect(screen.getByTestId("mcp-fleet-push-result-b")).toHaveTextContent(
        "MCP$FLEET_RESULT_FAILED",
      ),
    );
    expect(screen.getByTestId("mcp-fleet-push-result-a")).toHaveTextContent(
      "MCP$FLEET_RESULT_OK",
    );
    expect(pushSpy).toHaveBeenCalledTimes(2);

    pushSpy.mockImplementation(async () => undefined);
    fireEvent.click(screen.getByTestId("mcp-fleet-retry-failed"));

    await waitFor(() => expect(pushSpy).toHaveBeenCalledTimes(3));
    expect(pushSpy).toHaveBeenLastCalledWith(
      backendB,
      expect.anything(),
      undefined,
    );
    await waitFor(() =>
      expect(screen.getByTestId("mcp-fleet-push-result-b")).toHaveTextContent(
        "MCP$FLEET_RESULT_OK",
      ),
    );
  });

  // @spec PRJ-603 — Redacted leaks are blocked before the push ever fires.
  // Prefill keeps the row's actual (redacted) values — it never blanks them
  // — so the natural "didn't touch the form" path already holds the
  // placeholder and must be blocked, for every kind of secret field.
  it.each([
    {
      name: "env",
      stored: {
        transport: "stdio",
        command: "npx",
        args: ["-y", "server"],
        env: { TOKEN: REDACTED_MCP_SECRET_VALUE },
      } as MCPServer,
    },
    {
      name: "bearer auth",
      stored: {
        transport: "http",
        url: "https://example.com/mcp",
        auth: { strategy: "bearer", value: REDACTED_MCP_SECRET_VALUE },
      } as MCPServer,
    },
  ])(
    "blocks the push and shows the secret-required error for a redacted $name value, without editing the form",
    async ({ stored }) => {
      setRegisteredBackends([backendA, backendB]);
      setActiveSelection({ backendId: "a" });
      vi.spyOn(McpFleetService, "getConfig").mockResolvedValue({
        shared: stored,
      });
      const pushSpy = vi
        .spyOn(McpFleetService, "push")
        .mockResolvedValue(undefined);

      renderSection();
      fireEvent.click(await screen.findByTestId("mcp-fleet-row-push-shared"));
      const modal = await screen.findByTestId("mcp-fleet-push-modal");

      // Submit immediately — no field is touched.
      fireEvent.click(within(modal).getByTestId("submit-button"));

      expect(
        await screen.findByTestId("mcp-fleet-secret-required"),
      ).toHaveTextContent("MCP$FLEET_SECRET_REQUIRED");
      expect(pushSpy).not.toHaveBeenCalled();
    },
  );

  // @spec PRJ-603 — The row's "Push…" strips the parts the form has no
  // control for (OAuth `auth.state`, raw top-level `headers`), so their
  // redacted values can't dead-end the submit. Only retypeable secrets remain.
  it("row-pushes an oauth2 entry with redacted state after retyping the client secret, without sending state, and notes re-authorization", async () => {
    setRegisteredBackends([backendA, backendB]);
    setActiveSelection({ backendId: "a" });
    vi.spyOn(McpFleetService, "getConfig").mockResolvedValue({
      shared: {
        transport: "http",
        url: "https://example.com/mcp",
        auth: {
          strategy: "oauth2",
          authentication: {
            type: "oauth",
            client_id: "client",
            client_secret: REDACTED_MCP_SECRET_VALUE,
          },
          state: { tokens: { access_token: REDACTED_MCP_SECRET_VALUE } },
        },
      } as unknown as MCPServer,
    });
    const pushSpy = vi
      .spyOn(McpFleetService, "push")
      .mockResolvedValue(undefined);

    renderSection();
    fireEvent.click(await screen.findByTestId("mcp-fleet-row-push-shared"));
    const modal = await screen.findByTestId("mcp-fleet-push-modal");
    fireEvent.change(within(modal).getByTestId("oauth-client-secret-input"), {
      target: { value: "new-secret" },
    });
    fireEvent.click(within(modal).getByTestId("submit-button"));
    expect(
      await screen.findByTestId("mcp-fleet-overwrite-oauth-note"),
    ).toHaveTextContent("MCP$FLEET_OVERWRITE_OAUTH_NOTE");
    fireEvent.click(screen.getByTestId("mcp-fleet-overwrite-confirm-button"));

    await waitFor(() => expect(pushSpy).toHaveBeenCalledTimes(2));
    const pushed = pushSpy.mock.calls[0][1];
    expect(pushed.auth).toEqual({
      strategy: "oauth2",
      authentication: {
        type: "oauth",
        client_id: "client",
        client_secret: "new-secret",
      },
    });
  });

  it("row-pushes a remote entry with redacted raw headers without sending headers", async () => {
    setRegisteredBackends([backendA, backendB]);
    setActiveSelection({ backendId: "a" });
    vi.spyOn(McpFleetService, "getConfig").mockResolvedValue({
      shared: {
        transport: "http",
        url: "https://example.com/mcp",
        headers: { Authorization: REDACTED_MCP_SECRET_VALUE },
      } as MCPServer,
    });
    const pushSpy = vi
      .spyOn(McpFleetService, "push")
      .mockResolvedValue(undefined);

    renderSection();
    fireEvent.click(await screen.findByTestId("mcp-fleet-row-push-shared"));
    const modal = await screen.findByTestId("mcp-fleet-push-modal");
    fireEvent.click(within(modal).getByTestId("submit-button"));
    fireEvent.click(
      await screen.findByTestId("mcp-fleet-overwrite-confirm-button"),
    );

    await waitFor(() => expect(pushSpy).toHaveBeenCalledTimes(2));
    expect(pushSpy.mock.calls[0][1]).not.toHaveProperty("headers");
    expect(
      screen.queryByTestId("mcp-fleet-overwrite-oauth-note"),
    ).not.toBeInTheDocument();
  });

  // @spec PRJ-601 — A slow backend neither hides the matrix nor stays
  // unchecked in the push checklist once it loads.
  it("renders the matrix while one backend is loading and checks that backend in an open push modal once it loads", async () => {
    setRegisteredBackends([backendA, backendB]);
    setActiveSelection({ backendId: "a" });
    let resolveB: (config: MCPConfig) => void = () => {};
    const configB = new Promise<MCPConfig>((resolve) => {
      resolveB = resolve;
    });
    vi.spyOn(McpFleetService, "getConfig").mockImplementation(async (b) =>
      b.id === "b"
        ? configB
        : { shared: { transport: "stdio", command: "npx" } as MCPServer },
    );

    renderSection();
    expect(
      await screen.findByTestId("mcp-fleet-cell-shared-b"),
    ).toHaveTextContent("HOME$LOADING");
    fireEvent.click(screen.getByTestId("mcp-fleet-push-new"));
    const target = await screen.findByTestId("mcp-fleet-push-target-b");
    expect(target).not.toBeChecked();

    resolveB({});

    await waitFor(() => expect(target).toBeChecked());
  });

  // @spec PRJ-603 — MCPServerForm can't represent "basic" auth (its own
  // auth-mode dropdown has no such option), so submitting untouched would
  // send `auth: null` and wipe it on every backend. Disable the row's own
  // "Push…" instead of relying on the post-submit guard.
  it('disables "Push…" for a row whose reference has an auth strategy the form can\'t represent', async () => {
    setRegisteredBackends([backendA, backendB]);
    setActiveSelection({ backendId: "a" });
    vi.spyOn(McpFleetService, "getConfig").mockResolvedValue({
      shared: {
        transport: "http",
        url: "https://example.com/mcp",
        auth: {
          strategy: "basic",
          username: "user",
          password: REDACTED_MCP_SECRET_VALUE,
        },
      } as MCPServer,
    });

    renderSection();

    expect(
      await screen.findByTestId("mcp-fleet-row-push-shared"),
    ).toBeDisabled();
  });

  // @spec PRJ-605 — On-demand test
  it("tests a cell on that backend and shows the tool count", async () => {
    setRegisteredBackends([backendA, backendB]);
    setActiveSelection({ backendId: "a" });
    vi.spyOn(McpFleetService, "getConfig").mockResolvedValue({
      shared: { transport: "stdio", command: "npx" } as MCPServer,
    });
    const testSpy = vi
      .spyOn(McpFleetService, "test")
      .mockResolvedValue({ ok: true, tools: ["a", "b"] });

    renderSection();
    fireEvent.click(await screen.findByTestId("mcp-fleet-test-shared-a"));

    await waitFor(() =>
      expect(testSpy).toHaveBeenCalledWith(
        backendA,
        "shared",
        expect.objectContaining({ command: "npx" }),
      ),
    );
    expect(
      await screen.findByTestId("mcp-fleet-test-result-shared-a"),
    ).toHaveTextContent("MCP$TEST_SUCCESS");
  });

  // @spec PRJ-604 — Remove an entry from servers
  it("removes an entry only from the checked backends, after confirming", async () => {
    setRegisteredBackends([backendA, backendB, backendC]);
    setActiveSelection({ backendId: "a" });
    vi.spyOn(McpFleetService, "getConfig").mockResolvedValue({
      shared: { transport: "stdio", command: "npx" } as MCPServer,
    });
    const removeSpy = vi
      .spyOn(McpFleetService, "remove")
      .mockResolvedValue(undefined);

    renderSection();
    fireEvent.click(await screen.findByTestId("mcp-fleet-row-remove-shared"));
    const modal = await screen.findByTestId("mcp-fleet-remove-modal");

    // All three are checked by default; uncheck B.
    fireEvent.click(within(modal).getByTestId("mcp-fleet-remove-target-b"));
    fireEvent.click(within(modal).getByTestId("mcp-fleet-remove-continue"));

    await screen.findByTestId("confirmation-modal");
    expect(removeSpy).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTestId("confirm-button"));

    await waitFor(() => expect(removeSpy).toHaveBeenCalledTimes(2));
    expect(removeSpy).toHaveBeenCalledWith(backendA, "shared");
    expect(removeSpy).toHaveBeenCalledWith(backendC, "shared");
    expect(removeSpy).not.toHaveBeenCalledWith(backendB, "shared");
  });
});
