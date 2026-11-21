import { useCallback, useEffect, useRef, useState, type Dispatch, type MutableRefObject, type SetStateAction } from "react";
import { uiText } from "./localization/UiLanguageProvider";
import { shouldConfirmNoteDiscard } from "./readerCloseGuards";
import {
  closeReaderForeground,
  openNoteComposer,
  openShareSheet,
  openReaderPanel,
  openReaderTransient,
  setMenuSubview,
  stepBackFromMenuSubview,
  type MenuSubview,
  type NoteComposerDraft,
  type ReaderForeground,
  type ReaderPanelId,
  type ShareDraft,
} from "./readerForeground";
import type { ReaderHandle } from "./ReaderView";
import type { SidebarMode, SidebarTab } from "./SidebarDrawer";
import { createSidebarNavigationMemory, type SidebarNavigationMemory } from "./sidebarSwipe";
import { DOCK_DEFAULT_WIDTH, clampDockWidth, resolveDockNarrowState } from "./sidebarDock";

/** Kept separate from commands so App retains its state/effect ordering. */
export function useReaderForegroundState() {
  return useState<ReaderForeground>({ kind: "none" });
}

export function readerForegroundSurfaces(foreground: ReaderForeground) {
  // All reader-facing surfaces share one discriminated state. These values
  // are deliberately derived, never independently writable booleans.
  const menuOpen = foreground.kind === "panel" && foreground.panel === "menu";
  const fontSettingsOpen = foreground.kind === "panel" && foreground.panel === "menu" && foreground.view === "fonts";
  const displaySettingsOpen = foreground.kind === "panel" && foreground.panel === "menu" && foreground.view === "extras";
  const moreSettingsOpen = foreground.kind === "panel" && foreground.panel === "menu" && foreground.view === "more";
  const tocOpen = foreground.kind === "panel" && foreground.panel === "toc";
  const bookmarkMenuOpen = foreground.kind === "panel" && foreground.panel === "bookmarks";
  const searchOpen = foreground.kind === "panel" && foreground.panel === "search";
  const notesOpen = foreground.kind === "panel" && foreground.panel === "notes";
  const logOpen = foreground.kind === "panel" && foreground.panel === "log";
  const assistantOpen = foreground.kind === "panel" && foreground.panel === "assistant";
  const readingSettingsOpen = foreground.kind === "panel" && foreground.panel === "reading";

  const selectionContext = foreground.kind === "transient" && foreground.transient === "selection"
    ? foreground.payload
    : null;
  const footnote = foreground.kind === "transient" && foreground.transient === "footnote"
    ? foreground.payload
    : null;
  const noteComposer = foreground.kind === "modal" && foreground.modal === "note-composer"
    ? foreground.draft
    : null;
  const shareDraft = foreground.kind === "modal" && foreground.modal === "share"
    ? foreground.draft
    : null;

  return {
    menuOpen, fontSettingsOpen, displaySettingsOpen, moreSettingsOpen, tocOpen, bookmarkMenuOpen,
    searchOpen, notesOpen, logOpen, assistantOpen, readingSettingsOpen,
    selectionContext, footnote, noteComposer, shareDraft,
  };
}

interface ForegroundWiring {
  foregroundRef: MutableRefObject<ReaderForeground>;
  setForeground: Dispatch<SetStateAction<ReaderForeground>>;
  overlayHoverRef: MutableRefObject<boolean>;
  /** App creates this reader ref later in the render; resolve it only on input. */
  reader(): Pick<ReaderHandle, "dismissFootnote" | "clearTextSelection"> | null;
  /** The note domain owns its edit lease; it runs before foreground cleanup. */
  beforeOpenComposer(draft: NoteComposerDraft): void;
  noteComposerDirtyRef: MutableRefObject<boolean>;
}

/**
 * Host functions read mount-stable refs, including the reader created later by App.
 * Keep the original callback dependencies and functional-update ordering.
 */
