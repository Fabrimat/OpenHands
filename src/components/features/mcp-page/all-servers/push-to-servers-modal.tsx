import React from "react";
import { useTranslation } from "react-i18next";
import type { MCPServer } from "@openhands/typescript-client";
import type { Backend } from "#/api/backend-registry/types";
import { usePushMcpToBackends } from "#/hooks/query/use-mcp-fleet";
import type { PushResult } from "#/api/mcp-service/mcp-fleet.api";
import { hasRedactedSecret, type FleetColumn } from "#/utils/mcp-fleet";
import { toMcpServerName } from "#/utils/mcp-server-name";
import type { MCPServerConfig } from "#/types/mcp-server";
import { I18nKey } from "#/i18n/declaration";
import { ModalBackdrop } from "#/components/shared/modals/modal-backdrop";
import { ModalCloseButton } from "#/components/shared/modals/modal-close-button";
import { BrandButton } from "#/components/features/settings/brand-button";
import { MCPServerForm } from "#/components/features/settings/mcp-settings/mcp-server-form";
import { modalTitleLgClassName } from "#/utils/modal-classes";

interface PushToServersModalProps {
  columns: FleetColumn[];
  /** Prefill when opened from a row's "Push…" action; undefined for a fresh entry. */
  initialServer?: MCPServerConfig;
  onClose: () => void;
}

type Target = { backend: Backend; previous: MCPServer | undefined };

type Step = "form" | "confirm" | "results";

function mergeResults(
  previous: PushResult[] | null,
  incoming: PushResult[],
): PushResult[] {
  const byId = new Map((previous ?? []).map((r) => [r.backendId, r]));
  for (const result of incoming) byId.set(result.backendId, result);
  return Array.from(byId.values());
}

