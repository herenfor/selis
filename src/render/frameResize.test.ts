import { afterEach, expect, it, vi } from "vitest";
import { observeFrameResize } from "./frameResize";

afterEach(() => vi.unstubAllGlobals());

it("reflows when the reader iframe changes size and disconnects on disposal", () => {
  let deliver!: ResizeObserverCallback;
  const observeFrame = vi.fn();
  const disconnectObserver = vi.fn();
  vi.stubGlobal("ResizeObserver", class {
    constructor(callback: ResizeObserverCallback) { deliver = callback; }
    observe = observeFrame;
    disconnect = disconnectObserver;
    unobserve() {}
  });
  const frame = {} as HTMLIFrameElement;
  const reflow = vi.fn();

  const dispose = observeFrameResize(frame, reflow);
  expect(observeFrame).toHaveBeenCalledWith(frame);
  deliver([], {} as ResizeObserver);
  expect(reflow).toHaveBeenCalledTimes(1);

  dispose();
  expect(disconnectObserver).toHaveBeenCalledOnce();
});

it("does nothing when ResizeObserver is unavailable", () => {
  vi.stubGlobal("ResizeObserver", undefined);
  const reflow = vi.fn();
  const dispose = observeFrameResize({} as HTMLIFrameElement, reflow);
  dispose();
  expect(reflow).not.toHaveBeenCalled();
});
