// @spec PRJ-003, PRJ-209 — Generic tracker link (provider + ref) so Projects
// and the supervisor never hard-code a single provider. Provider-specific
// knowledge (display name, URL parsing, ref shape, MCP name, prompt
// fragments) lives in src/utils/trackers.ts; add a provider by adding one
// union member here and one entry there — no other file needs to change.
export type TrackerProviderId = "clickup";

export interface TrackerLink {
  provider: TrackerProviderId;
  ref: string;
  url?: string;
}
