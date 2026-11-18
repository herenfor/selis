import { readPageScroll, writePageScroll, type PageProgression } from "./pagedDirection";

/** Whether a key event is the select-all shortcut outside an editable control. */
export function isSelectAllShortcut(event: Pick<KeyboardEvent, "key" | "ctrlKey" | "metaKey" | "target">): boolean {
  if ((event.key !== "a" && event.key !== "A") || (!event.ctrlKey && !event.metaKey)) return false;
  let current: Element | null =
    event.target && typeof event.target === "object" && "nodeType" in event.target
      ? ((event.target as Node).nodeType === 1
          ? (event.target as Element)
          : (event.target as Node).parentElement)
      : null;
  while (current) {
    const tag = current.tagName.toLowerCase();
    if (tag === "input" || tag === "textarea") return false;
    const contentEditable = current.getAttribute("contenteditable");
    if (contentEditable === "false") return true;
    if ((current as HTMLElement).isContentEditable || (contentEditable !== null && contentEditable !== "false")) return false;
    current = current.parentElement;
  }
  return true;
}

/** Clear a document selection after suppressing host/iframe select-all. */
export function clearDocumentSelection(doc: Document | null | undefined): void {
  doc?.getSelection?.()?.removeAllRanges();
}

/** Reset unexpected root/body/window scroll offsets caused by browser reveal/focus scrolling. */
export function resetRootScrollOffsets(doc: Document | null | undefined): boolean {
  if (!doc) return false;
  let changed = false;
  for (const el of [doc.documentElement, doc.body]) {
    if (!el) continue;
    if (Math.abs(el.scrollLeft || 0) > 0.5) { el.scrollLeft = 0; changed = true; }
    if (Math.abs(el.scrollTop || 0) > 0.5) { el.scrollTop = 0; changed = true; }
  }
  const win = doc.defaultView;
  if (win && (Math.abs(win.scrollX || 0) > 0.5 || Math.abs(win.scrollY || 0) > 0.5)) {
    win.scrollTo?.(0, 0);
    changed = true;
  }
  return changed;
}

/** Restore the paged viewer scrollLeft when the browser shifts it away from its authorized offset. */
export function restorePagedViewerScroll(
  viewer: Pick<HTMLElement, "scrollLeft"> | null | undefined,
  expectedLogicalScroll: number | null | undefined,
  progression: PageProgression,
): boolean {
  if (!viewer || typeof expectedLogicalScroll !== "number" || !Number.isFinite(expectedLogicalScroll)) return false;
  if (Math.abs(readPageScroll(viewer, progression) - expectedLogicalScroll) <= 0.5) return false;
  writePageScroll(viewer, expectedLogicalScroll, progression);
  return true;
}

export interface PagedScrollGuardContext {
  readonly doc: Document | null | undefined;
  readonly viewer: Pick<HTMLElement, "scrollLeft"> | null | undefined;
  readonly scrollMode: boolean;
  readonly displayReady: boolean;
  readonly nativeSnapArmed: boolean;
  readonly progression: PageProgression;
  /** Authorized logical scrollLeft locked by an active compositor window, or null in resting geometry. */
  readonly windowScroll?: number | null;
}

/**
 * Single source of truth for authorized resting `viewer.scrollLeft` in paginated mode.
 *
 * All resting paginated writes flow through `write()` so the guard's expected offset
 * updates atomically with `viewer.scrollLeft` (across `setPage`, reflows, and `TransformPageMotion.settleTo`).
 * While an active compositor motion window owns `viewer.scrollLeft`, `guard()` checks against `windowScroll`.
 */
export class PagedScrollGuard {
  private expectedScroll: number | null = null;

  get expected(): number | null {
    return this.expectedScroll;
  }

  /** Write a resting paginated scroll offset and record the normalized viewer position. */
  write(
    viewer: Pick<HTMLElement, "scrollLeft"> | null | undefined,
    logicalScroll: number,
    progression: PageProgression,
  ): number {
    if (!viewer) return 0;
    writePageScroll(viewer, logicalScroll, progression);
    const actual = readPageScroll(viewer, progression);
    this.expectedScroll = actual;
    return actual;
  }

  /** Adopt the viewer's current resting offset as authorized (e.g. initial display or native snap settle). */
  syncFromViewer(
    viewer: Pick<HTMLElement, "scrollLeft"> | null | undefined,
    scrollMode: boolean,
    progression: PageProgression,
  ): void {
    this.expectedScroll = viewer && !scrollMode ? readPageScroll(viewer, progression) : null;
  }

  /** Clear authorized scroll state when tearing down or leaving a chapter document. */
  clear(): void {
    this.expectedScroll = null;
  }

  /** Reset leaked root scroll offsets and restore unauthorized paginated viewer drift. */
  guard(ctx: PagedScrollGuardContext): boolean {
    let changed = resetRootScrollOffsets(ctx.doc);
    if (ctx.scrollMode || !ctx.displayReady || ctx.nativeSnapArmed) return changed;
    const expected =
      typeof ctx.windowScroll === "number" && Number.isFinite(ctx.windowScroll)
        ? ctx.windowScroll
        : this.expectedScroll;
    if (restorePagedViewerScroll(ctx.viewer, expected, ctx.progression)) changed = true;
    return changed;
  }
}
