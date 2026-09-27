import { describe, it, expect, vi, beforeEach } from "vitest";
import type { MCPServer } from "@openhands/typescript-client";
import type { Backend } from "#/api/backend-registry/types";
import { __resetActiveStoreForTests } from "#/api/backend-registry/active-store";
import type { MCPServerConfig } from "#/types/mcp-server";
import {
  REDACTED_MCP_SECRET_VALUE,
  toCanonicalMcpServer,
} from "#/utils/mcp-config";
import { buildReplacementPatch } from "#/utils/mcp-fleet";

const {
  mockGetSettings,
  mockCreateMcpServer,
  mockUpdateSettings,
  mockDeleteMcpServer,
  mockTestServer,
} = vi.hoisted(() => ({
  mockGetSettings: vi.fn(),
  mockCreateMcpServer: vi.fn(),
  mockUpdateSettings: vi.fn(),
  mockDeleteMcpServer: vi.fn(),
  mockTestServer: vi.fn(),
}));

// Real classes so `new SettingsClient(...)` / `new MCPClient(...)` work; every
// method delegates to a shared spy prefixed with the constructor's own host,
// so per-backend assertions (which host got which call) don't need instance
// tracking beyond that closure. Mirrors the mcp-service.api.test.ts style.
vi.mock("@openhands/typescript-client/clients", () => ({
  SettingsClient: vi.fn(function SettingsClientMock(
    this: unknown,
    options: { host: string; apiKey?: string },
  ) {
    return {
      getSettings: (opts?: unknown) => mockGetSettings(options.host, opts),
      createMcpServer: (key: string, server: unknown) =>
        mockCreateMcpServer(options.host, key, server),
      updateSettings: (payload: unknown) =>
        mockUpdateSettings(options.host, payload),
      deleteMcpServer: (key: string) => mockDeleteMcpServer(options.host, key),
    };
  }),
  MCPClient: vi.fn(function MCPClientMock(
    this: unknown,
    options: { host: string; apiKey?: string },
  ) {
    return {
      testServer: (request: unknown) => mockTestServer(options.host, request),
      close: vi.fn(),
    };
  }),
}));

import {
  McpFleetService,
  pushToBackends,
  removeFromBackends,
} from "#/api/mcp-service/mcp-fleet.api";

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

beforeEach(() => {
  vi.clearAllMocks();
  __resetActiveStoreForTests();
  mockGetSettings.mockResolvedValue({ agent_settings: {} });
  mockCreateMcpServer.mockResolvedValue(undefined);
  mockUpdateSettings.mockResolvedValue(undefined);
  mockDeleteMcpServer.mockResolvedValue(undefined);
});

// @spec PRJ-603 — Push an entry to servers
describe("McpFleetService.push", () => {
  it("calls createMcpServer with the canonical server on that backend's host when there is no previous entry", async () => {
    const server: MCPServerConfig = {
      id: "x",
      type: "stdio",
      name: "My Server",
      command: "npx",
      args: ["-y", "server"],
    };

    await McpFleetService.push(backendA, server, undefined);

    expect(mockCreateMcpServer).toHaveBeenCalledWith(
      backendA.host,
      "My_Server",
      toCanonicalMcpServer(server),
    );
    expect(mockUpdateSettings).not.toHaveBeenCalled();
  });

  it("sends one updateSettings holding the replacement patch when there is a previous entry", async () => {
    const previous = { transport: "stdio", command: "npx" } as MCPServer;
    const server: MCPServerConfig = {
      id: "x",
      type: "stdio",
      name: "x",
      command: "npx",
      args: ["-y", "server"],
    };

    await McpFleetService.push(backendA, server, previous);

    expect(mockUpdateSettings).toHaveBeenCalledTimes(1);
    expect(mockUpdateSettings).toHaveBeenCalledWith(backendA.host, {
      agent_settings_diff: {
        mcp_config: { x: buildReplacementPatch(previous, server) },
      },
    });
    expect(mockCreateMcpServer).not.toHaveBeenCalled();
  });

  it("rejects and sends nothing when the server holds a redacted secret", async () => {
    const server: MCPServerConfig = {
      id: "x",
      type: "stdio",
      name: "x",
      command: "npx",
      env: { TOKEN: REDACTED_MCP_SECRET_VALUE },
    };

    await expect(
      McpFleetService.push(backendA, server, undefined),
    ).rejects.toThrow();
    expect(mockCreateMcpServer).not.toHaveBeenCalled();
    expect(mockUpdateSettings).not.toHaveBeenCalled();
  });
});

