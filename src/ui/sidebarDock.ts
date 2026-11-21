import { useEffect, useState } from "react";

/** Docked sidebar width limits, in CSS pixels. */
export const DOCK_DEFAULT_WIDTH = 320;
export const DOCK_MIN_WIDTH = 280;
export const DOCK_MAX_WIDTH = 480;
/** Leave at least this much reader width before the docked column lets go. */
export const DOCK_SINGLE_PAGE_FLOOR = 500;
/** Hysteresis between auto-collapse and auto-restore. */
export const DOCK_COLLAPSE_HYSTERESIS = 48;
/** Pulling this far past the minimum arms "release to collapse". */
export const DOCK_COLLAPSE_ARM_PX = 24;
/** Visual overshoot beyond the drag limit. */
export const DOCK_RUBBER_LIMIT = 16;
export const DOCK_RUBBER_SCALE = 36;

export function clampDockWidth(width: number): number {
  if (!Number.isFinite(width)) return DOCK_DEFAULT_WIDTH;
  return Math.max(DOCK_MIN_WIDTH, Math.min(DOCK_MAX_WIDTH, width));
}

/** The furthest the inner edge can follow the pointer at this window width. */
export function dockDragMax(windowWidth: number): number {
  if (!Number.isFinite(windowWidth) || windowWidth <= 0) return DOCK_MAX_WIDTH;
  return Math.max(
    DOCK_MIN_WIDTH,
    Math.min(
      DOCK_MAX_WIDTH,
      Math.floor(windowWidth * 0.42),
      Math.floor(windowWidth - DOCK_SINGLE_PAGE_FLOOR),
    ),
  );
}

/**
 * Resist only the part beyond a legal limit. Inside the range the edge follows
 * the pointer 1:1; past it the overshoot approaches DOCK_RUBBER_LIMIT.
 */
export function rubberbandDockWidth(rawWidth: number, maxWidth = DOCK_MAX_WIDTH): number {
  const limit = Math.max(DOCK_MIN_WIDTH, maxWidth);
  const bounded = Math.max(DOCK_MIN_WIDTH, Math.min(limit, rawWidth));
  const excess = rawWidth - bounded;
  if (excess === 0) return bounded;
  return bounded + Math.sign(excess) * DOCK_RUBBER_LIMIT *
    (1 - Math.exp(-Math.abs(excess) / DOCK_RUBBER_SCALE));
}

/** Release below this raw edge arms a collapse instead of a snap-back. */
export function dockCollapseArmed(rawWidth: number): boolean {
  return rawWidth < DOCK_MIN_WIDTH - DOCK_COLLAPSE_ARM_PX;
}

export type DockNarrowState = "keep" | "collapse" | "restore";

/**
 * One decision point for narrow-window auto-collapse. The collapse threshold
 * is T+S; restoring requires T+S+H so a window parked at the boundary cannot
 * oscillate. Width is the preferred dock width, not a temporary clamp.
 */
export function resolveDockNarrowState({
  windowWidth,
  dockWidth,
  collapsed,
  singlePageFloor = DOCK_SINGLE_PAGE_FLOOR,
  hysteresis = DOCK_COLLAPSE_HYSTERESIS,
}: {
  windowWidth: number;
  dockWidth: number;
  collapsed: boolean;
  singlePageFloor?: number;
  hysteresis?: number;
}): DockNarrowState {
  if (!Number.isFinite(windowWidth) || windowWidth <= 0) return "keep";
  const width = clampDockWidth(dockWidth);
  const collapseAt = width + singlePageFloor;
  if (collapsed) return windowWidth >= collapseAt + hysteresis ? "restore" : "keep";
  return windowWidth < collapseAt ? "collapse" : "keep";
}

export function readWindowWidth(): number {
  return typeof window === "undefined" ? 1024 : window.innerWidth;
}

/** Width used for decisions after a resize has been quiet long enough for a reflow. */
export function useDebouncedWindowWidth(delay = 250): number {
  const [width, setWidth] = useState(readWindowWidth);
  useEffect(() => {
    let timer: number | undefined;
    const onResize = (): void => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => setWidth(readWindowWidth()), delay);
    };
    window.addEventListener("resize", onResize, { passive: true });
    window.visualViewport?.addEventListener("resize", onResize);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("resize", onResize);
      window.visualViewport?.removeEventListener("resize", onResize);
    };
  }, [delay]);
  return width;
}
