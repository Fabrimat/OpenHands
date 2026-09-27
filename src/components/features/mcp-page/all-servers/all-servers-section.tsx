import React from "react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import type { MCPServer } from "@openhands/typescript-client";
import type { Backend } from "#/api/backend-registry/types";
import type { MCPAuthCredential } from "#/types/mcp-auth";
import type {
  ExtendedMCPTestResponse,
  MCPServerConfig,
} from "#/types/mcp-server";
import { I18nKey } from "#/i18n/declaration";
import { BrandButton } from "#/components/features/settings/brand-button";
import { useMcpFleet, useTestMcpOnBackend } from "#/hooks/query/use-mcp-fleet";
import {
  type FingerprintField,
  type FleetCell,
  type FleetRow,
} from "#/utils/mcp-fleet";
import { flattenMcpConfig } from "#/utils/mcp-installed-servers";
import { makeMcpTestErrorMessage } from "#/utils/mcp-test-error-message";
import { PushToServersModal } from "./push-to-servers-modal";
import { RemoveFromServersModal } from "./remove-from-servers-modal";

const STATE_LABEL_KEYS: Record<FleetCell["state"], I18nKey> = {
  present: I18nKey.MCP$FLEET_STATE_PRESENT,
  disabled: I18nKey.MCP$FLEET_STATE_DISABLED,
  missing: I18nKey.MCP$FLEET_STATE_MISSING,
  differs: I18nKey.MCP$FLEET_STATE_DIFFERS,
  unreachable: I18nKey.MCP$FLEET_STATE_UNREACHABLE,
};

const FIELD_LABEL_KEYS: Record<FingerprintField, I18nKey> = {
  transport: I18nKey.MCP$FLEET_FIELD_TRANSPORT,
  target: I18nKey.MCP$FLEET_FIELD_TARGET,
  env_keys: I18nKey.MCP$FLEET_FIELD_ENV_KEYS,
  header_keys: I18nKey.MCP$FLEET_FIELD_HEADER_KEYS,
  auth_strategy: I18nKey.MCP$FLEET_FIELD_AUTH_STRATEGY,
};

function blankStringRecord(
  record: Record<string, string> | undefined,
): Record<string, string> | undefined {
  if (!record) return undefined;
  return Object.fromEntries(Object.keys(record).map((key) => [key, ""]));
}

function blankAuth(
  auth: MCPAuthCredential | undefined,
): MCPAuthCredential | undefined {
  if (!auth) return auth;
  switch (auth.strategy) {
    case "bearer":
    case "api_key":
      return { ...auth, value: "" };
    case "basic":
      return { ...auth, password: "" };
    case "header":
      return { ...auth, headers: blankStringRecord(auth.headers) ?? {} };
    case "oauth2":
      return {
        ...auth,
        state: undefined,
        authentication: auth.authentication
          ? { ...auth.authentication, client_secret: "" }
          : auth.authentication,
      };
    default:
      return auth;
  }
}

// @spec PRJ-603 — Starting from a row prefills non-secret fields only;
// every env/header/auth secret value is cleared so it must be re-entered.
function blankMcpSecrets(server: MCPServerConfig): MCPServerConfig {
  return {
    ...server,
    ...(server.env && { env: blankStringRecord(server.env) }),
    ...(server.headers && { headers: blankStringRecord(server.headers) }),
    ...(server.auth && { auth: blankAuth(server.auth) }),
  };
}

interface FleetTableCellProps {
  t: TFunction<"openhands">;
  rowKey: string;
  cell: FleetCell;
  backend: Backend;
  result: ExtendedMCPTestResponse | undefined;
  isTestPending: boolean;
  onTest: (server: MCPServer) => void;
}

// @spec PRJ-602, PRJ-605 — One drift-matrix cell: status, diff reason, and
// an on-demand "Test" action for any cell that has a stored server.
function FleetTableCell({
  t,
  rowKey,
  cell,
  backend,
  result,
  isTestPending,
  onTest,
}: FleetTableCellProps) {
  const label = t(STATE_LABEL_KEYS[cell.state]);
  // Narrows via the shape difference (only this branch carries `server`/
  // `diff`), matching the FleetCell narrowing convention from mcp-fleet.ts.
  if (!("server" in cell)) {
    return (
      <td
        data-testid={`mcp-fleet-cell-${rowKey}-${backend.id}`}
        aria-label={label}
        className="px-2 py-1 align-top"
      >
        {label}
      </td>
    );
  }

  const diffLabel =
    cell.state === "differs"
      ? cell.diff.map((field) => t(FIELD_LABEL_KEYS[field])).join(", ")
      : undefined;
  const ariaLabel = diffLabel ? `${label}: ${diffLabel}` : label;

  return (
    <td
      data-testid={`mcp-fleet-cell-${rowKey}-${backend.id}`}
      title={diffLabel}
      aria-label={ariaLabel}
      className="px-2 py-1 align-top"
    >
      <div className="flex flex-col gap-1">
        <span>{label}</span>
        <BrandButton
          type="button"
          variant="secondary"
          testId={`mcp-fleet-test-${rowKey}-${backend.id}`}
          onClick={() => onTest(cell.server)}
          isDisabled={isTestPending}
        >
          {t(I18nKey.MCP$FLEET_TEST)}
        </BrandButton>
        {result && (
          <span
            data-testid={`mcp-fleet-test-result-${rowKey}-${backend.id}`}
            className={result.ok ? "text-green-500" : "text-red-500"}
          >
            {result.ok
              ? t(I18nKey.MCP$TEST_SUCCESS, { count: result.tools.length })
              : makeMcpTestErrorMessage(t, result.error_kind, result.error)}
          </span>
        )}
      </div>
    </td>
  );
}

