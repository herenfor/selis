import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { SearchResult } from "../core/search";
import type { SearchPanelProps, SearchStatus } from "./SearchPanel";
import { SEARCH_RESULT_ROW_HEIGHT } from "./SearchPanel";
import { uiText } from "./localization/UiLanguageProvider";
import type { SearchNavigationOutcome } from "./useReaderNavigation";

/**
 * Owns the reader-side search actions that must not live in App: result
 * navigation, the waiting hint and the panel's windowed data. App only wires
 * the returned props into the panel and the navigation bar.
 */
export interface ReaderSearchControllerOptions {
  searchQuery: string;
  setSearchQuery(value: string): void;
  searchView: "display" | "original";
  /** Only a book with an active text projection has a meaningful original/display choice. */
  searchOriginsAvailable: boolean;
  handleSearchViewChange(view: "display" | "original"): void;
  searchStatus: SearchStatus;
  searchCount: number;
  searchProgress: { processed: number; total: number };
  searchError?: string;
  searchCurrentIndex: number | null;
  setSearchCurrentIndex(index: number | null): void;
  searchNavigationBusy: boolean;
  searchPanelRowAt(index: number): SearchPanelProps["results"][number] | undefined;
  ensureSearchRows(start: number, end: number): void;
  resolveSearchIndex(index: number): Promise<SearchResult | undefined>;
  handleSearchCancel(): void;
  handleSearchResume(): void;
  searchScrollTopRef: { current: number };
  onNavigate(result: SearchResult): SearchNavigationOutcome;
  openResults(): void;
  showNotice(text: string, kind?: "ok" | "warn" | "error"): void;
  /** Filled with the cross-chapter settle handler for the chapter callbacks. */
  settleRef: { current: ((requestId: number, located: boolean) => void) | null };
}

export interface ReaderSearchController {
  readonly panelProps: Omit<SearchPanelProps, "closing" | "docked" | "onClose">;
  readonly barProps: {
    count: number;
    current: number | null;
    scanning: boolean;
    paused: boolean;
    busy: boolean;
    waiting: boolean;
    onPrevious(): void;
    onNext(): void;
    onBackToResults(): void;
  };
}

export function useReaderSearchController(options: ReaderSearchControllerOptions): ReaderSearchController {
  const {
    searchQuery, setSearchQuery, searchView, searchOriginsAvailable, handleSearchViewChange,
    searchStatus, searchCount,
    searchProgress, searchError, searchCurrentIndex, setSearchCurrentIndex, searchNavigationBusy,
    searchPanelRowAt, ensureSearchRows, resolveSearchIndex, handleSearchCancel, handleSearchResume,
    searchScrollTopRef, onNavigate, openResults, showNotice, settleRef,
  } = options;

  const [waiting, setWaiting] = useState(false);
  const [resolving, setResolving] = useState(false);
  const pendingRef = useRef<{ index: number; requestId: number } | null>(null);

  // Cross-chapter clicks commit their index only once the precise target settled.
  const settle = useCallback((requestId: number, located: boolean): void => {
    const pending = pendingRef.current;
    if (!pending || pending.requestId !== requestId) return;
    pendingRef.current = null;
    if (located) setSearchCurrentIndex(pending.index);
  }, [setSearchCurrentIndex]);
  useEffect(() => {
    settleRef.current = settle;
    return () => { settleRef.current = null; };
  }, [settle, settleRef]);

  // A new query (or newly published rows) invalidates the previous position.
  useEffect(() => { setWaiting(false); pendingRef.current = null; }, [searchCount, searchQuery]);

  const goToIndex = useCallback(async (index: number): Promise<void> => {
    if (index < 0) return;
    if (index >= searchCount) {
      if (searchStatus === "searching") {
        setWaiting(true);
        showNotice(uiText("search.nav.waiting"), "warn");
      } else if (searchStatus === "paused") {
        showNotice(uiText("search.status.paused"), "warn");
      }
      return;
    }
    if (resolving) return;
    setResolving(true);
    try {
      const result = await resolveSearchIndex(index);
      if (!result) return;
      const outcome = onNavigate(result);
      if (outcome.status === "committed") {
        pendingRef.current = null;
        setWaiting(false);
        setSearchCurrentIndex(index);
      } else if (outcome.status === "pending") {
        pendingRef.current = { index, requestId: outcome.requestId };
      }
    } finally {
      setResolving(false);
    }
  }, [onNavigate, resolveSearchIndex, resolving, searchCount, searchStatus, setSearchCurrentIndex,
    showNotice]);

  const openResultsAt = useCallback((): void => {
    searchScrollTopRef.current = Math.max(0, (searchCurrentIndex ?? 0) - 3) * SEARCH_RESULT_ROW_HEIGHT;
    openResults();
  }, [openResults, searchCurrentIndex, searchScrollTopRef]);

  const panelProps = useMemo<ReaderSearchController["panelProps"]>(() => ({
    query: searchQuery,
    onQueryChange: setSearchQuery,
    results: [],
    count: searchCount,
    status: searchStatus,
    processed: searchProgress.processed,
    total: searchProgress.total,
    errorMessage: searchError,
    navigationBusy: resolving || searchNavigationBusy,
    searchView,
    onSearchViewChange: searchOriginsAvailable ? handleSearchViewChange : undefined,
    onSelect: (row) => { void goToIndex(Number(row.id)); },
    onCancel: handleSearchCancel,
    onResume: handleSearchResume,
    virtual: {
      count: searchCount,
      rowAt: searchPanelRowAt,
      onRange: ensureSearchRows,
      initialScrollTop: searchScrollTopRef.current,
      onScrollTop: (top: number) => { searchScrollTopRef.current = top; },
      currentIndex: searchCurrentIndex,
    },
  }), [ensureSearchRows, goToIndex, handleSearchCancel, handleSearchResume, handleSearchViewChange,
    resolving, searchCount, searchCurrentIndex, searchError, searchNavigationBusy, searchPanelRowAt,
    searchProgress.processed, searchProgress.total, searchQuery, searchScrollTopRef, searchStatus,
    searchView, searchOriginsAvailable, setSearchQuery]);

  const barProps = useMemo<ReaderSearchController["barProps"]>(() => ({
    count: searchCount,
    current: searchCurrentIndex,
    scanning: searchStatus === "searching",
    paused: searchStatus === "paused",
    busy: resolving || searchNavigationBusy,
    waiting,
    onPrevious: () => { if (searchCurrentIndex !== null) void goToIndex(searchCurrentIndex - 1); },
    onNext: () => { void goToIndex((searchCurrentIndex ?? -1) + 1); },
    onBackToResults: openResultsAt,
  }), [goToIndex, openResultsAt, resolving, searchCount, searchCurrentIndex, searchNavigationBusy,
    searchStatus, waiting]);

  return { panelProps, barProps };
}