// @spec PRJ-603 — Push an entry to servers
export function PushToServersModal({
  columns,
  initialServer,
  onClose,
}: PushToServersModalProps) {
  const { t } = useTranslation("openhands");
  const pushMutation = usePushMcpToBackends();

  const reachableIds = React.useMemo(
    () =>
      columns
        .filter((column) => column.config !== null)
        .map((column) => column.backend.id),
    [columns],
  );
  const [checkedIds, setCheckedIds] = React.useState(
    () => new Set(reachableIds),
  );
  const [step, setStep] = React.useState<Step>("form");
  const [secretError, setSecretError] = React.useState<string | null>(null);
  const [pendingServer, setPendingServer] =
    React.useState<MCPServerConfig | null>(null);
  const [pendingTargets, setPendingTargets] = React.useState<Target[]>([]);
  const [overwrittenBackends, setOverwrittenBackends] = React.useState<
    Backend[]
  >([]);
  const [results, setResults] = React.useState<PushResult[] | null>(null);

  const toggleBackend = (id: string, checked: boolean) => {
    setCheckedIds((prev) => {
      const next = new Set(prev);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  };

  const runPush = (server: MCPServerConfig, targets: Target[]) => {
    setStep("results");
    pushMutation.mutate(
      { targets, server },
      { onSuccess: (res) => setResults((prev) => mergeResults(prev, res)) },
    );
  };

  const handleFormSubmit = (server: MCPServerConfig) => {
    // @spec PRJ-603 — Redacted secrets are never sent
    if (hasRedactedSecret(server)) {
      setSecretError(t(I18nKey.MCP$FLEET_SECRET_REQUIRED));
      return;
    }
    setSecretError(null);

    const key = toMcpServerName(server.name || server.type);
    // @spec PRJ-603 — "previous" is looked up per checked backend's own
    // config, never the row's shared reference, so the overwrite patch
    // (and the confirmation list) reflect what that backend actually has.
    const targets: Target[] = columns
      .filter((column) => checkedIds.has(column.backend.id))
      .map((column) => ({
        backend: column.backend,
        previous: column.config?.[key],
      }));

    setPendingServer(server);
    setPendingTargets(targets);

    const overwritten = targets.filter((target) => target.previous);
    if (overwritten.length > 0) {
      setOverwrittenBackends(overwritten.map((target) => target.backend));
      setStep("confirm");
      return;
    }
    runPush(server, targets);
  };

  const handleConfirm = () => {
    if (!pendingServer) return;
    runPush(pendingServer, pendingTargets);
  };

  const handleRetry = () => {
    if (!pendingServer || !results) return;
    const failedIds = new Set(
      results.filter((r) => !r.ok).map((r) => r.backendId),
    );
    const retryTargets = pendingTargets.filter((target) =>
      failedIds.has(target.backend.id),
    );
    pushMutation.mutate(
      { targets: retryTargets, server: pendingServer },
      { onSuccess: (res) => setResults((prev) => mergeResults(prev, res)) },
    );
  };

  const isDismissBlocked = step === "results" && pushMutation.isPending;

  return (
    <ModalBackdrop
      onClose={isDismissBlocked ? undefined : onClose}
      closeOnEscape={!isDismissBlocked}
    >
      <div
        data-testid="mcp-fleet-push-modal"
        className="relative bg-base-secondary p-6 rounded-xl border border-[var(--oh-border)] w-[560px] max-w-[90vw] max-h-[90vh] overflow-y-auto custom-scrollbar flex flex-col gap-4"
      >
        <ModalCloseButton
          onClose={onClose}
          testId="mcp-fleet-push-modal-close"
          disabled={isDismissBlocked}
        />
        <h2 className={modalTitleLgClassName}>
          {t(I18nKey.MCP$FLEET_PUSH_TO_SERVERS)}
        </h2>

        {/* Kept mounted through the confirm overlay so cancelling the
            overwrite confirmation returns to the same, still-filled-in form
            (MCPServerForm's fields are uncontrolled; unmounting would lose
            them). It unmounts only once "results" replaces this content. */}
        {(step === "form" || step === "confirm") && (
          <>
            <MCPServerForm
              mode="add"
              server={initialServer}
              onSubmit={handleFormSubmit}
              onCancel={onClose}
            />
            {secretError && (
              <p
                data-testid="mcp-fleet-secret-required"
                className="text-sm text-red-500 whitespace-pre-wrap"
              >
                {secretError}
              </p>
            )}
            <div
              data-testid="mcp-fleet-push-checklist"
              className="flex flex-col gap-2 border-t border-[var(--oh-border)] pt-4"
            >
              {columns.map((column) => {
                const reachable = column.config !== null;
                return (
                  <label
                    key={column.backend.id}
                    className="flex items-center gap-2 text-sm"
                  >
                    <input
                      type="checkbox"
                      data-testid={`mcp-fleet-push-target-${column.backend.id}`}
                      checked={checkedIds.has(column.backend.id)}
                      disabled={!reachable}
                      onChange={(e) =>
                        toggleBackend(column.backend.id, e.target.checked)
                      }
                    />
                    {column.backend.name}
                    {!reachable && (
                      <span className="text-tertiary-alt">
                        {t(I18nKey.MCP$FLEET_STATE_UNREACHABLE)}
                      </span>
                    )}
                  </label>
                );
              })}
            </div>
          </>
        )}

        {step === "results" && (
          <div className="flex flex-col gap-2">
            {pendingTargets.map((target) => {
              const result = results?.find(
                (r) => r.backendId === target.backend.id,
              );
              return (
                <div
                  key={target.backend.id}
                  data-testid={`mcp-fleet-push-result-${target.backend.id}`}
                  className="flex items-center justify-between gap-2 text-sm"
                >
                  <span>{target.backend.name}</span>
                  <span
                    className={result?.ok ? "text-green-500" : "text-red-500"}
                  >
                    {!result
                      ? "…"
                      : result.ok
                        ? t(I18nKey.MCP$FLEET_RESULT_OK)
                        : `${t(I18nKey.MCP$FLEET_RESULT_FAILED)}: ${result.error}`}
                  </span>
                </div>
              );
            })}
            <div className="flex justify-end gap-2 mt-2">
              {results?.some((r) => !r.ok) && (
                <BrandButton
                  testId="mcp-fleet-retry-failed"
                  type="button"
                  variant="secondary"
                  onClick={handleRetry}
                  isDisabled={pushMutation.isPending}
                >
                  {t(I18nKey.MCP$FLEET_RETRY_FAILED)}
                </BrandButton>
              )}
              <BrandButton
                testId="mcp-fleet-push-close"
                type="button"
                variant="primary"
                onClick={onClose}
                isDisabled={pushMutation.isPending}
              >
                {t(I18nKey.BUTTON$CLOSE)}
              </BrandButton>
            </div>
          </div>
        )}
      </div>

      {/* A bespoke overlay rather than the shared ConfirmationModal: that
          component hardcodes "cancel-button"/"confirm-button" test ids,
          which would collide with MCPServerForm's own Cancel button — kept
          mounted underneath (see above) so its values survive a Cancel. */}
      {step === "confirm" && (
        <div
          data-testid="mcp-fleet-overwrite-confirm"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
        >
          <div className="bg-base-secondary p-4 rounded-xl flex flex-col gap-3 border border-[var(--oh-border)] max-w-[90vw]">
            <p>
              {t(I18nKey.MCP$FLEET_WILL_BE_OVERWRITTEN, {
                backends: overwrittenBackends.map((b) => b.name).join(", "),
              })}
            </p>
            <ul className="flex flex-col gap-1 text-sm">
              {overwrittenBackends.map((backend) => (
                <li
                  key={backend.id}
                  data-testid={`mcp-fleet-overwrite-target-${backend.id}`}
                >
                  {backend.name}
                </li>
              ))}
            </ul>
            <div className="flex justify-end gap-2">
              <BrandButton
                testId="mcp-fleet-overwrite-cancel"
                type="button"
                variant="secondary"
                onClick={() => setStep("form")}
              >
                {t(I18nKey.BUTTON$CANCEL)}
              </BrandButton>
              <BrandButton
                testId="mcp-fleet-overwrite-confirm-button"
                type="button"
                variant="primary"
                onClick={handleConfirm}
              >
                {t(I18nKey.BUTTON$CONFIRM)}
              </BrandButton>
            </div>
          </div>
        </div>
      )}
    </ModalBackdrop>
  );
}
