import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SearchNavigationBar } from "./SearchNavigationBar";

const bar = {
  count: 20, current: 4, scanning: false, paused: false, busy: false, waiting: false,
  onPrevious: () => undefined, onNext: () => undefined, onBackToResults: () => undefined,
};

describe("ER-0228 search navigation bar", () => {
  it("distinguishes a paused scan from a running one and stays hidden while the panel is open", () => {
    const paused = renderToStaticMarkup(createElement(SearchNavigationBar, { ...bar, paused: true, current: 19 }));
    expect(paused).toContain("搜索已暂停");
    expect(paused).not.toContain("仍在搜索");
    const waiting = renderToStaticMarkup(createElement(SearchNavigationBar, {
      ...bar, scanning: true, waiting: true, current: 19,
    }));
    expect(waiting).toContain("20/20");
    expect(waiting).toContain("仍在搜索");
    expect(renderToStaticMarkup(createElement(SearchNavigationBar, { ...bar, hidden: true }))).toBe("");
  });
});
