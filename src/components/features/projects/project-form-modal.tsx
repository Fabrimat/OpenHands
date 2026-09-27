import React from "react";
import { useTranslation } from "react-i18next";
import { v4 as uuidv4 } from "uuid";
import { I18nKey } from "#/i18n/declaration";
import { useActiveBackendContext } from "#/contexts/active-backend-context";
import { FolderBrowserModal } from "#/components/features/home/workspace-dropdown/folder-browser-modal";
import { ModalBackdrop } from "#/components/shared/modals/modal-backdrop";
import {
  MODAL_MAX_WIDTH_VIEWPORT,
  modalWidthClassName,
} from "#/components/shared/modals/modal-body";
import { ModalCloseButton } from "#/components/shared/modals/modal-close-button";
import { BrandButton } from "#/components/features/settings/brand-button";
import { SettingsInput } from "#/components/features/settings/settings-input";
import { isLoopbackUrl } from "#/api/backend-registry/storage";
import { useDebounce } from "#/hooks/use-debounce";
import { useProjectGitInfo } from "#/hooks/query/use-project-data";
import { usePrimaryBackend } from "#/hooks/query/use-projects";
import {
  formControlMultilineFieldClassName,
  formControlSettingsFieldClassName,
} from "#/utils/form-control-classes";
import { modalTitleLgClassName } from "#/utils/modal-classes";
import { cn } from "#/utils/utils";
import type { Project, ProjectLocation } from "#/types/project";
import type { TrackerLink, TrackerProviderId } from "#/types/tracker";
import { TRACKER_PROVIDERS } from "#/utils/trackers";
import { isHttpUrl } from "#/utils/url";
import {
  normalizeHost,
  normalizeRepoUrl,
  hostsMatch,
  resolveLocationBackend,
} from "#/utils/project-matching";

interface ProjectFormModalProps {
  initial?: Project;
  onClose: () => void;
  onSubmit: (project: Project) => void;
}

