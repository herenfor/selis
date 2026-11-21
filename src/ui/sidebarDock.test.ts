import { describe, expect, it } from "vitest";
import {
  DOCK_COLLAPSE_HYSTERESIS,
  DOCK_DEFAULT_WIDTH,
  DOCK_MAX_WIDTH,
  DOCK_MIN_WIDTH,
  DOCK_RUBBER_LIMIT,
  DOCK_SINGLE_PAGE_FLOOR,
  clampDockWidth,
  dockCollapseArmed,
  dockDragMax,
  resolveDockNarrowState,
  rubberbandDockWidth,
} from "./sidebarDock";

describe("docked sidebar width and narrow-window state", () => {
  it("clamps the preferred width to the absolute 280-480 range", () => {
    expect(clampDockWidth(DOCK_DEFAULT_WIDTH)).toBe(320);
    expect(clampDockWidth(100)).toBe(DOCK_MIN_WIDTH);
    expect(clampDockWidth(999)).toBe(DOCK_MAX_WIDTH);
    expect(clampDockWidth(Number.NaN)).toBe(DOCK_DEFAULT_WIDTH);
  });

  it("limits drag by 42%, the 500px reader floor and the 480px absolute cap", () => {
    expect([840, 900, 1024, 1152, 1280, 1920, 2560].map(dockDragMax))
      .toEqual([340, 378, 430, 480, 480, 480, 480]);
    // Below 780 the reader floor is already impossible; the handle still stops at 280.
    expect(dockDragMax(700)).toBe(280);
  });

  it("rubberbands only beyond the legal range, with a bounded visual overshoot", () => {
    expect(rubberbandDockWidth(320, 480)).toBe(320);
    expect(rubberbandDockWidth(480, 480)).toBe(480);
    expect(rubberbandDockWidth(1000, 480)).toBeGreaterThan(480);
    expect(rubberbandDockWidth(1000, 480)).toBeLessThan(480 + DOCK_RUBBER_LIMIT + 1e-9);
    expect(rubberbandDockWidth(100, 480)).toBeLessThan(280);
    expect(rubberbandDockWidth(100, 480)).toBeGreaterThan(280 - DOCK_RUBBER_LIMIT - 1e-9);
  });

  it("arms collapse only after the raw edge passes 24px below the minimum", () => {
    expect(dockCollapseArmed(280)).toBe(false);
    expect(dockCollapseArmed(257)).toBe(false);
    expect(dockCollapseArmed(255.9)).toBe(true);
  });

  it("collapses at T+500 and restores at T+500+48 without boundary oscillation", () => {
    const state = (windowWidth: number, dockWidth: number, collapsed: boolean) =>
      resolveDockNarrowState({ windowWidth, dockWidth, collapsed });
    for (const [dockWidth, collapseAt, restoreAt] of [
      [280, 780, 828],
      [320, 820, 868],
      [430, 930, 978],
      [480, 980, 1028],
    ]) {
      expect(state(collapseAt - 1, dockWidth, false), `${dockWidth} collapse`).toBe("collapse");
      expect(state(collapseAt, dockWidth, false), `${dockWidth} keep`).toBe("keep");
      expect(state(restoreAt - 1, dockWidth, true), `${dockWidth} hold`).toBe("keep");
      expect(state(restoreAt, dockWidth, true), `${dockWidth} restore`).toBe("restore");
    }
    // Inside the hysteresis band a collapsed dock stays collapsed, a visible one stays visible.
    expect(state(840, 320, true)).toBe("keep");
    expect(state(840, 320, false)).toBe("keep");
    expect(state(840 + DOCK_COLLAPSE_HYSTERESIS, 320, true)).toBe("restore");
  });

  it("does not invent a collapse for an unmeasured window", () => {
    expect(resolveDockNarrowState({ windowWidth: 0, dockWidth: 320, collapsed: false })).toBe("keep");
    expect(DOCK_SINGLE_PAGE_FLOOR).toBe(500);
    expect(DOCK_COLLAPSE_HYSTERESIS).toBe(48);
  });
});
