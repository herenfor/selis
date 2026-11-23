import { createElement } from "react";
import { describe, expect, it, vi } from "vitest";
import type { Book } from "../core/types";
import type { ReaderQuerySnapshot, ReaderSearchQuery, SearchPreview, SearchResult } from "../core/search";
import type { ResourceServer } from "../render/resources";
import type { CompiledTextProjection } from "../render/textProjection/compile";
import { createReactDomHarness } from "../test/reactDomHarness";
import { useReaderSearchView, useReaderSearchState, useReaderSearchRefs,
  useReaderSearchSession, useReaderSearchQuery, useReaderSearchPanel } from "./useReaderSearch";

import { SearchResultWindowList } from "./SearchPanel";

const ports = vi.hoisted(() => ({ create: vi.fn() }));
vi.mock("../render/textProjection/displaySearch", () => ({ createTextSearchSession: ports.create }));

const rows: SearchPreview[] = Array.from({ length: 300 }, (_, index) => ({
  spineIndex: 1, chapterPath: "c.xhtml", chapterTitle: "Chapter",
  snippet: `Alice ${index}`, snippetMatchRanges: [{ start: 0, end: 5 }], matchType: "phrase",
}));
const resolved: SearchResult = {
  ...rows[0], originalRange: { start: 20, end: 25 }, textOffset: 20, textSnippet: "Alice", matchedText: "Alice",
};

function fakeQuery(onUpdate?: (snapshot: ReaderQuerySnapshot) => void) {
  let snapshot: ReaderQuerySnapshot = { status: "scanning", completed: 0, total: 3, count: 0 };
  const query: ReaderSearchQuery = {
    snapshot: () => ({ ...snapshot }),
    finished: Promise.resolve(snapshot),
    // Only rows the scan has already published are visible to the panel.
    window: vi.fn(async (offset: number, limit: number) =>
      rows.slice(offset, Math.min(offset + limit, snapshot.count))),
    resolve: vi.fn(async () => resolved),
    pause: vi.fn(() => { snapshot = { ...snapshot, status: "paused" }; }),
    resume: vi.fn(async () => snapshot),
    cancel: vi.fn(),
  };
  return {
    query,
    publish: (next: ReaderQuerySnapshot, notify = true) => {
      snapshot = next;
      if (notify) onUpdate?.(next);
    },
  };
}

function setup(renderWindow = false) {
  const dom = createReactDomHarness();
  vi.useFakeTimers();
  const queries: Array<ReturnType<typeof fakeQuery> & { text: string; options: { onUpdate?(s: ReaderQuerySnapshot): void } }> = [];
  const sessions: Array<{ startQuery: ReturnType<typeof vi.fn>; dispose: ReturnType<typeof vi.fn> }> = [];
  ports.create.mockReset().mockImplementation(() => {
    const session = {
      startQuery: vi.fn((text: string, options: { onUpdate?(s: ReaderQuerySnapshot): void }) => {
        const entry = { ...fakeQuery(options.onUpdate), text, options };
        queries.push(entry);
        return entry.query;
      }),
      dispose: vi.fn(),
    };
    sessions.push(session);
    return session;
  });
  let context = {
    view: "reader" as "reader" | "shelf",
    book: { fixedLayout: false, spine: [{ linear: true }, { linear: false }, { linear: true }] } as Book,
    server: {} as ResourceServer, compiledTextProjection: null as CompiledTextProjection | null,
  };
  function useHost() {
    const searchView = useReaderSearchView();
    const state = useReaderSearchState();
    const refs = useReaderSearchRefs();
    const options = { ...context, ...searchView, ...state, ...refs };
    useReaderSearchSession(options);
    useReaderSearchQuery(options);
    const panel = useReaderSearchPanel({ ...state, ...refs, setSearchView: searchView.setSearchView });
    return { ...searchView, ...state, ...refs, ...panel };
  }
  let api!: ReturnType<typeof useHost>;
  function Host() {
    api = useHost();
    if (!renderWindow) return createElement("div", {}, api.searchStatus);
    return createElement(SearchResultWindowList, {
      virtual: { count: api.searchCount, rowAt: api.searchPanelRowAt, onRange: api.ensureSearchRows },
      onSelect: () => undefined,
    });
  }
  return { dom, queries, sessions, current: () => api,
    render: () => dom.render(createElement(Host)),
    change: async (next: Partial<typeof context>) => { context = { ...context, ...next }; await dom.render(createElement(Host)); },
    advance: (ms: number) => dom.run(async () => { await vi.advanceTimersByTimeAsync(ms); }),
    dispose: async () => { await dom.dispose(); vi.useRealTimers(); },
  };
}