export function useReaderForeground({
  foregroundRef, setForeground, overlayHoverRef, reader, beforeOpenComposer, noteComposerDirtyRef,
}: ForegroundWiring) {
  const openPanel = useCallback((panel: ReaderPanelId): void => {
    const current = foregroundRef.current;
    if (current.kind === "transient" && current.transient === "footnote") {
      overlayHoverRef.current = false;
      reader()?.dismissFootnote();
    } else if (current.kind === "transient" && current.transient === "selection") {
      reader()?.clearTextSelection();
    }
    setForeground((current) => openReaderPanel(current, panel));
  }, []);
  const openTransient = useCallback(
    (transient: "selection" | "footnote", payload: Parameters<typeof openReaderTransient>[2]): void => {
      const current = foregroundRef.current;
      if (current.kind === "transient" && current.transient === "footnote" && transient === "selection") {
        overlayHoverRef.current = false;
        reader()?.dismissFootnote();
      } else if (current.kind === "transient" && current.transient === "selection" && transient === "footnote") {
        reader()?.clearTextSelection();
      }
      setForeground((state) => openReaderTransient(state, transient, payload));
    },
  []);
  const openComposer = useCallback((draft: NoteComposerDraft): void => {
    beforeOpenComposer(draft);
    const current = foregroundRef.current;
    if (current.kind === "transient" && current.transient === "footnote") {
      overlayHoverRef.current = false;
      reader()?.dismissFootnote();
    } else if (current.kind === "transient" && current.transient === "selection") {
      reader()?.clearTextSelection();
    }
    setForeground((state) => openNoteComposer(state, draft));
  }, []);
  const openShare = useCallback((draft: ShareDraft): void => {
    const current = foregroundRef.current;
    if (current.kind === "transient" && current.transient === "footnote") {
      overlayHoverRef.current = false;
      reader()?.dismissFootnote();
    } else if (current.kind === "transient" && current.transient === "selection") {
      reader()?.clearTextSelection();
    }
    setForeground((state) => openShareSheet(state, draft));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount-stable refs, same contract as openComposer
  }, []);
  const closePanel = useCallback((panel: ReaderPanelId): void => {
    setForeground((current) =>
      current.kind === "panel" && current.panel === panel ? closeReaderForeground() : current
    );
  }, []);
  const closeForeground = useCallback((): void => {
    setForeground(closeReaderForeground());
    overlayHoverRef.current = false;
    reader()?.dismissFootnote();
  }, []);

  /** 统一前景关闭入口：笔记未保存时确认放弃，其他层直接关闭。 */
  const requestCloseForeground = useCallback((): void => {
    const current = foregroundRef.current;
    if (shouldConfirmNoteDiscard(current, noteComposerDirtyRef.current)) {
      if (typeof window !== "undefined" && !window.confirm(uiText("notice.discardNote"))) return;
    }
    closeForeground();
  }, [closeForeground]);

  const showMenuSubview = useCallback((view: MenuSubview): void => {
    setForeground((current) => setMenuSubview(current, view));
  }, []);

  return { openPanel, openTransient, openComposer, openShare, closePanel, closeForeground, requestCloseForeground, showMenuSubview };
}

interface SidebarWiring {
  foreground: ReaderForeground;
  foregroundRef: MutableRefObject<ReaderForeground>;
  setForeground: Dispatch<SetStateAction<ReaderForeground>>;
  view: "shelf" | "reader";
  canDock: boolean;
  mobileChrome: boolean;
  sidebarBookKey: string;
  /** Settled window width used for auto-collapse; pointer dragging reads window.innerWidth directly. */
  viewportWidth?: number;
  /** Current published paginator state; undefined while the chapter is loading. */
  effectiveColumns?: 1 | 2;
  readingMode?: "paginated" | "scroll";
  readingTransient?: boolean;
  fixedLayout?: boolean;
  /** A pointer drag owns the width; never auto-collapse under the pointer. */
  resizing?: boolean;
  openPanel(panel: ReaderPanelId): void;
  closeForeground(): void;
  requestCloseForeground(): void;
}

