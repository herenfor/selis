import { createElement, useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { createReactDomHarness } from "../test/reactDomHarness";
import { useReaderSearchController, type ReaderSearchControllerOptions } from "./useReaderSearchController";

const result = { spineIndex: 1 } as never;

function setup(outcomes: Array<"committed" | "pending" | "failed">) {
  const dom = createReactDomHarness();
  const settleRef: { current: ((requestId: number, located: boolean) => void) | null } = { current: null };
  const openResults = vi.fn();
  let state = { current: null as number | null, requests: 0 };
  let api!: ReturnType<typeof useReaderSearchController>;
  const base: Omit<ReaderSearchControllerOptions, "setSearchCurrentIndex" | "searchCurrentIndex"> = {
    searchQuery: "Alice", setSearchQuery: () => undefined,
    searchView: "display", searchOriginsAvailable: false, handleSearchViewChange: () => undefined,
    searchStatus: "complete", searchCount: 20,
    searchProgress: { processed: 3, total: 3 },
    searchNavigationBusy: false,
    searchPanelRowAt: () => undefined, ensureSearchRows: () => undefined,
    resolveSearchIndex: async () => result,
    handleSearchCancel: () => undefined, handleSearchResume: () => undefined,
    searchScrollTopRef: { current: 0 },
    onNavigate: () => {
      const status = outcomes[state.requests++] ?? "failed";
      return status === "failed" ? { status } : { status, requestId: state.requests };
    },
    openResults,
    showNotice: () => undefined,
    settleRef,
  };
  function Host() {
    const [, force] = useState(0);
    api = useReaderSearchController({
      ...base,
      searchCurrentIndex: state.current,
      setSearchCurrentIndex: (index) => { state.current = index; force((tick) => tick + 1); },
    });
    return createElement("div", {}, String(state.current));
  }
  return {
    dom, settleRef, openResults,
    current: () => api,
    currentIndex: () => state.current,
    render: () => dom.render(createElement(Host)),
    dispose: async () => { await dom.dispose(); },
  };
}

describe("ER-0228 result navigation commit timing", () => {
  it("commits only what the reader confirmed, and waits for cross-chapter settle", async () => {
    const t = setup(["committed", "pending", "failed"]);
    try {
      await t.render();
      await t.dom.run(async () => { await t.current().barProps.onNext(); });
      expect(t.currentIndex()).toBe(0);
      // Cross-chapter: nothing commits until the precise target settles.
      await t.dom.run(async () => { await t.current().barProps.onNext(); });
      expect(t.currentIndex()).toBe(0);
      t.settleRef.current?.(2, true);
      expect(t.currentIndex()).toBe(1);
      // Failed navigation keeps the previous position.
      await t.dom.run(async () => { await t.current().barProps.onNext(); });
      expect(t.currentIndex()).toBe(1);
    } finally { await t.dispose(); }
  });
});