describe("current-book search: streaming query and retained results", () => {
  it("starts one query after the debounce and loads snippet windows on demand", async () => {
    const t = setup();
    try {
      await t.render();
      await t.dom.run(() => t.current().setSearchQuery(" Alice "));
      await t.advance(179);
      expect(t.sessions[0].startQuery).not.toHaveBeenCalled();
      await t.advance(1);
      expect(t.sessions[0].startQuery.mock.calls[0][0]).toBe("Alice");
      expect(t.current().searchStatus).toBe("searching");
      await t.dom.run(() => t.queries[0].publish({ status: "scanning", completed: 1, total: 3, count: 100 }));
      await t.dom.run(async () => { await t.queries[0].query.window(0, 128); });
      await t.dom.run(() => t.current().ensureSearchRows(0, 40));
      expect(t.queries[0].query.window).toHaveBeenCalledTimes(2);
      // A second range inside the loaded window must not re-fetch.
      await t.dom.run(() => t.current().ensureSearchRows(4, 20));
      expect(t.current().searchPanelRowAt(4)?.snippet).toBe("Alice 4");
    } finally { await t.dispose(); }
  });

  it("keeps the same query and published rows when the panel closes and reopens", async () => {
    const t = setup();
    try {
      await t.render();
      await t.dom.run(() => t.current().setSearchQuery("Alice"));
      await t.advance(180);
      await t.dom.run(() => t.queries[0].publish({ status: "scanning", completed: 1, total: 3, count: 300 }));
      await t.dom.run(() => t.current().ensureSearchRows(0, 20));
      expect(t.current().searchCount).toBe(300);
      await t.render();
      await t.advance(400);
      expect(t.sessions[0].startQuery).toHaveBeenCalledTimes(1);
      expect(t.current().searchCount).toBe(300);
      expect(t.current().searchPanelRowAt(2)?.snippet).toBe("Alice 2");
    } finally { await t.dispose(); }
  });

  it("cancels the previous handle immediately when the text changes", async () => {
    const t = setup();
    try {
      await t.render();
      await t.dom.run(() => t.current().setSearchQuery("Alice"));
      await t.advance(180);
      const first = t.queries[0].query;
      await t.dom.run(() => t.current().setSearchQuery("Rabbit"));
      expect(first.cancel).toHaveBeenCalledTimes(1);
      await t.advance(180);
      expect(t.sessions[0].startQuery.mock.calls[1][0]).toBe("Rabbit");
    } finally { await t.dispose(); }
  });

  it("pauses instead of discarding, resumes, and resolves the clicked row", async () => {
    const t = setup();
    try {
      await t.render();
      await t.dom.run(() => t.current().setSearchQuery("Alice"));
      await t.advance(180);
      await t.dom.run(() => t.queries[0].options.onUpdate?.({ status: "scanning", completed: 2, total: 3, count: 7 }));
      await t.dom.run(() => t.current().handleSearchCancel());
      expect(t.queries[0].query.pause).toHaveBeenCalledTimes(1);
      expect(t.current().searchCount).toBe(7);
      await t.dom.run(() => t.current().handleSearchResume());
      expect(t.queries[0].query.resume).toHaveBeenCalledTimes(1);
      let result: SearchResult | undefined;
      await t.dom.run(async () => { result = await t.current().resolveSearchIndex(3); });
      expect(result).toEqual(resolved);
      expect(t.queries[0].query.resolve).toHaveBeenCalledWith(3);
    } finally { await t.dispose(); }
  });
});

describe("ER-0228 review fixes", () => {
  it("refills a window that was fetched before the scan published more rows", async () => {
    const t = setup();
    try {
      await t.render();
      await t.dom.run(() => t.current().setSearchQuery("Alice"));
      await t.advance(180);
      // First chapter publishes one row; the window is fetched with that count.
      await t.dom.run(() => t.queries[0].publish({ status: "scanning", completed: 1, total: 3, count: 1 }));
      await t.dom.run(() => t.current().ensureSearchRows(0, 20));
      expect(t.current().searchPanelRowAt(0)?.snippet).toBe("Alice 0");
      expect(t.current().searchPanelRowAt(13)).toBeUndefined();
      // The count grows; the same window must be fetched again instead of skipped.
      await t.dom.run(() => t.queries[0].publish({ status: "scanning", completed: 2, total: 3, count: 20 }));
      await t.dom.run(() => t.current().ensureSearchRows(0, 20));
      expect(t.queries[0].query.window).toHaveBeenCalledTimes(2);
      expect(t.current().searchPanelRowAt(13)?.snippet).toBe("Alice 13");
    } finally { await t.dispose(); }
  });

  it("fills a stationary viewport when the final count arrives during its first read", async () => {
    const t = setup(true);
    try {
      await t.render();
      await t.dom.run(() => t.current().setSearchQuery("Alice"));
      await t.advance(180);
      const { query, publish } = t.queries[0];
      let finishFirst!: (value: SearchPreview[]) => void;
      vi.mocked(query.window).mockImplementationOnce(() => new Promise((resolve) => { finishFirst = resolve; }));
      await t.dom.run(() => publish({ status: "scanning", completed: 1, total: 3, count: 1 }));
      await t.dom.run(() => publish({ status: "complete", completed: 3, total: 3, count: 20 }));
      expect(query.window).toHaveBeenCalledTimes(1);
      await t.dom.run(() => finishFirst(rows.slice(0, 1)));
      expect(query.window).toHaveBeenNthCalledWith(2, 1, 19);
      expect(t.dom.container.querySelectorAll("button")[4]?.textContent).toContain("Alice 4");
      expect(t.current().searchPanelRowAt(19)?.snippet).toBe("Alice 19");
    } finally { await t.dispose(); }
  });

  it("drops the previous result position when the keywords change", async () => {
    const t = setup();
    try {
      await t.render();
      await t.dom.run(() => t.current().setSearchQuery("Alice"));
      await t.advance(180);
      await t.dom.run(() => t.current().setSearchCurrentIndex(15));
      expect(t.current().searchCurrentIndex).toBe(15);
      await t.dom.run(() => t.current().setSearchQuery("Rabbit"));
      await t.advance(180);
      expect(t.current().searchCurrentIndex).toBeNull();
    } finally { await t.dispose(); }
  });
});
