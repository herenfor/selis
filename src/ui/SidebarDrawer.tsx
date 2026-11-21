import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { SIDEBAR_TABS, createSidebarNavigationMemory, installSidebarSwipe, type SidebarNavigationMemory, type SidebarSwipeMotion } from "./sidebarSwipe";
import { useMenuClose } from "./menuMotion";
import type { TocNode } from "../core/types";
import { limitNotes, TOC_EXPAND_ALL_LIMIT, type NoteViewModel } from "./sidebarModel";
import { activeTocEntry, indexToc, visibleTocRows, type IndexedTocNode } from "./sidebarToc";
import { SidebarTocList } from "./SidebarTocList";
import type { Bookmark } from "./shelf";
import { ArrowLeftIcon, BookmarkIcon, CloseIcon, PencilIcon, PinIcon, ShareIcon, TrashIcon } from "./readerIcons";
import "./sidebarDrawer.css";
import { UndoPill, undoDetail } from "./controls/UndoPill";
import { highlightColorProps } from "./highlightModel";
import "./highlightMenu.css";
import { NOTE_UNDO_MS } from "./pendingNoteDelete";
import { currentUiLocale, uiText, useUiText } from "./localization/UiLanguageProvider";
import {
  DOCK_DEFAULT_WIDTH,
  DOCK_MAX_WIDTH,
  DOCK_MIN_WIDTH,
  clampDockWidth,
  dockCollapseArmed,
  dockDragMax,
  rubberbandDockWidth,
} from "./sidebarDock";

export type SidebarTab = "toc" | "bookmarks" | "notes";
export type SidebarMode = "overlay" | "docked";
export type SidebarSide = "left" | "right";

export interface SidebarDrawerProps {
  open: boolean;
  navigationMemory?: SidebarNavigationMemory;
  side?: SidebarSide;
  activeTab: SidebarTab;
  onTabChange: (tab: SidebarTab) => void;
  mode: SidebarMode;
  onModeChange: (mode: SidebarMode) => void;
  onClose: () => void;
  /** 手机窄窗强制浮层，隐藏 pin/dock 入口，避免抽走正文真实宽度。 */
  compact?: boolean;
  canDock?: boolean;
  /**
   * Keep the closed overlay drawer mounted (prepared when a book opens):
   * laid out hidden and inert; the TOC window waits for a real opening to
   * center or restore its scroll.
   */
  warm?: boolean;
  /** Called once after the first closed (prepared) layout. */
  onPrepared?: () => void;
  /** While warm: draw once, practically invisible (panelPaintWarmup). */
  paintWarm?: boolean;
  /** A narrow window temporarily hid the docked drawer; it stays mounted off-screen. */
  autoCollapsed?: boolean;
  /** Show the inner-edge resize handle (wide desktop, docked and visible). */
  resizable?: boolean;
  dockWidth?: number;
  onResizeStart?: () => void;
  onResizePreview?: (width: number) => void;
  onResizeEnd?: (width: number, collapse: boolean) => void;
  onResizeCancel?: () => void;
  onResetWidth?: () => void;

  // 目录数据
  toc: TocNode[];
  activeHref?: string;
  onNavigateToc: (href: string) => void;

  // 书签数据
  bookmarks: Array<Bookmark & { chapterLabel?: string }>;
  onSelectBookmark: (id: string) => void;
  onDeleteBookmark?: (id: string) => void;

  // 笔记数据
  notes: readonly NoteViewModel[];
  onNavigateNote: (note: NoteViewModel) => void;
  onEditNote?: (note: NoteViewModel) => void;
  onDeleteNote?: (note: NoteViewModel) => void;
  /** Opens the share card for this note (ER-0119). */
  onShareNote?: (note: NoteViewModel) => void;
  /** Notes deleted a moment ago (id → when): each card shows its own undo pill in place. */
  pendingDeleteNotes?: ReadonlyMap<string, number>;
  onUndoDeleteNote?: (noteId: string) => void;
  /** Recently deleted notes of this book, newest first (ER-0180). */
  deletedNotes?: readonly NoteViewModel[];
  onRestoreDeletedNote?: (noteId: string) => void;
}

