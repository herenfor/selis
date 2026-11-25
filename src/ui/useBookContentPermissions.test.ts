import { createElement } from "react";
import { describe, expect, it, vi } from "vitest";
import type { Book } from "../core/types";
import { createReactDomHarness } from "../test/reactDomHarness";
import { useBookContentPermissions, type BookContentPermissionControls } from "./useBookContentPermissions";

const KEY = "epub-reader:book-content-permissions";

function book(): Book {
  return {
    version: 3,
    opfPath: "OEBPS/content.opf",
    metadata: { title: "test", identifier: "test", language: "zh" },
    manifest: new Map([["c1", { id: "c1", href: "c1.xhtml", mediaType: "application/xhtml+xml", properties: [] }]]),
    spine: [{ idref: "c1", linear: true }],
    guide: [],
    toc: [],
    resources: new Map(),
    fixedLayout: false,
    issues: [],
    drmProtected: false,
  };
}

function Host(props: { book: Book; api: { current: BookContentPermissionControls | null } }) {
  const controls = useBookContentPermissions(props.book, 0, "windows");
  props.api.current = controls;
  return createElement("div");
}

function setup(initial?: string) {
  const values = new Map<string, string>();
  if (initial !== undefined) values.set(KEY, initial);
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
  });
  const dom = createReactDomHarness();
  const api: { current: BookContentPermissionControls | null } = { current: null };
  return { dom, values, api, current: () => api.current! };
}

describe("useBookContentPermissions", () => {
  it("remembers an enabled switch for the next book", async () => {
    const t = setup();
    try {
      await t.dom.render(createElement(Host, { book: book(), api: t.api }));
      expect(t.current().networkEnabled).toBe(false);
      expect(t.current().javascriptEnabled).toBe(false);

      await t.dom.run(() => t.current().setNetworkEnabled(true));
      expect(t.current().networkEnabled).toBe(true);
      expect(t.current().renderPermissions?.networkEnabled).toBe(true);
      expect(JSON.parse(t.values.get(KEY)!)).toEqual({ networkEnabled: true, javascriptEnabled: false });

      // A different book starts from the remembered choice instead of resetting to off.
      await t.dom.render(createElement(Host, { book: book(), api: t.api }));
      expect(t.current().networkEnabled).toBe(true);
      expect(t.current().javascriptEnabled).toBe(false);

      await t.dom.run(() => t.current().setJavascriptEnabled(true));
      expect(t.current().javascriptEnabled).toBe(true);
      expect(JSON.parse(t.values.get(KEY)!)).toEqual({ networkEnabled: true, javascriptEnabled: true });
    } finally {
      await t.dom.dispose();
    }
  });

  it("remembers turning a switch back off", async () => {
    const t = setup(JSON.stringify({ networkEnabled: true, javascriptEnabled: true }));
    try {
      await t.dom.render(createElement(Host, { book: book(), api: t.api }));
      expect(t.current().networkEnabled).toBe(true);
      expect(t.current().javascriptEnabled).toBe(true);

      await t.dom.run(() => t.current().setNetworkEnabled(false));
      expect(t.current().networkEnabled).toBe(false);
      expect(JSON.parse(t.values.get(KEY)!)).toEqual({ networkEnabled: false, javascriptEnabled: true });
    } finally {
      await t.dom.dispose();
    }
  });
});
