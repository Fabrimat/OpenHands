import React from "react";
import { useTranslation } from "react-i18next";
import type { Backend } from "#/api/backend-registry/types";
import { useRemoveMcpFromBackends } from "#/hooks/query/use-mcp-fleet";
import type { PushResult } from "#/api/mcp-service/mcp-fleet.api";
import type { FleetColumn, FleetRow } from "#/utils/mcp-fleet";
import { I18nKey } from "#/i18n/declaration";
import { ModalBackdrop } from "#/components/shared/modals/modal-backdrop";
import { ModalCloseButton } from "#/components/shared/modals/modal-close-button";
import { ConfirmationModal } from "#/components/shared/modals/confirmation-modal";
import { BrandButton } from "#/components/features/settings/brand-button";
import { modalTitleLgClassName } from "#/utils/modal-classes";

interface RemoveFromServersModalProps {
  row: FleetRow;
  columns: FleetColumn[];
  onClose: () => void;
}

type Step = "select" | "confirm" | "results";

const HAS_KEY_STATES = new Set(["present", "disabled", "differs"]);

function mergeResults(
  previous: PushResult[] | null,
  incoming: PushResult[],
): PushResult[] {
  const byId = new Map((previous ?? []).map((r) => [r.backendId, r]));
  for (const result of incoming) byId.set(result.backendId, result);
  return Array.from(byId.values());
}

// @spec PRJ-604 — Remove an entry from servers
export function RemoveFromServersModal({
  row,
  columns,
  onClose,
}: RemoveFromServersModalProps) {
  const { t } = useTranslation("openhands");
  const removeMutation = useRemoveMcpFromBackends();

  // Only backends that actually have this key are offered — "missing" and
  // "unreachable" columns can't be acted on.
  const eligibleBackends = React.useMemo(
    () =>
      columns
        .filter((_, i) => HAS_KEY_STATES.has(row.cells[i].state))
        .map((column) => column.backend),
    [columns, row],
  );

  const [checkedIds, setCheckedIds] = React.useState(
    () => new Set(eligibleBackends.map((b) => b.id)),
  );
  const [step, setStep] = React.useState<Step>("select");
  const [targetBackends, setTargetBackends] = React.useState<Backend[]>([]);
  const [results, setResults] = React.useState<PushResult[] | null>(null);

  const toggle = (id: string, checked: boolean) => {
    setCheckedIds((prev) => {
      const next = new Set(prev);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  };

  const runRemove = (backends: Backend[]) => {
    setStep("results");
    removeMutation.mutate(
      { backends, key: row.key },
      { onSuccess: (res) => setResults((prev) => mergeResults(prev, res)) },
    );
  };

  const handleContinue = () => {
    const targets = eligibleBackends.filter((b) => checkedIds.has(b.id));
    setTargetBackends(targets);
    setStep("confirm");
  };

  const handleRetry = () => {
    if (!results) return;
    const failedIds = new Set(
      results.filter((r) => !r.ok).map((r) => r.backendId),
    );
    const retryTargets = targetBackends.filter((b) => failedIds.has(b.id));
    removeMutation.mutate(
      { backends: retryTargets, key: row.key },
      { onSuccess: (res) => setResults((prev) => mergeResults(prev, res)) },
    );
  };

  const isDismissBlocked = step === "results" && removeMutation.isPending;

  return (
    <ModalBackdrop
      onClose={isDismissBlocked ? undefined : onClose}
      closeOnEscape={!isDismissBlocked}
    >
      <div
        data-testid="mcp-fleet-remove-modal"
        className="relative bg-base-secondary p-6 rounded-xl border border-[var(--oh-border)] w-[480px] max-w-[90vw] max-h-[90vh] overflow-y-auto custom-scrollbar flex flex-col gap-4"
      >
        <ModalCloseButton
          onClose={onClose}
          testId="mcp-fleet-remove-modal-close"
          disabled={isDismissBlocked}
        />
        <h2 className={modalTitleLgClassName}>
          {t(I18nKey.MCP$FLEET_REMOVE_ROW)} — {row.key}
        </h2>

        {(step === "select" || step === "confirm") && (
          <>
            <div
              data-testid="mcp-fleet-remove-checklist"
              className="flex flex-col gap-2"
            >
              {eligibleBackends.map((backend) => (
                <label
                  key={backend.id}
                  className="flex items-center gap-2 text-sm"
                >
                  <input
                    type="checkbox"
                    data-testid={`mcp-fleet-remove-target-${backend.id}`}
                    checked={checkedIds.has(backend.id)}
                    onChange={(e) => toggle(backend.id, e.target.checked)}
                  />
                  {backend.name}
                </label>
              ))}
            </div>
            <div className="flex justify-end gap-2">
              <BrandButton
                testId="mcp-fleet-remove-cancel"
                type="button"
                variant="secondary"
                onClick={onClose}
              >
                {t(I18nKey.BUTTON$CANCEL)}
              </BrandButton>
              <BrandButton
                testId="mcp-fleet-remove-continue"
                type="button"
                variant="primary"
                onClick={handleContinue}
                isDisabled={checkedIds.size === 0}
              >
                {t(I18nKey.MCP$FLEET_REMOVE_ROW)}
              </BrandButton>
            </div>
          </>
        )}

        {step === "results" && (
          <div className="flex flex-col gap-2">
            {targetBackends.map((backend) => {
              const result = results?.find((r) => r.backendId === backend.id);
              return (
                <div
                  key={backend.id}
                  data-testid={`mcp-fleet-remove-result-${backend.id}`}
                  className="flex items-center justify-between gap-2 text-sm"
                >
                  <span>{backend.name}</span>
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
                  testId="mcp-fleet-remove-retry-failed"
                  type="button"
                  variant="secondary"
                  onClick={handleRetry}
                  isDisabled={removeMutation.isPending}
                >
                  {t(I18nKey.MCP$FLEET_RETRY_FAILED)}
                </BrandButton>
              )}
              <BrandButton
                testId="mcp-fleet-remove-close"
                type="button"
                variant="primary"
                onClick={onClose}
                isDisabled={removeMutation.isPending}
              >
                {t(I18nKey.BUTTON$CLOSE)}
              </BrandButton>
            </div>
          </div>
        )}
      </div>

      {step === "confirm" && (
        <ConfirmationModal
          text={t(I18nKey.MCP$FLEET_REMOVE_CONFIRM, {
            key: row.key,
            backends: targetBackends.map((b) => b.name).join(", "),
          })}
          onCancel={() => setStep("select")}
          onConfirm={() => runRemove(targetBackends)}
          isConfirming={removeMutation.isPending}
        />
      )}
    </ModalBackdrop>
  );
}