const NO_PENDING_DELETES: ReadonlyMap<string, number> = new Map();
const NO_DELETED_NOTES: readonly NoteViewModel[] = [];

function formatDate(timestamp: number): string {
  if (!Number.isFinite(timestamp)) return uiText("sidebar.unknownTime");
  return new Intl.DateTimeFormat(currentUiLocale(), { dateStyle: "short", timeStyle: "short" }).format(new Date(timestamp));
}

export const SidebarDrawer: React.FC<SidebarDrawerProps> = ({
  open,
  navigationMemory,
  side = "left",
  activeTab,
  onTabChange,
  mode,
  onModeChange,
  onClose,
  compact = false,
  canDock = !compact,
  warm = false,
  onPrepared,
  paintWarm = false,
  autoCollapsed = false,
  resizable = false,
  dockWidth = DOCK_DEFAULT_WIDTH,
  onResizeStart,
  onResizePreview,
  onResizeEnd,
  onResizeCancel,
  onResetWidth,
  toc,
  activeHref,
  onNavigateToc,
  bookmarks,
  onSelectBookmark,
  onDeleteBookmark,
  notes,
  onNavigateNote,
  onEditNote,
  onDeleteNote,
  onShareNote,
  pendingDeleteNotes = NO_PENDING_DELETES,
  deletedNotes = NO_DELETED_NOTES,
  onRestoreDeletedNote,
  onUndoDeleteNote,
}) => {
  const { t } = useUiText();
  const tocIndex = useMemo(() => indexToc(toc), [toc]);
  const activeEntry = useMemo(() => activeTocEntry(tocIndex, activeHref), [tocIndex, activeHref]);
  const [tocFilter, setTocFilter] = useState(navigationMemory?.tocFilter ?? "");
  const { isClosing, requestClose, cancelClose } = useMenuClose(onClose, open);
  // 浮层模式打开时焦点进入抽屉；停靠模式是阅读的一部分，不抢焦点。
  const drawerRef = useRef<HTMLElement>(null);
  const resizeHandleRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{
    pointerId: number;
    startWidth: number;
    startPointer: number;
    lastRaw: number;
  } | null>(null);
  const keyboardResizeRef = useRef<{
    startWidth: number;
    targetWidth: number;
    timer: number | undefined;
  } | null>(null);

  /** Width-space pointer coordinate: left dock grows to the right, right dock to the left. */
  const dockPointer = (clientX: number): number =>
    side === "left" ? clientX : window.innerWidth - clientX;

  const paintResizeValue = (rawWidth: number): void => {
    const handle = resizeHandleRef.current;
    if (!handle) return;
    const legal = Math.round(clampDockWidth(rawWidth));
    handle.setAttribute("aria-valuenow", String(legal));
    handle.setAttribute("aria-valuetext", t("sidebar.dock.width", { width: legal }));
    handle.dataset.armed = String(dockCollapseArmed(rawWidth));
  };

  const commitKeyboardResize = (): void => {
    const session = keyboardResizeRef.current;
    if (!session) return;
    keyboardResizeRef.current = null;
    if (session.timer !== undefined) window.clearTimeout(session.timer);
    paintResizeValue(session.targetWidth);
    onResizeEnd?.(session.targetWidth, false);
  };

  useEffect(() => () => {
    const timer = keyboardResizeRef.current?.timer;
    if (timer !== undefined) window.clearTimeout(timer);
  }, []);

  // The handle disappears when the window falls below the wide layout or the
  // drawer changes mode mid-gesture. Drop the frozen state rather than leaving
  // the page held under a pointer that no longer has an edge to drag.
  useEffect(() => {
    if (resizable && mode === "docked") return;
    if (!dragRef.current && !keyboardResizeRef.current) return;
    dragRef.current = null;
    const timer = keyboardResizeRef.current?.timer;
    if (timer !== undefined) window.clearTimeout(timer);
    keyboardResizeRef.current = null;
    onResizeCancel?.();
  }, [resizable, mode, onResizeCancel]);

  const beginResize = (event: React.PointerEvent<HTMLDivElement>): void => {
    if (!resizable || mode !== "docked" || event.button !== 0 || dragRef.current) return;
    const drawer = drawerRef.current;
    if (!drawer) return;
    // A pointer grab takes ownership from any pending keyboard nudge.
    if (keyboardResizeRef.current) {
      if (keyboardResizeRef.current.timer !== undefined) window.clearTimeout(keyboardResizeRef.current.timer);
      keyboardResizeRef.current = null;
    }
    event.preventDefault();
    const startWidth = drawer.getBoundingClientRect().width;
    dragRef.current = {
      pointerId: event.pointerId,
      startWidth,
      startPointer: dockPointer(event.clientX),
      lastRaw: startWidth,
    };
    event.currentTarget.dataset.dragging = "true";
    event.currentTarget.dataset.armed = "false";
    event.currentTarget.setPointerCapture(event.pointerId);
    onResizeStart?.();
  };

  const moveResize = (event: React.PointerEvent<HTMLDivElement>): void => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const raw = drag.startWidth + dockPointer(event.clientX) - drag.startPointer;
    drag.lastRaw = raw;
    const max = dockDragMax(window.innerWidth);
    onResizePreview?.(rubberbandDockWidth(raw, max));
    paintResizeValue(raw);
  };

  const endResize = (event: React.PointerEvent<HTMLDivElement>): void => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    dragRef.current = null;
    event.currentTarget.dataset.dragging = "false";
    event.currentTarget.dataset.armed = "false";
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    if (dockCollapseArmed(drag.lastRaw)) {
      onResizeEnd?.(dockWidth, true);
    } else {
      const finalWidth = clampDockWidth(drag.lastRaw);
      paintResizeValue(finalWidth);
      onResizeEnd?.(finalWidth, false);
    }
  };

  const cancelResize = (event?: React.PointerEvent<HTMLDivElement>): void => {
    dragRef.current = null;
    if (event) {
      event.currentTarget.dataset.dragging = "false";
      event.currentTarget.dataset.armed = "false";
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
    }
    paintResizeValue(dockWidth);
    onResizeCancel?.();
  };

  const handleResizeKey = (event: React.KeyboardEvent<HTMLDivElement>): void => {
    if (!resizable || mode !== "docked") return;
    const key = event.key;
    if (!["ArrowLeft", "ArrowRight", "Home", "End", "Escape"].includes(key)) return;
    event.preventDefault();
    if (key === "Escape") {
      const session = keyboardResizeRef.current;
      if (session) {
        keyboardResizeRef.current = null;
        if (session.timer !== undefined) window.clearTimeout(session.timer);
        paintResizeValue(dockWidth);
        onResizeCancel?.();
      }
      return;
    }
    const current = keyboardResizeRef.current?.targetWidth
      ?? drawerRef.current?.getBoundingClientRect().width
      ?? dockWidth;
    if (!keyboardResizeRef.current) {
      onResizeStart?.();
      keyboardResizeRef.current = { startWidth: current, targetWidth: current, timer: undefined };
    }
    const session = keyboardResizeRef.current;
    if (!session) return;
    const max = dockDragMax(window.innerWidth);
    const step = event.shiftKey ? 48 : 16;
    let next = current;
    if (key === "Home") next = DOCK_MIN_WIDTH;
    else if (key === "End") next = max;
    else if (key === "ArrowRight") next = current + (side === "left" ? step : -step);
    else if (key === "ArrowLeft") next = current - (side === "left" ? step : -step);
    session.targetWidth = clampDockWidth(next);
    onResizePreview?.(session.targetWidth);
    paintResizeValue(session.targetWidth);
    if (session.timer !== undefined) window.clearTimeout(session.timer);
    session.timer = window.setTimeout(commitKeyboardResize, 600);
  };

  const resetResize = (): void => {
    if (keyboardResizeRef.current) {
      if (keyboardResizeRef.current.timer !== undefined) window.clearTimeout(keyboardResizeRef.current.timer);
      keyboardResizeRef.current = null;
    }
    paintResizeValue(DOCK_DEFAULT_WIDTH);
    onResizeCancel?.();
    onResetWidth?.();
  };

  useEffect(() => {
    const drawer = drawerRef.current;
    if (open && mode === "overlay" && drawer && !drawer.contains(document.activeElement)) {
      drawer.focus({ preventScroll: true });
    }
  }, [open, mode]);
  const localMemory = useRef(createSidebarNavigationMemory());
  const memory = navigationMemory ?? localMemory.current;
  const viewportRef = useRef<HTMLDivElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const paneRefs = useRef<Partial<Record<SidebarTab, HTMLDivElement>>>({});
  const motionRef = useRef<SidebarSwipeMotion>();
  const onTabChangeRef = useRef(onTabChange);
  onTabChangeRef.current = onTabChange;
  const visible = open || isClosing;
  const [tocExpanded, setTocExpanded] = useState<ReadonlySet<string>>(
    () => memory.tocExpanded ?? new Set(tocIndex.entries.length <= TOC_EXPAND_ALL_LIMIT
      ? tocIndex.entries.filter(entry => entry.children.length > 0).map(entry => entry.key) : []),
  );
  // Each time the drawer opens or the current chapter changes, reveal the
  // current entry's branch before the scroll-to-active layout effect runs.
  // Adjusting state during render keeps that in the same commit.
  const revealTarget = visible ? activeEntry ?? null : null;
  const [revealedTarget, setRevealedTarget] = useState<IndexedTocNode | null>(null);
  if (revealTarget !== revealedTarget) {
    setRevealedTarget(revealTarget);
    const ancestors: string[] = [];
    for (let parent = revealTarget?.parent; parent; parent = parent.parent) ancestors.push(parent.key);
    if (ancestors.some((key) => !tocExpanded.has(key))) {
      const next = new Set(tocExpanded);
      for (const key of ancestors) next.add(key);
      memory.tocExpanded = next;
      setTocExpanded(next);
    }
  }
  const toggleTocBranch = (key: string, expand: boolean): void => {
    setTocExpanded((previous) => {
      if (previous.has(key) === expand) return previous;
      const next = new Set(previous);
      if (expand) next.add(key);
      else next.delete(key);
      memory.tocExpanded = next;
      return next;
    });
  };

  useLayoutEffect(() => {
    if (!visible) return;
    for (const tab of SIDEBAR_TABS) {
      const pane = paneRefs.current[tab];
      if (!pane) continue;
      // The TOC owns its measured window and first-open centering.
      if (tab === "toc") continue;
      if (memory.scrollTop[tab] !== undefined) pane.scrollTop = memory.scrollTop[tab]!;
      memory.scrollTop[tab] = pane.scrollTop;
    }
    const binding = installSidebarSwipe(viewportRef.current!, trackRef.current!, SIDEBAR_TABS.indexOf(activeTab),
      index => onTabChangeRef.current(SIDEBAR_TABS[index]));
    motionRef.current = binding.motion;
    return () => { binding.dispose(); motionRef.current = undefined; };
  }, [visible, memory]);

  useLayoutEffect(() => {
    motionRef.current?.select(SIDEBAR_TABS.indexOf(activeTab), false, false);
  }, [activeTab]);

  const selectTab = (tab: SidebarTab) => {
    cancelClose();
    if (motionRef.current) motionRef.current.select(SIDEBAR_TABS.indexOf(tab), true);
    else onTabChange(tab);
  };

  const paneProps = (tab: SidebarTab) => ({
    ref: (pane: HTMLDivElement | null) => { if (pane) paneRefs.current[tab] = pane; },
    role: "tabpanel",
    "aria-label": tab === "toc" ? t("sidebar.tab.toc") : tab === "bookmarks" ? t("sidebar.tab.bookmarks") : t("sidebar.tab.notes"),
    "aria-hidden": activeTab !== tab,
    // React 18 does not type inert; the native attribute also removes hidden controls from tab order.
    ...(activeTab !== tab ? { inert: "" } : {}),
    onScroll: (event: React.UIEvent<HTMLDivElement>) => { memory.scrollTop[tab] = event.currentTarget.scrollTop; },
  });

  const onPreparedRef = useRef(onPrepared);
  onPreparedRef.current = onPrepared;
  const prepared = useRef(false);
  useLayoutEffect(() => {
    if (visible || !warm || prepared.current) return;
    prepared.current = true;
    // Style and layout only: a visibility:hidden drawer is not painted.
    drawerRef.current?.getBoundingClientRect();
    onPreparedRef.current?.();
  }, [visible, warm]);

  // Follow once on the TOC tab; a jump that stayed inside one entry keeps the user's scroll.
  // Without a matching entry nothing is guessed from the ratio, and once the reader has moved
  // off the landed entry (a page turn, bookmark or TOC tap) the old jump is not followed.
  let tocFollow: number | undefined;
  if (memory.tocFollow && visible && activeTab === "toc") {
    const { generation, fromHref, toHref } = memory.tocFollow;
    if (!activeEntry || activeTocEntry(tocIndex, fromHref)?.key === activeEntry.key
      || (toHref !== undefined && activeTocEntry(tocIndex, toHref)?.key !== activeEntry.key)) memory.tocFollow = undefined;
    else tocFollow = generation;
  }

  const tocRows = useMemo(() => visibleTocRows(tocIndex, tocExpanded, tocFilter), [tocIndex, tocExpanded, tocFilter]);
  const sortedNotes = useMemo(() => limitNotes(notes, 200).items, [notes]);
  const shownNoteCount = notes.reduce((count, note) => count + (pendingDeleteNotes.has(note.id) ? 0 : 1), 0);
  // 最近删除列表：离开笔记页签或列表清空后回到笔记。
  const [binOpen, setBinOpen] = useState(false);
  const showBin = binOpen && activeTab === "notes" && deletedNotes.length > 0;

  if (!open && mode === "overlay" && !isClosing && !warm) {
    return null;
  }

  const tocCount = tocIndex.entries.length;

  return (
    <>
      {/* 浮动微浮岛遮罩模式下渲染背景半透明蒙层 */}
      {open && (
        <div
          className={`sidebar-backdrop${canDock ? " can-dock" : ""}${mode === "docked" ? " is-docked" : ""}${isClosing ? " is-closing" : ""}`}
          onClick={mode === "overlay" ? requestClose : undefined}
          aria-hidden="true"
        />
      )}

      <aside
        ref={drawerRef}
        tabIndex={-1}
        className={`sidebar-drawer ${mode === "docked" ? "is-docked" : "is-overlay"} side-${side}${compact ? " is-compact" : ""}${open ? " is-open" : " is-closed"}${isClosing ? " is-closing" : ""}${visible ? "" : " is-warm"}${!visible && paintWarm ? " is-paint-warm" : ""}${autoCollapsed ? " is-auto-collapsed" : ""}`}
        role="region"
        aria-label={t("sidebar.drawer")}
        aria-hidden={visible ? undefined : true}
        {...(visible ? {} : { inert: "" })}
      >
        {/* 抽屉顶栏：Segmented Tabs + Pin + 关闭 */}
        <div className="sidebar-header">
          <div className="sidebar-tabs" role="tablist">
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === "toc"}
              className={`sidebar-tab${activeTab === "toc" ? " active" : ""}`}
              onClick={() => selectTab("toc")}
            >
              {t("sidebar.tab.toc")}
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === "bookmarks"}
              className={`sidebar-tab${activeTab === "bookmarks" ? " active" : ""}`}
              onClick={() => selectTab("bookmarks")}
            >
              {bookmarks.length > 0 ? t("sidebar.tab.count", { label: t("sidebar.tab.bookmarks"), count: bookmarks.length }) : t("sidebar.tab.bookmarks")}
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === "notes"}
              className={`sidebar-tab${activeTab === "notes" ? " active" : ""}`}
              onClick={() => selectTab("notes")}
            >
              {shownNoteCount > 0 ? t("sidebar.tab.count", { label: t("sidebar.tab.notes"), count: shownNoteCount }) : t("sidebar.tab.notes")}
            </button>
          </div>

          <div className="sidebar-header-actions">
            {canDock && (
            <button
              type="button"
              className={`sidebar-icon-btn sidebar-pin-btn${mode === "docked" ? " active" : ""}`}
              onClick={() => {
                cancelClose();
                onModeChange(mode === "docked" ? "overlay" : "docked");
              }}
              aria-pressed={mode === "docked"}
              title={mode === "docked" ? t("sidebar.unpin.tip") : t("sidebar.pin")}
              aria-label={mode === "docked" ? t("sidebar.unpin") : t("sidebar.pin")}
            >
              <PinIcon size={14} pinned={mode === "docked"} />
            </button>
            )}
            <button
              type="button"
              className="sidebar-icon-btn sidebar-close-btn"
              onClick={requestClose}
              title={t("sidebar.close.tip")}
              aria-label={t("sidebar.close")}
            >
              <CloseIcon size={14} />
            </button>
          </div>
        </div>

        {/* 抽屉内容区 */}
        <div className="sidebar-body" ref={viewportRef}>
          <div className="sidebar-track" ref={trackRef}>
          {/* TAB 1: 目录 */}
            <div className="sidebar-pane sidebar-toc-pane scrollbar-hidden" {...paneProps("toc")}>
              {tocCount > 8 && (
                <div className="sidebar-toc-filter-wrap">
                  <input
                    type="search"
                    className="sidebar-toc-filter-input"
                    placeholder={t("sidebar.toc.filter")}
                    value={tocFilter}
                    onChange={(e) => { memory.tocFilter = e.target.value; setTocFilter(e.target.value); }}
                    aria-label={t("sidebar.toc.filter.label")}
                  />
                  {tocFilter && (
                    <button
                      type="button"
                      className="sidebar-toc-filter-clear"
                      onClick={() => { memory.tocFilter = ""; setTocFilter(""); }}
                      title={t("sidebar.toc.filter.clear")}
                      aria-label={t("sidebar.toc.filter.clear")}
                    >
                      <CloseIcon size={11} />
                    </button>
                  )}
                </div>
              )}
              {tocCount === 0 ? (
                <div className="sidebar-empty">{t("sidebar.toc.empty")}</div>
              ) : tocRows.length === 0 ? (
                <div className="sidebar-empty">{t("sidebar.toc.noMatch")}</div>
              ) : (
                <SidebarTocList
                  rows={tocRows}
                  activeKey={activeEntry?.key}
                  nested={tocIndex.nested}
                  filtering={Boolean(tocFilter.trim())}
                  memory={memory}
                  live={visible}
                  follow={tocFollow}
                  onToggle={toggleTocBranch}
                  onNavigate={(href) => {
                    onNavigateToc(href);
                    if (mode === "overlay") requestClose();
                  }}
                />
              )}
            </div>


          {/* TAB 2: 书签 */}
            <div className="sidebar-pane sidebar-bookmarks-pane scrollbar-hidden" {...paneProps("bookmarks")}>
              {bookmarks.length === 0 ? (
                <div className="sidebar-empty">
                  <span>{t("sidebar.bookmarks.empty")}</span>
                  <span className="sidebar-empty-tip">{t("sidebar.bookmarks.emptyTip")}</span>
                </div>
              ) : (
                <div className="sidebar-bookmark-list">
                  {bookmarks.map((b) => (
                    <div key={b.id} className="sidebar-bookmark-row">
                      <button
                        type="button"
                        className="sidebar-bookmark-card"
                        onClick={() => {
                          onSelectBookmark(b.id);
                          if (mode === "overlay") requestClose();
                        }}
                        title={b.text}
                      >
                        <span className="sidebar-bookmark-icon">
                          <BookmarkIcon size={14} active={true} />
                        </span>
                        <span className="sidebar-bookmark-meta">
                          <span className="sidebar-bookmark-text">{b.text || t("sidebar.bookmark.noText")}</span>
                          <span className="sidebar-bookmark-chapter">
                            {b.chapterLabel ? `${b.chapterLabel} · ` : ""}
                            {t("sidebar.bookmark.addedAt", { time: formatDate(b.createdAtMs) })}
                          </span>
                        </span>
                      </button>
                      {onDeleteBookmark && (
                        <button
                          type="button"
                          className="sidebar-bookmark-del-btn"
                          onClick={(e) => {
                            e.stopPropagation();
                            onDeleteBookmark(b.id);
                          }}
                          title={t("sidebar.bookmark.delete.tip")}
                          aria-label={t("sidebar.bookmark.delete")}
                        >
                          <CloseIcon size={12} />
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>


          {/* TAB 3: 笔记 */}
            <div className="sidebar-pane sidebar-notes-pane scrollbar-hidden" {...paneProps("notes")}>
              {showBin ? (
                <div className="sidebar-notes-bin">
                  <div className="sidebar-notes-bin-head">
                    <button type="button" className="sidebar-notes-bin-back" onClick={() => setBinOpen(false)}
                      aria-label={t("sidebar.notes.bin.back")} title={t("sidebar.notes.bin.back")}>
                      <ArrowLeftIcon size={16} />
                    </button>
                    <span>{t("sidebar.notes.bin")}</span>
                  </div>
                  <p className="sidebar-notes-bin-hint">{t("sidebar.notes.bin.hint")}</p>
                  <div className="sidebar-notes-list">
                    {deletedNotes.map((note) => {
                      const tone = highlightColorProps(note.color);
                      return (
                        <article className={`sidebar-note-card ${tone.className}`} style={tone.style} key={note.id}>
                          <span className="sidebar-note-bar" aria-hidden="true" />
                          <div className="sidebar-note-main is-static">
                            {note.content ? (
                              <span className="sidebar-note-content">{note.content}</span>
                            ) : (
                              <span className="sidebar-note-content is-quote" title={note.selectedText}>
                                {t("sidebar.note.quote", { text: note.selectedText })}
                              </span>
                            )}
                            <span className="sidebar-note-meta">
                              {note.chapterTitle} · {formatDate(note.createdAtMs)}
                            </span>
                            {note.content && (
                              <span className="sidebar-note-selection" title={note.selectedText}>
                                {t("sidebar.note.quote", { text: note.selectedText })}
                              </span>
                            )}
                          </div>
                          <div className="sidebar-note-actions">
                            <button type="button" className="sidebar-note-act" onClick={() => onRestoreDeletedNote?.(note.id)}>
                              {t("sidebar.notes.bin.restore")}
                            </button>
                          </div>
                        </article>
                      );
                    })}
                  </div>
                </div>
              ) : sortedNotes.length === 0 ? (
                <div className="sidebar-empty">
                  <span>{t("sidebar.notes.empty")}</span>
                  <span className="sidebar-empty-tip">{t("sidebar.notes.emptyTip")}</span>
                </div>
              ) : (
                <div className="sidebar-notes-list">
                  {sortedNotes.map((note) => pendingDeleteNotes.has(note.id) ? (
                    <UndoPill
                      key={note.id}
                      className="sidebar-note-undo"
                      message={note.content ? t("sidebar.note.deleted") : t("sidebar.highlight.deleted")}
                      detail={undoDetail(note.content || note.selectedText)}
                      undoLabel={t("sidebar.note.undo")}
                      onUndo={() => onUndoDeleteNote?.(note.id)}
                      durationMs={NOTE_UNDO_MS}
                      startedAtMs={pendingDeleteNotes.get(note.id)}
                      autoFocus
                    />
                  ) : (() => {
                    const tone = highlightColorProps(note.color);
                    return (
                    <article className={`sidebar-note-card ${tone.className}`} style={tone.style} key={note.id}>
                      <span className="sidebar-note-bar" aria-hidden="true" />
                      <button
                        type="button"
                        className="sidebar-note-main"
                        onClick={() => {
                          onNavigateNote(note);
                          if (mode === "overlay") requestClose();
                        }}
                      >
                        {note.content ? (
                          <span className="sidebar-note-content">{note.content}</span>
                        ) : (
                          <span className="sidebar-note-content is-quote" title={note.selectedText}>
                            {t("sidebar.note.quote", { text: note.selectedText })}
                          </span>
                        )}
                        <span className="sidebar-note-meta">
                          {note.chapterTitle} · {formatDate(note.createdAtMs)}
                        </span>
                        {note.content && (
                          <span className="sidebar-note-selection" title={note.selectedText}>
                            {t("sidebar.note.quote", { text: note.selectedText })}
                          </span>
                        )}
                      </button>
                      <div className="sidebar-note-actions">
                        {onEditNote && (
                          <button
                            type="button"
                            className="sidebar-note-act"
                            onClick={() => onEditNote(note)}
                          >
                            <PencilIcon size={14} />
                            {note.content ? t("sidebar.note.edit") : t("sidebar.note.add")}
                          </button>
                        )}
                        {onShareNote && (
                          <button
                            type="button"
                            className="sidebar-note-act"
                            onClick={() => onShareNote(note)}
                          >
                            <ShareIcon size={14} />
                            {t("share.menu")}
                          </button>
                        )}
                        {onDeleteNote && (
                          <button
                            type="button"
                            className="sidebar-note-act danger"
                            onClick={() => onDeleteNote(note)}
                          >
                            <TrashIcon size={14} />
                            {t("sidebar.note.delete")}
                          </button>
                        )}
                      </div>
                    </article>
                    );
                  })())}
                </div>
              )}
              {!showBin && deletedNotes.length > 0 && (
                <button type="button" className="sidebar-notes-bin-entry" onClick={() => setBinOpen(true)}>
                  <TrashIcon size={14} />
                  <span>{t("sidebar.notes.bin")}</span>
                  <span className="sidebar-notes-bin-count">{deletedNotes.length}</span>
                </button>
              )}
            </div>
          </div>
        </div>
        {resizable && mode === "docked" && (
          <div
            ref={resizeHandleRef}
            className="sidebar-dock-resize"
            role="separator"
            tabIndex={0}
            aria-label={t("sidebar.dock.resize")}
            aria-orientation="vertical"
            aria-valuemin={DOCK_MIN_WIDTH}
            aria-valuemax={DOCK_MAX_WIDTH}
            aria-valuenow={Math.round(clampDockWidth(dockWidth))}
            aria-valuetext={t("sidebar.dock.width", { width: Math.round(clampDockWidth(dockWidth)) })}
            title={t("sidebar.dock.resize")}
            data-armed="false"
            data-dragging="false"
            onPointerDown={beginResize}
            onPointerMove={moveResize}
            onPointerUp={endResize}
            onPointerCancel={cancelResize}
            onLostPointerCapture={(event) => {
              if (dragRef.current?.pointerId === event.pointerId) cancelResize();
            }}
            onKeyDown={handleResizeKey}
            onBlur={commitKeyboardResize}
            onDoubleClick={resetResize}
          >
            <span className="sidebar-dock-resize-grip" aria-hidden="true" />
            <span className="sidebar-dock-resize-hint" aria-hidden="true">{t("sidebar.dock.resize.release")}</span>
          </div>
        )}
      </aside>
    </>
  );
};
