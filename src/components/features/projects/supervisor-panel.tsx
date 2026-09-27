import React from "react";
import { useTranslation } from "react-i18next";
import { BackendStatusDot } from "#/components/features/backends/backend-status-dot";
import { BrandButton } from "#/components/features/settings/brand-button";
import { SettingsInput } from "#/components/features/settings/settings-input";
import { SettingsSwitch } from "#/components/features/settings/settings-switch";
import { LoadingSpinner } from "#/components/shared/loading-spinner";
import { useActiveBackendContext } from "#/contexts/active-backend-context";
import { useBackendsHealth } from "#/hooks/query/use-backends-health";
import { usePrimaryBackend, useProjects } from "#/hooks/query/use-projects";
import {
  useSaveSupervisorSettings,
  useSupervisorRows,
  useSupervisorSettings,
  useSupervisorSync,
  type RowState,
} from "#/hooks/query/use-supervisor";
import { I18nKey } from "#/i18n/declaration";
import {
  DEFAULT_SUPERVISOR_SETTINGS,
  isValidSupervisorSettings,
  isValidTimezone,
  LABEL_PATTERN,
  LIST_ID_PATTERN,
  TIME_PATTERN,
  TIMEOUT_MAX_SECONDS,
  TIMEOUT_MIN_SECONDS,
  type SupervisorServer,
  type SupervisorSettings,
} from "#/types/supervisor";
import { displayErrorToast } from "#/utils/custom-toast-handlers";
import { formControlSettingsFieldClassName } from "#/utils/form-control-classes";
import { hostsMatch, normalizeHost } from "#/utils/project-matching";
import {
  buildServerSupervisorPrompt,
  projectsForHost,
} from "#/utils/supervisor-prompt";
import {
  SUPERVISOR_STAGGER_MINUTES,
  SUMMARY_TARGET_KEY,
} from "#/utils/supervisor-sync";
import { cn } from "#/utils/utils";

const STATE_KEYS: Record<RowState, I18nKey> = {
  synced: I18nKey.SUPERVISOR$STATE_SYNCED,
  pending: I18nKey.SUPERVISOR$STATE_PENDING,
  offline: I18nKey.SUPERVISOR$STATE_OFFLINE,
  conflict: I18nKey.SUPERVISOR$STATE_CONFLICT,
  unregistered: I18nKey.SUPERVISOR$STATE_UNREGISTERED,
  error: I18nKey.SUPERVISOR$STATE_ERROR,
};

function minutesOf(time: string): number {
  const [h, m] = time.split(":").map(Number);
  return h * 60 + m;
}

const TEST_ID_ROOT = "supervisor";