// @spec PRJ-601, PRJ-602 — All-servers MCP drift matrix
export function AllServersSection() {
  const { t } = useTranslation("openhands");
  const { columns, rows, isLoading } = useMcpFleet();
  const testMutation = useTestMcpOnBackend();

  const [pushRequest, setPushRequest] = React.useState<{
    initialServer?: MCPServerConfig;
  } | null>(null);
  const [removeRow, setRemoveRow] = React.useState<FleetRow | null>(null);
  const [testResults, setTestResults] = React.useState<
    Record<string, ExtendedMCPTestResponse>
  >({});

  // @spec PRJ-601 — Hidden for a single local backend or cloud-only registries
  if (columns.length < 2) return null;

  const handlePushRow = (row: FleetRow) => {
    const prefill = flattenMcpConfig({ [row.key]: row.reference })[0];
    setPushRequest({ initialServer: blankMcpSecrets(prefill) });
  };

  return (
    <section className="flex flex-col gap-3" data-testid="mcp-fleet-section">
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-1">
          <h2 className="text-base font-semibold text-foreground">
            {t(I18nKey.MCP$FLEET_TITLE)}
          </h2>
          <p className="max-w-2xl text-sm text-tertiary-light">
            {t(I18nKey.MCP$FLEET_DESCRIPTION)}
          </p>
        </div>
        <BrandButton
          type="button"
          variant="secondary"
          testId="mcp-fleet-push-new"
          className="flex-shrink-0 whitespace-nowrap"
          onClick={() => setPushRequest({})}
        >
          {t(I18nKey.MCP$FLEET_PUSH_TO_SERVERS)}
        </BrandButton>
      </div>

      {!isLoading && rows.length > 0 && (
        <div className="overflow-x-auto">
          <table data-testid="mcp-fleet-table" className="w-full text-sm">
            <thead>
              <tr>
                <th aria-hidden className="text-left px-2 py-1" />
                {columns.map((column) => (
                  <th
                    key={column.backend.id}
                    className="text-left px-2 py-1 font-medium"
                  >
                    {column.backend.name}
                  </th>
                ))}
                <th aria-hidden className="text-left px-2 py-1" />
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.key}>
                  <td className="px-2 py-1 font-medium align-top">{row.key}</td>
                  {row.cells.map((cell, i) => {
                    const { backend } = columns[i];
                    const resultKey = `${row.key}:${backend.id}`;
                    return (
                      <FleetTableCell
                        key={backend.id}
                        t={t}
                        rowKey={row.key}
                        cell={cell}
                        backend={backend}
                        result={testResults[resultKey]}
                        isTestPending={testMutation.isPending}
                        onTest={(server) =>
                          testMutation.mutate(
                            { backend, key: row.key, stored: server },
                            {
                              onSuccess: (result) =>
                                setTestResults((prev) => ({
                                  ...prev,
                                  [resultKey]: result,
                                })),
                            },
                          )
                        }
                      />
                    );
                  })}
                  <td className="px-2 py-1 align-top">
                    <div className="flex gap-2">
                      <BrandButton
                        type="button"
                        variant="secondary"
                        testId={`mcp-fleet-row-push-${row.key}`}
                        onClick={() => handlePushRow(row)}
                      >
                        {t(I18nKey.MCP$FLEET_PUSH_ROW)}
                      </BrandButton>
                      <BrandButton
                        type="button"
                        variant="secondary"
                        testId={`mcp-fleet-row-remove-${row.key}`}
                        onClick={() => setRemoveRow(row)}
                      >
                        {t(I18nKey.MCP$FLEET_REMOVE_ROW)}
                      </BrandButton>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {pushRequest && (
        <PushToServersModal
          columns={columns}
          initialServer={pushRequest.initialServer}
          onClose={() => setPushRequest(null)}
        />
      )}
      {removeRow && (
        <RemoveFromServersModal
          row={removeRow}
          columns={columns}
          onClose={() => setRemoveRow(null)}
        />
      )}
    </section>
  );
}