// @spec PRJ-604 — Remove an entry from servers
describe("McpFleetService.remove", () => {
  it("deletes the named entry on that backend", async () => {
    await McpFleetService.remove(backendA, "x");
    expect(mockDeleteMcpServer).toHaveBeenCalledWith(backendA.host, "x");
  });
});

// @spec PRJ-603 — Partial failure isolation
describe("pushToBackends", () => {
  it("pushes to every target independently, reports the failed one, and redacts the typed secret from its error", async () => {
    mockCreateMcpServer.mockImplementation(async (host: string) => {
      if (host === backendB.host) {
        throw new Error("500 rejected value TOKEN-VALUE-123456");
      }
      return undefined;
    });
    const server: MCPServerConfig = {
      id: "x",
      type: "stdio",
      name: "x",
      command: "npx",
      env: { TOKEN: "TOKEN-VALUE-123456" },
    };

    const results = await pushToBackends(
      [
        { backend: backendA, previous: undefined },
        { backend: backendB, previous: undefined },
      ],
      server,
    );

    expect(mockCreateMcpServer).toHaveBeenCalledTimes(2);
    expect(results[0]).toEqual({ backendId: "a", ok: true });
    expect(results[1].ok).toBe(false);
    const failure = results[1] as { ok: false; error: string };
    expect(failure.error).not.toContain("TOKEN-VALUE-123456");
  });
});

// @spec PRJ-604 — Partial failure isolation
describe("removeFromBackends", () => {
  it("removes from every backend independently and isolates one failure", async () => {
    mockDeleteMcpServer.mockImplementation(async (host: string) => {
      if (host === backendB.host) throw new Error("not found");
      return undefined;
    });

    const results = await removeFromBackends([backendA, backendB], "x");

    expect(results).toEqual([
      { backendId: "a", ok: true },
      { backendId: "b", ok: false, error: "not found" },
    ]);
  });
});

// @spec PRJ-605 — On-demand test
describe("McpFleetService.test", () => {
  it("substitutes redacted leaves from the target backend's encrypted settings and tests on that backend", async () => {
    mockGetSettings.mockResolvedValue({
      agent_settings: {
        mcp_config: {
          slack: { env: { SLACK_BOT_TOKEN: "gAAAAA-cipher" } },
        },
      },
    });
    mockTestServer.mockResolvedValue({
      ok: true,
      tools: ["slack_list_channels"],
    });

    const stored = {
      transport: "stdio",
      command: "npx",
      args: ["-y", "@zencoderai/slack-mcp-server"],
      env: { SLACK_TEAM_ID: "T01", SLACK_BOT_TOKEN: REDACTED_MCP_SECRET_VALUE },
    } as MCPServer;

    const result = await McpFleetService.test(backendA, "slack", stored);

    expect(mockGetSettings).toHaveBeenCalledWith(backendA.host, {
      exposeSecrets: "encrypted",
    });
    expect(mockTestServer).toHaveBeenCalledWith(
      backendA.host,
      expect.objectContaining({
        server: expect.objectContaining({
          env: { SLACK_TEAM_ID: "T01", SLACK_BOT_TOKEN: "gAAAAA-cipher" },
        }),
      }),
    );
    expect(result).toEqual({ ok: true, tools: ["slack_list_channels"] });
  });
});
