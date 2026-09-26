import { beforeEach, describe, it, expect } from "vitest";
import {
  __resetActiveStoreForTests,
  getRegisteredBackends,
  markPrimaryBackend,
  selectPrimaryBackend,
  setRegisteredBackends,
} from "#/api/backend-registry/active-store";
import { readStoredBackends } from "#/api/backend-registry/storage";
import type { Backend } from "#/api/backend-registry/types";

const a: Backend = {
  id: "a",
  name: "pc",
  host: "http://pc:8000",
  apiKey: "k",
  kind: "local",
};
const b: Backend = {
  id: "b",
  name: "vps",
  host: "http://vps:8000",
  apiKey: "k",
  kind: "local",
};

// @spec PRJ-002 — Primary backend selection
describe("primary backend", () => {
  beforeEach(() => {
    window.localStorage.clear();
    __resetActiveStoreForTests();
  });

  it("falls back to the first local backend when none is marked", () => {
    expect(selectPrimaryBackend([a, b])).toBe(a);
  });

  it("marks exactly one backend primary and persists it", () => {
    setRegisteredBackends([{ ...a, isPrimary: true }, b]);
    markPrimaryBackend("b");
    expect(
      getRegisteredBackends()
        .filter((x) => x.isPrimary)
        .map((x) => x.id),
    ).toEqual(["b"]);
    expect(readStoredBackends().find((x) => x.id === "b")?.isPrimary).toBe(
      true,
    );
  });
});
