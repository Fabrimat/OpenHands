import { describe, it, expect } from "vitest";
import {
  isSafeRef,
  isTrackerProviderId,
  isValidTrackerLink,
  TRACKER_PROVIDERS,
} from "#/utils/trackers";

// @spec PRJ-003 — Provider registry: adding a provider means adding one entry
// here plus its union member; these guards are what everything else (the
// project form, the supervisor panel, the persisted-data validators) relies
// on to stay correct without knowing about any specific provider.
describe("isTrackerProviderId", () => {
  it.each([
    ["clickup", true],
    ["github", false],
    ["", false],
    [42, false],
  ])("%s -> %s", (v, want) => {
    expect(isTrackerProviderId(v)).toBe(want);
  });
});

describe("TRACKER_PROVIDERS.clickup", () => {
  const clickup = TRACKER_PROVIDERS.clickup;

  it.each([
    ["ABC123", true],
    ["", false],
    ["abc-123", false],
    ["abc 123", false],
  ])("isValidRef(%s) -> %s", (ref, want) => {
    expect(clickup.isValidRef(ref)).toBe(want);
  });

  it("derives the ref from the last URL path segment", () => {
    expect(
      clickup.refFromUrl("https://app.clickup.com/12345678/v/li/900123"),
    ).toBe("900123");
  });

  it("returns null when no ref can be derived", () => {
    expect(clickup.refFromUrl("https://app.clickup.com/")).toBeNull();
    expect(clickup.refFromUrl("https://app.clickup.com/not valid")).toBeNull();
  });

  // @spec PRJ-209 — Read and write must reuse the exact same titles/tag so
  // they can't desync (see buildSummaryPrompt).
  it("summaryReadFragment names the same task titles and tag statusFragment writes", () => {
    const written = clickup.statusFragment("vps1").join("\n");
    const read = clickup.summaryReadFragment();
    expect(written).toContain('"📊 Stato progetto"');
    expect(read).toContain('"📊 Stato progetto"');
    expect(written).toContain("supervisor-suggestion");
    expect(read).toContain("supervisor-suggestion");
  });
});

// @spec PRJ-209 — Provider-independent ref safety net, regardless of any
// given provider's own (possibly lax) `isValidRef`.
describe("isSafeRef", () => {
  it.each([
    ["alphanumeric", "ABC123", true],
    ["whitespace", "a b", false],
    ["double quote", 'a"b', false],
    ["single quote", "a'b", false],
    ["backtick", "a`b", false],
    ["control character", "a\nb", false],
    ["empty", "", false],
    ["at the length limit (128)", "a".repeat(128), true],
    ["over the length limit (129)", "a".repeat(129), false],
  ])("%s", (_name, ref, want) => {
    expect(isSafeRef(ref)).toBe(want);
  });
});

describe("isValidTrackerLink", () => {
  it("accepts a valid clickup link, with or without a url", () => {
    expect(isValidTrackerLink({ provider: "clickup", ref: "ABC123" })).toBe(
      true,
    );
    expect(
      isValidTrackerLink({
        provider: "clickup",
        ref: "ABC123",
        url: "https://x",
      }),
    ).toBe(true);
  });

  it.each([
    ["unknown provider", { provider: "bogus", ref: "ABC123" }],
    ["invalid ref shape", { provider: "clickup", ref: "abc-123" }],
    [
      "a non-http(s) url",
      { provider: "clickup", ref: "ABC123", url: "javascript:alert(1)" },
    ],
    ["non-object", "not an object"],
    ["null", null],
  ])("rejects %s", (_name, v) => {
    expect(isValidTrackerLink(v)).toBe(false);
  });
});
