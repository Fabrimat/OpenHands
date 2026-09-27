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

  // @spec PRJ-603 — Redacted leaks are blocked before the push ever fires
  it("blocks the push and shows the secret-required error when the env field still holds the redacted placeholder", async () => {
    const stdioEntry = {
      transport: "stdio",
      command: "npx",
      args: ["-y", "server"],
      env: { TOKEN: REDACTED_MCP_SECRET_VALUE },
    } as MCPServer;
    setRegisteredBackends([backendA, backendB]);
    setActiveSelection({ backendId: "a" });
    vi.spyOn(McpFleetService, "getConfig").mockResolvedValue({
      shared: stdioEntry,
    });
    const pushSpy = vi
      .spyOn(McpFleetService, "push")
      .mockResolvedValue(undefined);

    renderSection();
    fireEvent.click(await screen.findByTestId("mcp-fleet-row-push-shared"));
    const modal = await screen.findByTestId("mcp-fleet-push-modal");

    // Prefill blanks the secret — starting value has no redacted placeholder.
    expect(within(modal).getByTestId("env-input")).toHaveValue("TOKEN=");

    // The field still ends up holding the placeholder (e.g. pasted back in);
    // the guard must catch it regardless of how it got there.
    fireEvent.change(within(modal).getByTestId("env-input"), {
      target: { value: `TOKEN=${REDACTED_MCP_SECRET_VALUE}` },
    });
    fireEvent.click(within(modal).getByTestId("submit-button"));

    expect(
      await screen.findByTestId("mcp-fleet-secret-required"),
    ).toHaveTextContent("MCP$FLEET_SECRET_REQUIRED");
    expect(pushSpy).not.toHaveBeenCalled();
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
});
