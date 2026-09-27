import { describe, expect, it } from "vitest";
import type { MCPConfig, MCPServer } from "@openhands/typescript-client";
import type { Backend } from "#/api/backend-registry/types";
import type { MCPServerConfig } from "#/types/mcp-server";
import { REDACTED_MCP_SECRET_VALUE } from "#/utils/mcp-config";
import {
  buildFleetMatrix,
  buildReplacementPatch,
  hasRedactedSecret,
  mcpFingerprint,
  type FleetCell,
  type FleetColumn,
  type FingerprintField,
} from "#/utils/mcp-fleet";

const backend = (id: string): Backend => ({
  id,
  name: id,
  host: `https://${id}.example`,
  apiKey: "key",
  kind: "local",
});

const stdioServer = (overrides: Partial<MCPServer> = {}): MCPServer =>
  ({
    transport: "stdio",
    command: "npx",
    args: ["-y", "server-a"],
    ...overrides,
  }) as MCPServer;

const remoteServer = (overrides: Partial<MCPServer> = {}): MCPServer =>
  ({
    transport: "http",
    url: "https://mcp.example/a",
    ...overrides,
  }) as MCPServer;

/** Builds a matrix from configs, one per column, and returns the row for "x". */
function rowFor(configs: (MCPConfig | null)[]) {
  const columns: FleetColumn[] = configs.map((config, index) => ({
    backend: backend(`b${index}`),
    config,
  }));
  const rows = buildFleetMatrix(columns);
  return rows.find((row) => row.key === "x")!;
}

describe("mcpFingerprint", () => {
  // parseMcpConfig's normalizeTransport can yield either raw value for
  // equivalent streamable-HTTP configs; the fingerprint must not see drift.
  it("treats http and streamable-http as the same transport", () => {
    const http = mcpFingerprint(remoteServer({ transport: "http" }));
    const streamable = mcpFingerprint(
      remoteServer({ transport: "streamable-http" }),
    );
    expect(http).toEqual(streamable);
  });
});

describe("buildFleetMatrix", () => {
  // @spec PRJ-601 — All-servers MCP view
  // @spec PRJ-602 — Drift fingerprint
  it.each<{
    name: string;
    configs: (MCPConfig | null)[];
    expectedStates: FleetCell["state"][];
    expectedDiff?: FingerprintField[];
  }>([
    {
      name: "the same entry on 2 backends gives two present cells",
      configs: [{ x: remoteServer() }, { x: remoteServer() }],
      expectedStates: ["present", "present"],
    },
    {
      name: "a different url on one backend gives that cell differs with diff: [target]",
      configs: [
        { x: remoteServer() },
        { x: remoteServer({ url: "https://mcp.example/other" }) },
      ],
      expectedStates: ["present", "differs"],
      expectedDiff: ["target"],
    },
    {
      name: "an entry missing on one backend gives missing",
      configs: [{ x: stdioServer() }, {}],
      expectedStates: ["present", "missing"],
    },
    {
      name: "a null config gives unreachable",
      configs: [{ x: stdioServer() }, null],
      expectedStates: ["present", "unreachable"],
    },
    {
      name: "enabled: false with an equal fingerprint gives disabled",
      configs: [
        { x: stdioServer() },
        { x: stdioServer({ enabled: false } as Partial<MCPServer>) },
      ],
      expectedStates: ["present", "disabled"],
    },
    {
      name: "env values differ but env keys are equal, so cells are not differs",
      configs: [
        { x: stdioServer({ env: { A: "1" } }) },
        { x: stdioServer({ env: { A: "2" } }) },
      ],
      expectedStates: ["present", "present"],
    },
  ])("$name", ({ configs, expectedStates, expectedDiff }) => {
    const row = rowFor(configs);
    expect(row.cells.map((cell) => cell.state)).toEqual(expectedStates);
    if (expectedDiff) {
      const differing = row.cells.find((cell) => cell.state === "differs");
      expect(
        differing && "diff" in differing ? differing.diff : undefined,
      ).toEqual(expectedDiff);
    }
  });

  it("three backends with fingerprints A, A, B give a reference of A, so only the B cell is differs", () => {
    const a = remoteServer();
    const b = remoteServer({ url: "https://mcp.example/b" });
    const row = rowFor([{ x: a }, { x: { ...a } }, { x: b }]);
    expect(row.reference).toEqual(a);
    expect(row.cells.map((cell) => cell.state)).toEqual([
      "present",
      "present",
      "differs",
    ]);
  });

  it("a 1-1 tie goes to the first column", () => {
    const first = remoteServer();
    const second = remoteServer({ url: "https://mcp.example/other" });
    const row = rowFor([{ x: first }, { x: second }]);
    expect(row.reference).toEqual(first);
  });

  it("rows come back sorted by key", () => {
    const columns: FleetColumn[] = [
      {
        backend: backend("b0"),
        config: { zebra: stdioServer(), alpha: stdioServer() },
      },
    ];
    const rows = buildFleetMatrix(columns);
    expect(rows.map((row) => row.key)).toEqual(["alpha", "zebra"]);
  });
});

describe("buildReplacementPatch", () => {
  // @spec PRJ-603 — Push an entry to servers (replacement removes stale fields)
  it("replacing a remote entry with header auth by a stdio entry nulls the stale remote fields", () => {
    const previous = remoteServer({
      headers: { "X-Foo": "bar" },
      auth: { strategy: "header", headers: { Authorization: "secret" } },
    } as Partial<MCPServer>);
    const edited: MCPServerConfig = {
      id: "x",
      type: "stdio",
      name: "x",
      command: "npx",
      args: ["-y", "server"],
    };

    const patch = buildReplacementPatch(previous, edited);

    expect(patch).toMatchObject({
      transport: "stdio",
      command: "npx",
      args: ["-y", "server"],
      url: null,
      headers: null,
      auth: null,
    });
  });

  it("removes stale nested env keys when replacing stdio with fewer env vars", () => {
    const previous = stdioServer({
      env: { A: "1", B: "2" },
    } as Partial<MCPServer>);
    const edited: MCPServerConfig = {
      id: "x",
      type: "stdio",
      name: "x",
      command: "npx",
      env: { A: "new-a" },
    };

    const patch = buildReplacementPatch(previous, edited);

    expect(patch.env).toEqual({ A: "new-a", B: null });
  });
});

describe("hasRedactedSecret", () => {
  it("is true for a redacted env value", () => {
    expect(
      hasRedactedSecret({
        id: "x",
        type: "stdio",
        command: "npx",
        env: { K: REDACTED_MCP_SECRET_VALUE },
      }),
    ).toBe(true);
  });

  it("is false for fresh values", () => {
    expect(
      hasRedactedSecret({
        id: "x",
        type: "stdio",
        command: "npx",
        env: { K: "fresh-value" },
      }),
    ).toBe(false);
  });
});
