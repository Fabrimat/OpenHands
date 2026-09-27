import type {
  MCPConfig,
  MCPServer,
  MCPServerPatch,
} from "@openhands/typescript-client";
import type { Backend } from "#/api/backend-registry/types";
import type { MCPServerConfig } from "#/types/mcp-server";
import {
  buildMcpServerPatch,
  getMcpServerEnabled,
  hasRedactedMcpSecretLeaf,
  toCanonicalMcpServer,
} from "#/utils/mcp-config";

export type FingerprintField =
  | "transport"
  | "target"
  | "env_keys"
  | "header_keys"
  | "auth_strategy";

const FINGERPRINT_FIELDS: FingerprintField[] = [
  "transport",
  "target",
  "env_keys",
  "header_keys",
  "auth_strategy",
];

export type FleetCell =
  | {
      state: "present" | "disabled" | "differs";
      server: MCPServer;
      diff: FingerprintField[];
    }
  | { state: "missing" }
  | { state: "unreachable" };

export interface FleetColumn {
  backend: Backend;
  /** null = unreachable/loading error */
  config: MCPConfig | null;
}

export interface FleetRow {
  key: string;
  cells: FleetCell[];
  reference: MCPServer;
}

const sortedKeysJoined = (
  record: Record<string, string> | null | undefined,
): string =>
  Object.keys(record ?? {})
    .sort()
    .join(",");

// parseMcpConfig's normalizeTransport can yield either "http" or
// "streamable-http" for equivalent streamable-HTTP configs (raw "shttp"/
// undefined normalize to "http", while a literal "streamable-http" passes
// through unchanged); fold both into "http" so drift detection ignores that.
const normalizeFingerprintTransport = (
  transport: MCPServer["transport"],
): string => (transport === "streamable-http" ? "http" : transport);

// @spec PRJ-602 — Drift fingerprint ignores secret values
export function mcpFingerprint(
  server: MCPServer,
): Record<FingerprintField, string> {
  if (server.transport === "stdio") {
    return {
      transport: "stdio",
      target: [server.command, ...(server.args ?? [])].join(" "),
      env_keys: sortedKeysJoined(server.env),
      header_keys: "",
      auth_strategy: "",
    };
  }
  return {
    transport: normalizeFingerprintTransport(server.transport),
    target: server.url,
    env_keys: "",
    header_keys: sortedKeysJoined(server.headers),
    auth_strategy: server.auth?.strategy ?? "",
  };
}

const fingerprintKey = (server: MCPServer): string =>
  JSON.stringify(mcpFingerprint(server));

/** Most common fingerprint among the given servers; ties keep the earliest. */
function pickReferenceServer(servers: MCPServer[]): MCPServer {
  const counts = new Map<string, { count: number; server: MCPServer }>();
  for (const server of servers) {
    const key = fingerprintKey(server);
    const existing = counts.get(key);
    if (existing) existing.count += 1;
    else counts.set(key, { count: 1, server });
  }

  let best: { count: number; server: MCPServer } | undefined;
  for (const entry of counts.values()) {
    // Map iteration is insertion order, i.e. ascending "earliest column", so
    // a strict `>` keeps the first-seen entry on a tie.
    if (!best || entry.count > best.count) best = entry;
  }
  return best!.server;
}

function buildFleetRow(key: string, columns: FleetColumn[]): FleetRow {
  const present = columns
    .map((column) => column.config?.[key])
    .filter((server): server is MCPServer => !!server);

  const reference = pickReferenceServer(present);
  const referenceFingerprint = mcpFingerprint(reference);

  const cells: FleetCell[] = columns.map((column) => {
    if (column.config === null) return { state: "unreachable" };
    const server = column.config[key];
    if (!server) return { state: "missing" };

    const fingerprint = mcpFingerprint(server);
    const diff = FINGERPRINT_FIELDS.filter(
      (field) => fingerprint[field] !== referenceFingerprint[field],
    );
    if (diff.length > 0) return { state: "differs", server, diff };
    if (getMcpServerEnabled(server) === false) {
      return { state: "disabled", server, diff: [] };
    }
    return { state: "present", server, diff: [] };
  });

  return { key, cells, reference };
}

// @spec PRJ-601 — All-servers MCP view
export function buildFleetMatrix(columns: FleetColumn[]): FleetRow[] {
  const keys = new Set<string>();
  for (const column of columns) {
    if (!column.config) continue;
    for (const key of Object.keys(column.config)) keys.add(key);
  }

  return Array.from(keys)
    .sort()
    .map((key) => buildFleetRow(key, columns));
}

// @spec PRJ-603 — Replacement patch removes stale fields on transport switch
export function buildReplacementPatch(
  previous: MCPServer,
  edited: MCPServerConfig,
): MCPServerPatch {
  const patch = buildMcpServerPatch(previous, edited) as Record<
    string,
    unknown
  >;
  const canonical = toCanonicalMcpServer(edited) as Record<string, unknown>;
  const result: Record<string, unknown> = { ...patch };
  for (const key of Object.keys(previous as Record<string, unknown>)) {
    if (!(key in canonical) && !(key in result)) result[key] = null;
  }
  return result as MCPServerPatch;
}

export function hasRedactedSecret(server: MCPServerConfig): boolean {
  return hasRedactedMcpSecretLeaf({
    env: server.env,
    headers: server.headers,
    auth: server.auth,
  });
}
