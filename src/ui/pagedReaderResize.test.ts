import { afterEach, expect, it, vi } from "vitest";
import { notifyDockSizeSettled, observePagedReaderResize } from "./pagedReaderResize";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

it("coalesces window resizes, settles a dock immediately, and ignores its duplicate observer delivery", () => {
  vi.useFakeTimers();
  vi.stubGlobal("window", globalThis);
  let deliver!: () => void;
  vi.stubGlobal("ResizeObserver", class {
    constructor(callback: () => void) { deliver = callback; }
    observe() {}
    disconnect() {}
  });
  const page = new EventTarget() as HTMLElement;
  const host = { clientWidth: 1100, clientHeight: 700, closest: () => page };
  const invalidate = vi.fn();
  const reflow = vi.fn();
  const stop = observePagedReaderResize(host as unknown as HTMLElement, invalidate, reflow);

  deliver();
  host.clientWidth = 1000;
  deliver();
  vi.advanceTimersByTime(249);
  expect(reflow).not.toHaveBeenCalled();
  vi.advanceTimersByTime(1);
  expect(reflow).toHaveBeenCalledTimes(1);

  host.clientWidth = 900;
  deliver(); // window change pending when the fixed sidebar settles
  host.clientWidth = 580;
  notifyDockSizeSettled(page);
  expect(reflow).toHaveBeenCalledTimes(2);
  deliver();
  notifyDockSizeSettled(page); // interrupted pin returned to its original size
  vi.advanceTimersByTime(250);
  expect(invalidate).toHaveBeenCalledTimes(4);
  expect(reflow).toHaveBeenCalledTimes(2);

  host.clientHeight = 600;
  deliver();
  stop();
  host.clientWidth = 900;
  notifyDockSizeSettled(page);
  vi.advanceTimersByTime(250);
  expect(reflow).toHaveBeenCalledTimes(2);
});
