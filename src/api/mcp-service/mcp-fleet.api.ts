import {
  MCPClient,
  SettingsClient,
} from "@openhands/typescript-client/clients";
import type { MCPConfig, MCPServer } from "@openhands/typescript-client";
import { getAgentServerClientOptions } from "../agent-server-client-options";
import type { Backend } from "../backend-registry/types";
import type {
  ExtendedMCPTestResponse,
  MCPServerConfig,
} from "#/types/mcp-server";
import { parseMcpConfig, toCanonicalMcpServer } from "#/utils/mcp-config";
import { buildReplacementPatch, hasRedactedSecret } from "#/utils/mcp-fleet";
import { flattenMcpConfig } from "#/utils/mcp-installed-servers";
import { getCredentialValidationForServer } from "#/utils/mcp-credential-validation";
import { redactMcpSecrets } from "#/utils/redact-mcp-secrets";
import { retrieveAxiosErrorMessage } from "#/utils/retrieve-axios-error-message";
import { toMcpServerName } from "#/utils/mcp-server-name";
import {
  buildMcpTestRequest,
  finalizeMcpTestResponse,
} from "./mcp-service.api";
import type {
  StoredMcpServer,
  StoredMcpServerLoader,
} from "./mcp-redacted-credentials";

const MCP_SECRET_REQUIRED_ERROR =
  "Fill in every secret field before pushing — the redacted placeholder can never be sent.";

function clientOptionsFor(backend: Backend) {
  return getAgentServerClientOptions({
    host: backend.host,
    apiKey: backend.apiKey,
  });
}

function clientFor(backend: Backend): SettingsClient {
  return new SettingsClient(clientOptionsFor(backend));
}

/** Reads the redacted secret's stored (encrypted) counterpart off `backend`, not the active one. */
function backendStoredServerLoader(backend: Backend): StoredMcpServerLoader {
  return async (server) => {
    const response = await clientFor(backend).getSettings({
      exposeSecrets: "encrypted",
    });
    const mcpConfig = response.agent_settings?.mcp_config;
    if (!mcpConfig || typeof mcpConfig !== "object") return undefined;
    return (mcpConfig as Record<string, StoredMcpServer>)[server.id];
  };
}

// @spec PRJ-601, PRJ-603, PRJ-604, PRJ-605 — Per-backend MCP fleet operations
export const McpFleetService = {
  async getConfig(backend: Backend): Promise<MCPConfig> {
    const response = await clientFor(backend).getSettings();
    return parseMcpConfig(response.agent_settings?.mcp_config);
  },

  // @spec PRJ-603 — Push an entry to servers
  async push(
    backend: Backend,
    server: MCPServerConfig,
    previous: MCPServer | undefined,
  ): Promise<void> {
    if (hasRedactedSecret(server)) {
      throw new Error(MCP_SECRET_REQUIRED_ERROR);
    }
    const key = toMcpServerName(server.name || server.type);
    if (previous === undefined) {
      await clientFor(backend).createMcpServer(
        key,
        toCanonicalMcpServer(server),
      );
      return;
    }
    await clientFor(backend).updateSettings({
      agent_settings_diff: {
        mcp_config: { [key]: buildReplacementPatch(previous, server) },
      },
    });
  },

  // @spec PRJ-604 — Remove an entry from servers
  async remove(backend: Backend, key: string): Promise<void> {
    await clientFor(backend).deleteMcpServer(key);
  },

  // @spec PRJ-605 — On-demand test, run for the entry stored on that backend
  async test(
    backend: Backend,
    key: string,
    stored: MCPServer,
  ): Promise<ExtendedMCPTestResponse> {
    const server = flattenMcpConfig({ [key]: stored })[0];
    const validation = getCredentialValidationForServer(server);
    const { request, substituted } = await buildMcpTestRequest(
      server,
      backendStoredServerLoader(backend),
    );
    const client = new MCPClient(clientOptionsFor(backend));
    try {
      const result = (await client.testServer(
        request,
      )) as ExtendedMCPTestResponse;
      return finalizeMcpTestResponse(result, validation, [substituted, server]);
    } finally {
      client.close();
    }
  },
};

export type PushResult =
  | { backendId: string; ok: true }
  | { backendId: string; ok: false; error: string };

function toPushResult(
  backendId: string,
  settled: PromiseSettledResult<void>,
  redactionSource?: MCPServerConfig,
): PushResult {
  if (settled.status === "fulfilled") return { backendId, ok: true };
  const message = retrieveAxiosErrorMessage(settled.reason);
  return {
    backendId,
    ok: false,
    error: redactMcpSecrets(message, redactionSource),
  };
}

// @spec PRJ-603 — Partial failure: every target runs independently
export async function pushToBackends(
  targets: { backend: Backend; previous: MCPServer | undefined }[],
  server: MCPServerConfig,
): Promise<PushResult[]> {
  const settled = await Promise.allSettled(
    targets.map(({ backend, previous }) =>
      McpFleetService.push(backend, server, previous),
    ),
  );
  return settled.map((result, i) =>
    toPushResult(targets[i].backend.id, result, server),
  );
}

// @spec PRJ-604 — Partial failure: every target runs independently
export async function removeFromBackends(
  backends: Backend[],
  key: string,
): Promise<PushResult[]> {
  const settled = await Promise.allSettled(
    backends.map((backend) => McpFleetService.remove(backend, key)),
  );
  return settled.map((result, i) => toPushResult(backends[i].id, result));
}