// @spec PRJ-003 — Project CRUD
export function ProjectFormModal({
  initial,
  onClose,
  onSubmit,
}: ProjectFormModalProps) {
  const { t } = useTranslation("openhands");
  const { backends, active } = useActiveBackendContext();
  const locals = backends.filter((b) => b.kind === "local");
  const primary = usePrimaryBackend();
  // The active backend can be a Cloud backend, but locations only ever
  // point at local servers (the select below only lists locals) — fall back
  // to the primary local backend, then the first registered local, so a new
  // location always defaults to a host that's actually selectable.
  // Prefer a non-loopback local backend as the default location host: a
  // saved `localhost` location only ever resolves on the machine that
  // created it (see "Location hosts and the primary backend" in
  // specs/projects.md). Order: active-if-local-non-loopback →
  // primary-if-non-loopback → first non-loopback local → previous fallback
  // (may still be loopback, e.g. no other local backend is registered).
  const previousFallback =
    active.backend.kind === "local" ? active.backend : (primary ?? locals[0]);
  const activeNonLoopback =
    active.backend.kind === "local" && !isLoopbackUrl(active.backend.host)
      ? active.backend
      : null;
  const primaryNonLoopback =
    primary && !isLoopbackUrl(primary.host) ? primary : null;
  const firstNonLoopbackLocal = locals.find((b) => !isLoopbackUrl(b.host));
  const defaultLocalBackend =
    activeNonLoopback ??
    primaryNonLoopback ??
    firstNonLoopbackLocal ??
    previousFallback;
  const defaultLocalHost = normalizeHost(defaultLocalBackend?.host ?? "");
  const [name, setName] = React.useState(initial?.name ?? "");
  const [repoUrl, setRepoUrl] = React.useState(initial?.repo_url ?? "");
  const [trackerProvider, setTrackerProvider] = React.useState<
    TrackerProviderId | ""
  >(initial?.tracker?.provider ?? "");
  const [trackerUrl, setTrackerUrl] = React.useState(
    initial?.tracker?.url ?? "",
  );
  const [notes, setNotes] = React.useState(initial?.notes ?? "");
  const [locations, setLocations] = React.useState<ProjectLocation[]>(
    initial?.locations ?? [{ host: defaultLocalHost, path: "" }],
  );
  const [browsingIndex, setBrowsingIndex] = React.useState<number | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  const updateLocation = (i: number, patch: Partial<ProjectLocation>) =>
    setLocations((prev) =>
      prev.map((l, j) => (j === i ? { ...l, ...patch } : l)),
    );

  // @spec PRJ-004 — Repo auto-detect from the first location with a path.
  // The path is debounced so the probe doesn't re-fire on every keystroke.
  const firstResolved = locations.find((l) => l.path.trim());
  const debouncedPath = useDebounce(firstResolved?.path.trim() ?? "", 500);
  const firstBackend = firstResolved
    ? resolveLocationBackend(firstResolved, backends)
    : null;
  const gitInfo = useProjectGitInfo(
    firstResolved
      ? { host: firstResolved.host, path: debouncedPath }
      : { host: "", path: "" },
    debouncedPath ? firstBackend : null,
  );
  React.useEffect(() => {
    if (!repoUrl && gitInfo.data?.remoteUrl) {
      setRepoUrl(normalizeRepoUrl(gitInfo.data.remoteUrl));
    }
  }, [gitInfo.data?.remoteUrl]);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const cleaned = locations
      .map((l) => ({ host: normalizeHost(l.host), path: l.path.trim() }))
      .filter((l) => l.path);
    if (!name.trim() || !repoUrl.trim() || cleaned.length === 0) {
      setError(t(I18nKey.PROJECTS$REQUIRED));
      return;
    }
    // Minor — Tracker URL: only accept http:/https: links, and only if the
    // provider can derive a valid ref from it.
    let tracker: TrackerLink | undefined;
    if (trackerProvider) {
      const url = trackerUrl.trim();
      const ref = url
        ? TRACKER_PROVIDERS[trackerProvider].refFromUrl(url)
        : null;
      if (!url || !isHttpUrl(url) || !ref) {
        setError(t(I18nKey.PROJECTS$TRACKER_URL_INVALID));
        return;
      }
      tracker = { provider: trackerProvider, ref, url };
    }
    onSubmit({
      id: initial?.id ?? uuidv4(),
      name: name.trim(),
      repo_url: normalizeRepoUrl(repoUrl),
      locations: cleaned,
      ...(tracker ? { tracker } : {}),
      ...(notes.trim() ? { notes: notes.trim() } : {}),
    });
  };

  const testIdRoot = "project-form";

  return (
    <ModalBackdrop
      onClose={onClose}
      closeOnEscape={false}
      aria-label={t(initial ? I18nKey.PROJECTS$EDIT : I18nKey.PROJECTS$NEW)}
    >
      <div
        data-testid={`${testIdRoot}-modal`}
        className={cn(
          "relative bg-base-secondary p-6 rounded-xl flex flex-col gap-4 border border-[var(--oh-border)]",
          modalWidthClassName("md"),
          MODAL_MAX_WIDTH_VIEWPORT,
        )}
      >
        <ModalCloseButton onClose={onClose} testId={`${testIdRoot}-close`} />
        <h2 className={`pr-6 ${modalTitleLgClassName}`}>
          {t(initial ? I18nKey.PROJECTS$EDIT : I18nKey.PROJECTS$NEW)}
        </h2>
        <form
          onSubmit={submit}
          data-testid={testIdRoot}
          className="flex flex-col gap-4"
        >
          <SettingsInput
            testId={`${testIdRoot}-name`}
            label={t(I18nKey.PROJECTS$NAME)}
            type="text"
            value={name}
            onChange={setName}
            className="w-full"
            showRequiredTag
          />
          <SettingsInput
            testId={`${testIdRoot}-repo`}
            label={t(I18nKey.PROJECTS$REPO_URL)}
            type="text"
            value={repoUrl}
            onChange={setRepoUrl}
            className="w-full"
            showRequiredTag
          />
          <fieldset className="flex flex-col gap-2">
            <legend className="text-sm mb-1">
              {t(I18nKey.PROJECTS$LOCATIONS)}
            </legend>
            {locations.map((loc, i) => {
              const isActiveServer =
                active.backend.kind === "local" &&
                hostsMatch(loc.host, active.backend.host);
              return (
                <div key={i} className="flex flex-col gap-1">
                  <div className="flex items-center gap-2">
                    <select
                      aria-label={t(I18nKey.PROJECTS$SERVER)}
                      data-testid={`${testIdRoot}-server-${i}`}
                      value={loc.host}
                      onChange={(e) =>
                        updateLocation(i, { host: e.target.value })
                      }
                      className={formControlSettingsFieldClassName}
                    >
                      {locals.map((b) => (
                        <option key={b.id} value={normalizeHost(b.host)}>
                          {b.name}
                        </option>
                      ))}
                    </select>
                    <input
                      aria-label={t(I18nKey.PROJECTS$PATH)}
                      data-testid={`${testIdRoot}-path-${i}`}
                      value={loc.path}
                      onChange={(e) =>
                        updateLocation(i, { path: e.target.value })
                      }
                      className={formControlSettingsFieldClassName}
                    />
                    {isActiveServer ? (
                      <BrandButton
                        type="button"
                        variant="secondary"
                        onClick={() => setBrowsingIndex(i)}
                        testId={`${testIdRoot}-browse-${i}`}
                      >
                        {t(I18nKey.PROJECTS$BROWSE)}
                      </BrandButton>
                    ) : null}
                  </div>
                  {/* Loopback hosts don't resolve from other browsers/tailnet peers */}
                  {isLoopbackUrl(loc.host) ? (
                    <p
                      data-testid={`${testIdRoot}-loopback-warning-${i}`}
                      className="text-xs text-amber-300"
                    >
                      {t(I18nKey.PROJECTS$LOOPBACK_HOST_WARNING)}
                    </p>
                  ) : null}
                </div>
              );
            })}
            <BrandButton
              type="button"
              variant="secondary"
              className="w-fit"
              onClick={() =>
                setLocations((prev) => [
                  ...prev,
                  { host: defaultLocalHost, path: "" },
                ])
              }
              testId={`${testIdRoot}-add-location`}
            >
              {t(I18nKey.PROJECTS$ADD_LOCATION)}
            </BrandButton>
          </fieldset>
          <label className="flex flex-col gap-2.5 w-full min-w-0">
            <span className="text-sm">{t(I18nKey.PROJECTS$TRACKER)}</span>
            <select
              aria-label={t(I18nKey.PROJECTS$TRACKER)}
              data-testid={`${testIdRoot}-tracker`}
              value={trackerProvider}
              onChange={(e) =>
                setTrackerProvider(e.target.value as TrackerProviderId | "")
              }
              className={formControlSettingsFieldClassName}
            >
              <option value="">{t(I18nKey.PROJECTS$TRACKER_NONE)}</option>
              {Object.entries(TRACKER_PROVIDERS).map(([id, provider]) => (
                <option key={id} value={id}>
                  {provider.displayName}
                </option>
              ))}
            </select>
          </label>
          {trackerProvider ? (
            <SettingsInput
              testId={`${testIdRoot}-tracker-url`}
              label={t(I18nKey.PROJECTS$TRACKER_URL)}
              type="text"
              value={trackerUrl}
              onChange={setTrackerUrl}
              className="w-full"
            />
          ) : null}
          <label className="flex flex-col gap-2.5 w-full min-w-0">
            <span className="text-sm">{t(I18nKey.PROJECTS$NOTES)}</span>
            <textarea
              data-testid={`${testIdRoot}-notes`}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
              className={formControlMultilineFieldClassName}
            />
          </label>
          {error ? (
            <p role="alert" className="text-xs text-red-400">
              {error}
            </p>
          ) : null}
          <div className="flex justify-end gap-2 mt-2 w-full">
            <BrandButton
              type="button"
              variant="secondary"
              onClick={onClose}
              testId={`${testIdRoot}-cancel`}
            >
              {t(I18nKey.PROJECTS$CANCEL)}
            </BrandButton>
            <BrandButton
              type="submit"
              variant="primary"
              testId={`${testIdRoot}-submit`}
            >
              {t(I18nKey.PROJECTS$SAVE)}
            </BrandButton>
          </div>
        </form>
      </div>
      <FolderBrowserModal
        isOpen={browsingIndex !== null}
        onClose={() => setBrowsingIndex(null)}
        onAdd={(items) => {
          if (browsingIndex !== null && items[0]) {
            updateLocation(browsingIndex, { path: items[0].path });
          }
          setBrowsingIndex(null);
        }}
      />
    </ModalBackdrop>
  );
}
