import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createReactDomHarness } from "../test/reactDomHarness";
import { ReaderReadingSettings, useReadingSettingsTitles } from "./ReadingSettings";

function switchInputFor(container: HTMLElement, title: string): HTMLInputElement {
  const row = [...container.querySelectorAll("label.shelf-settings-row.is-switch")]
    .find((candidate) => candidate.querySelector("strong")?.textContent === title);
  expect(row, title).toBeDefined();
  const input = row!.querySelector('input[type="checkbox"][role="switch"]') as HTMLInputElement | null;
  expect(input, `${title} switch input`).not.toBeNull();
  return input!;
}

async function toggleSwitch(dom: ReturnType<typeof createReactDomHarness>, input: HTMLInputElement) {
  const next = !input.checked;
  const protoDescriptor = Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, "checked");
  if (protoDescriptor?.set) protoDescriptor.set.call(input, next);
  else input.checked = next;
  await dom.click(input);
}

describe("ReaderReadingSettings book content permissions", () => {
  it("hides book network and JavaScript switches when omitted or unavailable", () => {
    const omitted = renderToStaticMarkup(createElement(ReaderReadingSettings, {
      open: true,
      presentation: "dialog",
      onClose: vi.fn(),
    }));
    expect(omitted).not.toContain("书籍联网");
    expect(omitted).not.toContain("JavaScript 执行");

    const unavailable = renderToStaticMarkup(createElement(ReaderReadingSettings, {
      open: true,
      presentation: "page",
      onClose: vi.fn(),
      bookContentPermissions: {
        available: false,
        networkEnabled: false,
        javascriptEnabled: false,
        setNetworkEnabled: vi.fn(),
        setJavascriptEnabled: vi.fn(),
      },
    }));
    expect(unavailable).not.toContain("书籍联网");
    expect(unavailable).not.toContain("JavaScript 执行");

    let titles: string[] = [];
    function Probe() {
      titles = useReadingSettingsTitles({
        bookContentPermissions: {
          available: true,
          networkEnabled: false,
          javascriptEnabled: false,
          setNetworkEnabled: vi.fn(),
          setJavascriptEnabled: vi.fn(),
        },
      });
      return null;
    }
    renderToStaticMarkup(createElement(Probe));
    expect(titles).not.toContain("书籍联网");
    expect(titles).not.toContain("JavaScript 执行");
  });

  it("renders both session switches with scoped descriptions in dialog and page presentations", () => {
    for (const presentation of ["dialog", "page"] as const) {
      const html = renderToStaticMarkup(createElement(ReaderReadingSettings, {
        open: true,
        presentation,
        onClose: vi.fn(),
        bookContentPermissions: {
          available: true,
          networkEnabled: false,
          javascriptEnabled: false,
          setNetworkEnabled: vi.fn(),
          setJavascriptEnabled: vi.fn(),
        },
      }));
      expect(html, presentation).toContain("当前书籍");
      expect(html, presentation).toContain("书籍联网");
      expect(html, presentation).toContain("允许加载当前章节的外部 HTTPS 图片");
      expect(html, presentation).toContain("JavaScript 执行");
      expect(html, presentation).toContain("允许执行书内受支持的初始化脚本");
      expect(html, presentation).not.toMatch(/role="switch"[^>]*checked=""/);
    }
  });

  it("drives checked state directly from props and invokes setNetworkEnabled/setJavascriptEnabled without local state", async () => {
    const dom = createReactDomHarness();
    const setNetworkEnabled = vi.fn();
    const setJavascriptEnabled = vi.fn();
    const renderWith = (networkEnabled: boolean, javascriptEnabled: boolean) => dom.render(
      createElement(ReaderReadingSettings, {
        open: true,
        presentation: "dialog",
        onClose: vi.fn(),
        bookContentPermissions: {
          available: true,
          networkEnabled,
          javascriptEnabled,
          setNetworkEnabled,
          setJavascriptEnabled,
        },
      }),
    );

    try {
      await renderWith(false, false);
      const netOff = switchInputFor(dom.container, "书籍联网");
      const jsOff = switchInputFor(dom.container, "JavaScript 执行");
      expect(netOff.checked).toBe(false);
      expect(jsOff.checked).toBe(false);

      await toggleSwitch(dom, netOff);
      expect(setNetworkEnabled).toHaveBeenNthCalledWith(1, true);
      await toggleSwitch(dom, jsOff);
      expect(setJavascriptEnabled).toHaveBeenNthCalledWith(1, true);

      // Re-rendering with unchanged props must still reflect prop values (no shadow state).
      await renderWith(false, false);
      expect(switchInputFor(dom.container, "书籍联网").checked).toBe(false);
      expect(switchInputFor(dom.container, "JavaScript 执行").checked).toBe(false);

      await renderWith(true, true);
      const netOn = switchInputFor(dom.container, "书籍联网");
      const jsOn = switchInputFor(dom.container, "JavaScript 执行");
      expect(netOn.checked).toBe(true);
      expect(jsOn.checked).toBe(true);

      await toggleSwitch(dom, netOn);
      expect(setNetworkEnabled).toHaveBeenNthCalledWith(2, false);
      await toggleSwitch(dom, jsOn);
      expect(setJavascriptEnabled).toHaveBeenNthCalledWith(2, false);
    } finally {
      await dom.dispose();
    }
  });
});
