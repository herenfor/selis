import { describe, expect, it, vi } from "vitest";
import { readBookContentDefaults, writeBookContentDefaults } from "./bookContentPreferences";

const KEY = "epub-reader:book-content-permissions";

function storage(initial?: string) {
  const values = new Map<string, string>();
  if (initial !== undefined) values.set(KEY, initial);
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
  });
  return values;
}

describe("book content permission memory", () => {
  it("defaults to off when nothing was remembered", () => {
    storage();
    expect(readBookContentDefaults()).toEqual({ networkEnabled: false, javascriptEnabled: false });
  });

  it("round-trips the last choice", () => {
    storage();
    writeBookContentDefaults({ networkEnabled: true, javascriptEnabled: true });
    expect(readBookContentDefaults()).toEqual({ networkEnabled: true, javascriptEnabled: true });
    writeBookContentDefaults({ networkEnabled: true, javascriptEnabled: false });
    expect(readBookContentDefaults()).toEqual({ networkEnabled: true, javascriptEnabled: false });
  });

  it("falls back to off for malformed or non-boolean storage", () => {
    storage("{not json");
    expect(readBookContentDefaults()).toEqual({ networkEnabled: false, javascriptEnabled: false });
    storage(JSON.stringify({ networkEnabled: "yes", javascriptEnabled: 1 }));
    expect(readBookContentDefaults()).toEqual({ networkEnabled: false, javascriptEnabled: false });
  });
});