// @spec PRJ-207 — Supervisor panel
export function SupervisorPanel() {
  const { t } = useTranslation("openhands");
  const { backends } = useActiveBackendContext();
  const primary = usePrimaryBackend();
  const health = useBackendsHealth(backends);
  const settingsQuery = useSupervisorSettings();
  const saveSettings = useSaveSupervisorSettings();
  const committedRows = useSupervisorRows();
  const sync = useSupervisorSync();
  const projects = useProjects();

  const [local, setLocal] = React.useState<SupervisorSettings>(
    DEFAULT_SUPERVISOR_SETTINGS,
  );
  const [loaded, setLoaded] = React.useState(false);
  const [open, setOpen] = React.useState(false);

  // Loads the persisted settings into the local editable copy exactly once.
  // Gating the interactive form below on `loaded` (see `ready`) avoids a
  // race where a user edit made while this fetch is still in flight would
  // otherwise be silently overwritten once it resolves.
  React.useEffect(() => {
    if (settingsQuery.data && !loaded) {
      setLocal(settingsQuery.data);
      setLoaded(true);
      if (settingsQuery.data.enabled) setOpen(true);
    }
  }, [settingsQuery.data, loaded]);

  const primaryUnreachable = !primary || settingsQuery.isError;
  const ready = loaded || primaryUnreachable;
  const localBackends = backends.filter((b) => b.kind === "local");

  // @spec PRJ-207, PRJ-208 — Sync mutation result (if any) takes priority over
  // the polled row state so a just-run sync reflects immediately.
  const rows = sync.data ?? committedRows;
  const rowFor = (key: string) => rows.find((r) => r.target.key === key);

  // Review fix — no two server rows may share a normalized host; "Add all
  // local servers" only offers backends not already present.
  const missingBackends = localBackends.filter(
    (b) => !local.servers.some((s) => hostsMatch(s.host, b.host)),
  );

  // Review fix — labels must be non-empty, unique, and restricted to
  // `LABEL_PATTERN` (they're interpolated unescaped into prompt prose and
  // ClickUp task titles). Track per-row so the offending input(s) can show
  // an inline error instead of a silently disabled Save button.
  const trimmedLabels = local.servers.map((s) => s.label.trim().toLowerCase());
  const labelCounts = trimmedLabels.reduce<Record<string, number>>(
    (acc, label) => ({ ...acc, [label]: (acc[label] ?? 0) + 1 }),
    {},
  );
  const isLabelInvalid = (index: number) =>
    !LABEL_PATTERN.test(local.servers[index].label) ||
    labelCounts[trimmedLabels[index]] > 1;
  const labelsValid = trimmedLabels.every((_, i) => !isLabelInvalid(i));

  const runTimeValid = TIME_PATTERN.test(local.run_time);
  const summaryTimeValid = TIME_PATTERN.test(local.summary_time);
  const timezoneValid = isValidTimezone(local.timezone);
  const timeoutValid =
    Number.isInteger(local.timeout_seconds) &&
    local.timeout_seconds >= TIMEOUT_MIN_SECONDS &&
    local.timeout_seconds <= TIMEOUT_MAX_SECONDS;
  const listIdValid = LIST_ID_PATTERN.test(local.summary_clickup_list_id);

  // @spec PRJ-207 — Summary-too-early warning uses the largest index among
  // *enabled* servers (not the enabled count): the stagger a server actually
  // runs at is `index * STAGGER` in the full `servers` order regardless of
  // how many earlier servers are disabled (see `buildSupervisorTargets`).
  // The result is wrapped modulo 24h, matching `supervisorCronSchedule`, so
  // a run_time/stagger combination that crosses midnight compares against
  // the wrapped clock time rather than an ever-growing offset.
  const lastEnabledIndex = local.servers.reduce(
    (max, s, i) => (s.enabled ? i : max),
    -1,
  );
  const lastRunMinutes =
    lastEnabledIndex >= 0
      ? (minutesOf(local.run_time) +
          lastEnabledIndex * SUPERVISOR_STAGGER_MINUTES) %
        (24 * 60)
      : minutesOf(local.run_time);
  const tooEarly =
    runTimeValid &&
    summaryTimeValid &&
    minutesOf(local.summary_time) <
      lastRunMinutes + Math.ceil(local.timeout_seconds / 60);

  const canSave =
    !primaryUnreachable &&
    labelsValid &&
    listIdValid &&
    isValidSupervisorSettings(local) &&
    isValidTimezone(local.timezone);

  const updateServer = (index: number, patch: Partial<SupervisorServer>) => {
    setLocal((prev) => ({
      ...prev,
      servers: prev.servers.map((s, i) =>
        i === index ? { ...s, ...patch } : s,
      ),
    }));
  };

  const addAllLocalServers = () => {
    setLocal((prev) => ({
      ...prev,
      servers: [
        ...prev.servers,
        ...localBackends
          .filter((b) => !prev.servers.some((s) => hostsMatch(s.host, b.host)))
          .map((b) => ({
            host: normalizeHost(b.host),
            label: b.name.toLowerCase().replace(/[^a-z0-9-]+/g, "-"),
            enabled: true,
          })),
      ],
    }));
  };

  const save = async () => {
    try {
      await saveSettings.mutateAsync(local);
      sync.mutate();
    } catch {
      displayErrorToast(t(I18nKey.ERROR$GENERIC));
    }
  };

  return (
    <details
      data-testid={`${TEST_ID_ROOT}-panel`}
      open={open}
      onToggle={(e) => setOpen(e.currentTarget.open)}
      className="flex flex-col gap-2 rounded-lg border border-[var(--oh-border)] bg-base-secondary p-4"
    >
      <summary className="cursor-pointer text-sm font-medium text-white">
        {t(I18nKey.SUPERVISOR$TITLE)}
      </summary>
      {!ready ? (
        <LoadingSpinner size="small" className="mt-2" />
      ) : (
        <div className="flex flex-col gap-4 pt-2">
          <p className="text-xs text-[var(--oh-muted)]">
            {t(I18nKey.SUPERVISOR$DESCRIPTION)}
          </p>
          {primaryUnreachable ? (
            <p role="alert" className="text-xs text-red-400">
              {t(I18nKey.PROJECTS$PRIMARY_UNREACHABLE, {
                name: primary?.name ?? "",
              })}
            </p>
          ) : null}
          <SettingsSwitch
            testId={`${TEST_ID_ROOT}-enabled`}
            isToggled={local.enabled}
            isDisabled={primaryUnreachable}
            onToggle={(value) =>
              setLocal((prev) => ({ ...prev, enabled: value }))
            }
          >
            {t(I18nKey.SUPERVISOR$ENABLED)}
          </SettingsSwitch>
          <div className="grid grid-cols-2 gap-4">
            <SettingsInput
              testId={`${TEST_ID_ROOT}-run-time`}
              label={t(I18nKey.SUPERVISOR$RUN_TIME)}
              type="text"
              value={local.run_time}
              isDisabled={primaryUnreachable}
              error={
                !runTimeValid ? t(I18nKey.SUPERVISOR$INVALID_TIME) : undefined
              }
              onChange={(value) =>
                setLocal((prev) => ({ ...prev, run_time: value }))
              }
            />
            <SettingsInput
              testId={`${TEST_ID_ROOT}-summary-time`}
              label={t(I18nKey.SUPERVISOR$SUMMARY_TIME)}
              type="text"
              value={local.summary_time}
              isDisabled={primaryUnreachable}
              error={
                !summaryTimeValid
                  ? t(I18nKey.SUPERVISOR$INVALID_TIME)
                  : tooEarly
                    ? t(I18nKey.SUPERVISOR$SUMMARY_TOO_EARLY)
                    : undefined
              }
              onChange={(value) =>
                setLocal((prev) => ({ ...prev, summary_time: value }))
              }
            />
            <SettingsInput
              testId={`${TEST_ID_ROOT}-timezone`}
              label={t(I18nKey.SUPERVISOR$TIMEZONE)}
              type="text"
              value={local.timezone}
              isDisabled={primaryUnreachable}
              error={
                !timezoneValid
                  ? t(I18nKey.SUPERVISOR$TIMEZONE_INVALID)
                  : undefined
              }
              onChange={(value) =>
                setLocal((prev) => ({ ...prev, timezone: value }))
              }
            />
            <SettingsInput
              testId={`${TEST_ID_ROOT}-timeout`}
              label={t(I18nKey.SUPERVISOR$TIMEOUT)}
              type="number"
              value={String(local.timeout_seconds)}
              isDisabled={primaryUnreachable}
              error={
                !timeoutValid
                  ? t(I18nKey.SUPERVISOR$TIMEOUT_INVALID)
                  : undefined
              }
              onChange={(value) =>
                setLocal((prev) => ({
                  ...prev,
                  timeout_seconds: Number(value) || 0,
                }))
              }
            />
            <SettingsInput
              testId={`${TEST_ID_ROOT}-summary-list`}
              label={t(I18nKey.SUPERVISOR$SUMMARY_LIST)}
              type="text"
              value={local.summary_clickup_list_id}
              isDisabled={primaryUnreachable}
              className="col-span-2"
              error={
                !listIdValid ? t(I18nKey.SUPERVISOR$LIST_ID_INVALID) : undefined
              }
              onChange={(value) =>
                setLocal((prev) => ({
                  ...prev,
                  summary_clickup_list_id: value,
                }))
              }
            />
          </div>

          <ul className="flex flex-col gap-2">
            {local.servers.map((server, i) => {
              const key = normalizeHost(server.host);
              const row = rowFor(key);
              const state = row?.state ?? "pending";
              const backend = localBackends.find((b) =>
                hostsMatch(b.host, server.host),
              );
              const connected = backend
                ? (health[backend.id]?.isConnected ?? null)
                : null;
              const rowTestId = `${TEST_ID_ROOT}-row-${server.label}`;
              const labelInvalid = isLabelInvalid(i);
              const labelErrorId = `${rowTestId}-label-error`;
              return (
                <li
                  key={server.host}
                  data-testid={rowTestId}
                  className="flex flex-wrap items-center gap-2 text-xs"
                >
                  <BackendStatusDot isConnected={connected} />
                  <div className="flex flex-col gap-0.5">
                    <input
                      aria-label={t(I18nKey.SUPERVISOR$LABEL)}
                      aria-invalid={labelInvalid}
                      aria-describedby={labelInvalid ? labelErrorId : undefined}
                      data-testid={`${rowTestId}-label`}
                      value={server.label}
                      disabled={primaryUnreachable}
                      onChange={(e) =>
                        updateServer(i, { label: e.target.value })
                      }
                      className={cn(
                        formControlSettingsFieldClassName,
                        labelInvalid && "border-red-500",
                      )}
                    />
                    {labelInvalid ? (
                      <p
                        id={labelErrorId}
                        role="alert"
                        data-testid={labelErrorId}
                        className="text-xs text-red-400"
                      >
                        {t(I18nKey.SUPERVISOR$LABEL_INVALID)}
                      </p>
                    ) : null}
                  </div>
                  <SettingsSwitch
                    testId={`${rowTestId}-enabled`}
                    isToggled={server.enabled}
                    isDisabled={primaryUnreachable}
                    onToggle={(value) => updateServer(i, { enabled: value })}
                  >
                    {t(I18nKey.SUPERVISOR$ENABLED)}
                  </SettingsSwitch>
                  <span>{t(STATE_KEYS[state])}</span>
                  {row?.error ? (
                    <span className="text-red-400">{row.error}</span>
                  ) : null}
                  <BrandButton
                    type="button"
                    variant="secondary"
                    testId={`${TEST_ID_ROOT}-copy-prompt-${server.label}`}
                    isDisabled={!server.label.trim() || !projects.data}
                    onClick={() => {
                      // @spec PRJ-207 — Copy the prompt from local (unsaved)
                      // panel state so a spike deploy works before the
                      // supervisor is ever enabled/saved, not only once a row
                      // has a desired automation.
                      const prompt = buildServerSupervisorPrompt(
                        server.label,
                        projectsForHost(projects.data ?? [], server.host),
                        local.summary_clickup_list_id,
                      );
                      void navigator.clipboard.writeText(prompt);
                    }}
                  >
                    {t(I18nKey.SUPERVISOR$COPY_PROMPT)}
                  </BrandButton>
                </li>
              );
            })}
            {(() => {
              const summaryRow = rowFor(SUMMARY_TARGET_KEY);
              const summaryState = summaryRow?.state ?? "pending";
              const connected = primary
                ? (health[primary.id]?.isConnected ?? null)
                : null;
              return (
                <li
                  data-testid={`${TEST_ID_ROOT}-row-${SUMMARY_TARGET_KEY}`}
                  className="flex flex-wrap items-center gap-2 text-xs"
                >
                  <BackendStatusDot isConnected={connected} />
                  <span>{t(I18nKey.SUPERVISOR$SUMMARY_ROW)}</span>
                  <span>{t(STATE_KEYS[summaryState])}</span>
                  {summaryRow?.error ? (
                    <span className="text-red-400">{summaryRow.error}</span>
                  ) : null}
                </li>
              );
            })()}
          </ul>

          <BrandButton
            type="button"
            variant="secondary"
            className="w-fit"
            testId={`${TEST_ID_ROOT}-add-servers`}
            isDisabled={primaryUnreachable || missingBackends.length === 0}
            onClick={addAllLocalServers}
          >
            {t(I18nKey.SUPERVISOR$ADD_SERVERS)}
          </BrandButton>

          <div className="flex justify-end gap-2">
            <BrandButton
              type="button"
              variant="secondary"
              testId={`${TEST_ID_ROOT}-sync-now`}
              isDisabled={primaryUnreachable || sync.isPending}
              onClick={() => sync.mutate()}
            >
              {t(I18nKey.SUPERVISOR$SYNC_NOW)}
            </BrandButton>
            <BrandButton
              type="button"
              variant="primary"
              testId={`${TEST_ID_ROOT}-save`}
              isDisabled={!canSave}
              onClick={save}
            >
              {t(I18nKey.SUPERVISOR$SAVE)}
            </BrandButton>
          </div>
        </div>
      )}
    </details>
  );
}