/** Sidebar preferences and per-book scroll memories remain local to this App mount. */
export function useReaderSidebar({
  foreground, foregroundRef, setForeground, view, canDock, mobileChrome, sidebarBookKey,
  viewportWidth = 1024, effectiveColumns, readingMode = "paginated", readingTransient = false,
  fixedLayout = false, resizing = false,
  openPanel, closeForeground, requestCloseForeground,
}: SidebarWiring) {
  const [sidebarTab, setSidebarTab] = useState<SidebarTab>("toc");
  const [sidebarSide, setSidebarSide] = useState<"left" | "right">("left");
  const [sidebarMode, setSidebarMode] = useState<SidebarMode>("overlay");
  const [sidebarPinned, setSidebarPinned] = useState(false);
  const [sidebarWidth, setSidebarWidthState] = useState(DOCK_DEFAULT_WIDTH);
  const [autoCollapsed, setAutoCollapsed] = useState(false);
  const [autoCollapsePending, setAutoCollapsePending] = useState(false);
  const [restoreLock, setRestoreLock] = useState(false);
  const [autoCollapseSuppressed, setAutoCollapseSuppressed] = useState(false);
  const suppressedAtWidthRef = useRef(viewportWidth);
  const [dockExiting, setDockExiting] = useState(false);
  const dockExitTimerRef = useRef<number | undefined>(undefined);

  // 竖屏与紧凑窗口使用浮窗，保留固定偏好以便回到横屏时恢复。
  const sidebarNavigationMemories = useRef(new Map<string, SidebarNavigationMemory>());
  let sidebarNavigationMemory = sidebarNavigationMemories.current.get(sidebarBookKey);
  if (!sidebarNavigationMemory) {
    sidebarNavigationMemory = createSidebarNavigationMemory();
    sidebarNavigationMemories.current.set(sidebarBookKey, sidebarNavigationMemory);
  }

  const effectiveSidebarMode: SidebarMode = canDock ? sidebarMode : "overlay";
  const dockWidth = clampDockWidth(sidebarWidth);

  const isSidebarOpen =
    view === "reader" &&
    ((effectiveSidebarMode === "docked" && sidebarPinned && !autoCollapsed) ||
      (foreground.kind === "panel" &&
        (foreground.panel === "toc" || foreground.panel === "bookmarks" || foreground.panel === "notes")));

  const activeSidebarTab: SidebarTab = (() => {
    if (foreground.kind === "panel") {
      if (foreground.panel === "toc") return "toc";
      if (foreground.panel === "bookmarks") return "bookmarks";
      if (foreground.panel === "notes") return "notes";
    }
    return sidebarTab;
  })();

  const isDockedSidebar = view === "reader" && effectiveSidebarMode === "docked" && sidebarPinned;
  const isDockedSidebarVisible = isDockedSidebar && !autoCollapsed;
  // 桌面正文搜索停靠右侧时正文让出位置（宽窗由 CSS 决定），结果和正文同时可见。
  const isDockedSearch = view === "reader" && !mobileChrome && foreground.kind === "panel" && foreground.panel === "search";
  const singlePageLock = isDockedSidebar && (autoCollapsed || autoCollapsePending || restoreLock);

  const clearAutoCollapse = useCallback(() => {
    window.clearTimeout(dockExitTimerRef.current);
    dockExitTimerRef.current = undefined;
    setAutoCollapsed(false);
    setAutoCollapsePending(false);
    setRestoreLock(false);
    setAutoCollapseSuppressed(false);
    setDockExiting(false);
  }, []);

  useEffect(() => () => window.clearTimeout(dockExitTimerRef.current), []);

  // An explicit pin in an already-narrow window is respected until the window
  // changes size; otherwise it would collapse again under the user's hand.
  const suppressAutoCollapse = useCallback(() => {
    suppressedAtWidthRef.current = viewportWidth;
    setAutoCollapsePending(false);
    setAutoCollapseSuppressed(true);
  }, [viewportWidth]);

  useEffect(() => {
    if (autoCollapseSuppressed && viewportWidth !== suppressedAtWidthRef.current) {
      setAutoCollapseSuppressed(false);
    }
  }, [viewportWidth, autoCollapseSuppressed]);

  const setSidebarWidth = useCallback((width: number) => {
    setSidebarWidthState(clampDockWidth(width));
  }, []);

  // Leaving the docked/reader surface abandons a temporary narrow-window state.
  useEffect(() => {
    if (view !== "reader" || !isDockedSidebar) clearAutoCollapse();
  }, [view, isDockedSidebar, clearAutoCollapse]);

  // A settled narrow window asks for a single-page reflow before the drawer moves.
  useEffect(() => {
    if (view !== "reader" || !isDockedSidebar || !canDock || resizing || autoCollapseSuppressed ||
      autoCollapsed || autoCollapsePending || restoreLock) return;
    if (resolveDockNarrowState({ windowWidth: viewportWidth, dockWidth, collapsed: false }) === "collapse") {
      setAutoCollapsePending(true);
    }
  }, [viewportWidth, dockWidth, view, isDockedSidebar, canDock, resizing, autoCollapseSuppressed,
    autoCollapsed, autoCollapsePending, restoreLock]);

  // Wait for the forced single-page layout to be published before sliding out.
  useEffect(() => {
    if (!autoCollapsePending || resizing) return;
    if (resolveDockNarrowState({ windowWidth: viewportWidth, dockWidth, collapsed: false }) !== "collapse") {
      setAutoCollapsePending(false);
      return;
    }
    const single = readingMode === "scroll" || fixedLayout || (effectiveColumns === 1 && !readingTransient);
    if (!single) return;
    setAutoCollapsePending(false);
    setAutoCollapsed(true);
    setRestoreLock(false);
  }, [autoCollapsePending, resizing, viewportWidth, dockWidth, readingMode, fixedLayout, effectiveColumns, readingTransient]);

  // Restore only from the window and preferred width, never from the released full width.
  useEffect(() => {
    if (view !== "reader" || !isDockedSidebar || !canDock || !autoCollapsed || dockExiting) return;
    if (resolveDockNarrowState({ windowWidth: viewportWidth, dockWidth, collapsed: true }) === "restore") {
      setAutoCollapsed(false);
      setRestoreLock(true);
    }
  }, [viewportWidth, dockWidth, view, isDockedSidebar, canDock, autoCollapsed, dockExiting]);


  // The dock viewport releases its frozen page after the margin transition.
  const finishDockRestore = useCallback(() => setRestoreLock(false), []);
  useEffect(() => {
    if (!restoreLock) return;
    const timer = window.setTimeout(() => setRestoreLock(false), 800);
    return () => window.clearTimeout(timer);
  }, [restoreLock]);

  const handleSidebarTabChange = useCallback((tab: SidebarTab) => {
    setSidebarTab(tab);
    if (effectiveSidebarMode === "overlay") {
      openPanel(tab);
    }
  }, [effectiveSidebarMode, openPanel]);

  const handleSidebarModeChange = useCallback((mode: SidebarMode) => {
    clearAutoCollapse();
    setSidebarMode(mode);
    if (mode === "docked") {
      suppressAutoCollapse();
      setSidebarTab(activeSidebarTab);
      setSidebarPinned(true);
      if (
        foregroundRef.current.kind === "panel" &&
        (foregroundRef.current.panel === "toc" ||
          foregroundRef.current.panel === "bookmarks" ||
          foregroundRef.current.panel === "notes")
      ) {
        closeForeground();
      }
    } else {
      setSidebarPinned(false);
      openPanel(sidebarTab);
    }
  }, [activeSidebarTab, sidebarTab, openPanel, closeForeground, foregroundRef, clearAutoCollapse, suppressAutoCollapse]);

  const handleSidebarClose = useCallback(() => {
    clearAutoCollapse();
    if (canDock && sidebarMode === "docked") {
      setSidebarPinned(false);
    }
    closeForeground();
  }, [closeForeground, canDock, sidebarMode, clearAutoCollapse]);

  /** A drag past the arm line slides the dock out, then releases the pin. */
  const requestDockCollapse = useCallback(() => {
    if (!isDockedSidebar) {
      handleSidebarClose();
      return;
    }
    window.clearTimeout(dockExitTimerRef.current);
    setAutoCollapsePending(false);
    setAutoCollapsed(true);
    setDockExiting(true);
    dockExitTimerRef.current = window.setTimeout(() => {
      dockExitTimerRef.current = undefined;
      setDockExiting(false);
      setSidebarPinned(false);
      setAutoCollapsed(false);
      closeForeground();
    }, 320);
  }, [isDockedSidebar, handleSidebarClose, closeForeground]);

  /** 键盘/返回键关闭当前可见层；模态（笔记、分享）先关，笔记先走统一 dirty 确认。 */
  const requestCloseCurrentSurface = useCallback((): void => {
    const current = foregroundRef.current;
    if (current.kind === "modal") {
      requestCloseForeground();
      return;
    }
    // Back/Esc on an Aa sub-page returns to the Aa main page; only there does it close Aa.
    const stepped = stepBackFromMenuSubview(current);
    if (stepped) {
      setForeground(stepped);
      return;
    }
    if (isSidebarOpen) {
      handleSidebarClose();
      return;
    }
    requestCloseForeground();
  }, [handleSidebarClose, isSidebarOpen, requestCloseForeground]);

  const handleToggleSidebar = useCallback((side?: "left" | "right") => {
    const targetSide = side || "left";
    // A manual recall while the dock is auto-collapsed opens the overlay, so it
    // never occupies the text column that the narrow window cannot afford.
    if (autoCollapsed) {
      clearAutoCollapse();
      setSidebarSide(targetSide);
      setSidebarPinned(false);
      setSidebarMode("overlay");
      openPanel(sidebarTab);
      return;
    }
    if (isSidebarOpen && sidebarSide === targetSide) {
      handleSidebarClose();
    } else {
      setSidebarSide(targetSide);
      if (effectiveSidebarMode === "docked") {
        suppressAutoCollapse();
        setSidebarPinned(true);
      } else {
        openPanel(sidebarTab);
      }
    }
  }, [autoCollapsed, clearAutoCollapse, isSidebarOpen, sidebarSide, handleSidebarClose, effectiveSidebarMode,
    sidebarTab, openPanel, suppressAutoCollapse]);

  const handleOpenBookmarks = useCallback(() => {
    if (autoCollapsed) {
      clearAutoCollapse();
      setSidebarSide("right");
      setSidebarTab("bookmarks");
      setSidebarPinned(false);
      setSidebarMode("overlay");
      openPanel("bookmarks");
      return;
    }
    setSidebarSide("right");
    setSidebarTab("bookmarks");
    if (effectiveSidebarMode === "docked") {
      suppressAutoCollapse();
      setSidebarPinned(true);
    } else {
      openPanel("bookmarks");
    }
  }, [autoCollapsed, clearAutoCollapse, effectiveSidebarMode, openPanel, suppressAutoCollapse]);

  return {
    sidebarSide, sidebarNavigationMemory, effectiveSidebarMode,
    isSidebarOpen, activeSidebarTab, isDockedSidebar, isDockedSidebarVisible, isDockedSearch,
    sidebarWidth: dockWidth, setSidebarWidth, autoCollapsed, singlePageLock,
    finishDockRestore, requestDockCollapse,
    handleSidebarTabChange, handleSidebarModeChange, handleSidebarClose,
    requestCloseCurrentSurface, handleToggleSidebar, handleOpenBookmarks,
  };
}
