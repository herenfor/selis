import { useCallback, useEffect, useRef, useState } from "react";
import type { Book } from "../core/types";
import type { ReaderQuerySnapshot, ReaderSearchQuery, ReaderSearchSession, SearchPreview, SearchResult } from "../core/search";
import type { ResourceServer } from "../render/resources";
import type { CompiledTextProjection } from "../render/textProjection/compile";
import { createTextSearchSession, type TextSearchView } from "../render/textProjection/displaySearch";
import type { SearchPanelResult, SearchStatus } from "./SearchPanel";

/** Rows fetched per window; ReaderSearchQuery caps one call at 128. */
export const SEARCH_QUERY_WINDOW = 128;
const SEARCH_QUERY_DEBOUNCE_MS = 180;

// State, refs and effects have separate call sites to preserve App's ordering.
export function useReaderSearchView() {
  const [searchView, setSearchView] = useState<TextSearchView>("display");
  return { searchView, setSearchView };
}

export function useReaderSearchState() {
  const [searchQuery, setSearchQuery] = useState("");
  const [searchStatus, setSearchStatus] = useState<SearchStatus>("idle");
  const [searchProgress, setSearchProgress] = useState({ processed: 0, total: 0 });
  /** Published hit count: grows while scanning, final only when complete. */
  const [searchCount, setSearchCount] = useState(0);
  const [searchError, setSearchError] = useState<string | undefined>(undefined);
  const [searchNavigationBusy, setSearchNavigationBusy] = useState(false);
  /** Bumped whenever a snippet window arrives so the panel re-renders. */
  const [searchRowsVersion, setSearchRowsVersion] = useState(0);
  /** Result currently shown in the reader, as an index into the published list. */
  const [searchCurrentIndex, setSearchCurrentIndex] = useState<number | null>(null);
  /** Bumped when the search session is (re)created so query effects can re-run. */
  const [searchSessionVersion, setSearchSessionVersion] = useState(0);

  return {
    searchQuery, setSearchQuery, searchStatus, setSearchStatus, searchProgress, setSearchProgress,
    searchCount, setSearchCount, searchError, setSearchError, searchNavigationBusy, setSearchNavigationBusy,
    searchRowsVersion, setSearchRowsVersion, searchCurrentIndex, setSearchCurrentIndex,
    searchSessionVersion, setSearchSessionVersion,
  };
}

export function useReaderSearchRefs() {
  const searchSessionRef = useRef<ReaderSearchSession | null>(null);
  const searchQueryHandleRef = useRef<ReaderSearchQuery | null>(null);
  const searchQueryTextRef = useRef("");
  const searchRowsRef = useRef(new Map<number, SearchPreview>());
  const searchLoadedWindowsRef = useRef(new Set<number>());
  const searchScrollTopRef = useRef(0);
  const searchGenerationRef = useRef(0);
  return {
    searchSessionRef, searchQueryHandleRef, searchQueryTextRef, searchRowsRef,
    searchLoadedWindowsRef, searchScrollTopRef, searchGenerationRef,
  };
}

type ReaderSearchState = ReturnType<typeof useReaderSearchState>;
type ReaderSearchRefs = ReturnType<typeof useReaderSearchRefs>;
type ReaderSearchContext = ReaderSearchState & ReaderSearchRefs & {
  view: "shelf" | "reader";
  book: Book | null;
  server: ResourceServer | null;
  searchView: TextSearchView;
  compiledTextProjection: CompiledTextProjection | null;
};

function phaseOf(snapshot: ReaderQuerySnapshot): SearchStatus {
  switch (snapshot.status) {
    case "scanning": return "searching";
    case "paused": return "paused";
    case "complete": return "complete";
    case "error": return "error";
    default: return "idle";
  }
}

export function useReaderSearchSession({ view, book, server, searchView, compiledTextProjection,
  searchSessionRef, searchQueryHandleRef, searchRowsRef, searchLoadedWindowsRef, searchGenerationRef,
  setSearchStatus, setSearchProgress, setSearchCount, setSearchError, setSearchRowsVersion,
  setSearchCurrentIndex, setSearchSessionVersion,
}: ReaderSearchContext) {
  // 搜索会话按“打开的一本书 + 当前视图”持有；创建本身不读取章节，首次查询才
  // 按 spine 渐进提取。换书/返回书架/切换视图时释放正文和位置映射。
  useEffect(() => {
    searchQueryHandleRef.current?.cancel();
    searchQueryHandleRef.current = null;
    searchSessionRef.current?.dispose();
    searchSessionRef.current = null;
    searchGenerationRef.current++;
    searchRowsRef.current.clear();
    searchLoadedWindowsRef.current.clear();
    setSearchCount(0);
    setSearchStatus("idle");
    setSearchProgress({ processed: 0, total: 0 });
    setSearchError(undefined);
    setSearchCurrentIndex(null);
    setSearchRowsVersion((version) => version + 1);
    if (view !== "reader" || !book || !server || book.fixedLayout) return;
    const session = createTextSearchSession(
      book,
      searchView,
      searchView === "display" ? compiledTextProjection : null,
      { resourceServer: server },
    );
    searchSessionRef.current = session;
    setSearchSessionVersion((version) => version + 1);
    return () => {
      searchQueryHandleRef.current?.cancel();
      searchQueryHandleRef.current = null;
      if (searchSessionRef.current === session) searchSessionRef.current = null;
      session.dispose();
      searchGenerationRef.current++;
    };
  }, [view, book, server, searchView, compiledTextProjection]);
}

export function useReaderSearchQuery({ searchQuery, book, searchSessionVersion,
  searchSessionRef, searchQueryHandleRef, searchQueryTextRef, searchRowsRef, searchLoadedWindowsRef,
  searchScrollTopRef, searchGenerationRef, setSearchStatus, setSearchProgress, setSearchCount, setSearchError,
  setSearchRowsVersion,
}: ReaderSearchContext) {
  // 输入变化立即作废旧查询；防抖只延迟新查询。关面板不取消：已发起的扫描可
  // 在后台完成，重开搜索直接复用同一句柄与已发布结果。
  useEffect(() => {
    const text = searchQuery.trim();
    const session = searchSessionRef.current;
    const handle = searchQueryHandleRef.current;
    if (!session || !text) {
      handle?.cancel();
      searchQueryHandleRef.current = null;
      searchQueryTextRef.current = "";
      searchGenerationRef.current++;
      searchRowsRef.current.clear();
      searchLoadedWindowsRef.current.clear();
      setSearchCount(0);
      setSearchStatus("idle");
      setSearchProgress({ processed: 0, total: 0 });
      setSearchError(undefined);
      setSearchRowsVersion((version) => version + 1);
      return;
    }
    if (handle && searchQueryTextRef.current === text) return; // 同词重开：复用快照
    if (handle) {
      handle.cancel();
      searchQueryHandleRef.current = null;
    }
    const generation = ++searchGenerationRef.current;
    const timer = window.setTimeout(() => {
      if (generation !== searchGenerationRef.current) return;
      searchRowsRef.current.clear();
      searchLoadedWindowsRef.current.clear();
      searchScrollTopRef.current = 0;
      setSearchRowsVersion((version) => version + 1);
      setSearchError(undefined);
      setSearchStatus("searching");
      setSearchProgress({
        processed: 0,
        total: book?.spine.filter((item) => item.linear).length ?? 0,
      });
      const query = session.startQuery(text, {
        onUpdate: (snapshot) => {
          if (generation !== searchGenerationRef.current) return;
          setSearchStatus(phaseOf(snapshot));
          setSearchProgress({ processed: snapshot.completed, total: snapshot.total });
          setSearchCount(snapshot.count);
          if (snapshot.status === "error") setSearchError(String(snapshot.error ?? ""));
        },
      });
      searchQueryHandleRef.current = query;
      searchQueryTextRef.current = text;
      const initial = query.snapshot();
      setSearchStatus(phaseOf(initial));
      setSearchProgress({ processed: initial.completed, total: initial.total });
      setSearchCount(initial.count);
    }, SEARCH_QUERY_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [searchQuery, searchSessionVersion, searchSessionRef, searchQueryHandleRef, searchQueryTextRef,
    searchRowsRef, searchLoadedWindowsRef, searchScrollTopRef, searchGenerationRef, setSearchStatus,
    setSearchProgress, setSearchCount, setSearchError, setSearchRowsVersion]);
}

type ReaderSearchPanelContext = Pick<ReaderSearchRefs,
  "searchRowsRef" | "searchLoadedWindowsRef" | "searchQueryHandleRef" | "searchGenerationRef"> &
  Pick<ReaderSearchState, "searchRowsVersion" | "setSearchRowsVersion" | "setSearchCurrentIndex"> &
  Pick<ReturnType<typeof useReaderSearchView>, "setSearchView">;

export function useReaderSearchPanel({ searchRowsRef, searchLoadedWindowsRef, searchQueryHandleRef,
  searchGenerationRef, searchRowsVersion, setSearchRowsVersion, setSearchView, setSearchCurrentIndex,
}: ReaderSearchPanelContext) {
  /** Loads every 128-row window that overlaps [start, end) once. */
  const ensureSearchRows = useCallback((start: number, end: number): void => {
    const handle = searchQueryHandleRef.current;
    if (!handle || end <= start) return;
    const generation = searchGenerationRef.current;
    const firstWindow = Math.max(0, Math.floor(start / SEARCH_QUERY_WINDOW));
    for (let windowIndex = firstWindow; windowIndex * SEARCH_QUERY_WINDOW < end; windowIndex++) {
      const offset = windowIndex * SEARCH_QUERY_WINDOW;
      if (searchLoadedWindowsRef.current.has(offset)) continue;
      searchLoadedWindowsRef.current.add(offset);
      void handle.window(offset, SEARCH_QUERY_WINDOW).then((rows) => {
        if (generation !== searchGenerationRef.current || searchQueryHandleRef.current !== handle) return;
        rows.forEach((row, index) => searchRowsRef.current.set(offset + index, row));
        setSearchRowsVersion((version) => version + 1);
      }).catch((error: unknown) => {
        if (generation !== searchGenerationRef.current) return;
        // Aborted windows belong to a replaced query; let a later range retry the rest.
        if ((error as Error)?.name !== "AbortError") searchLoadedWindowsRef.current.delete(offset);
      });
    }
  }, [searchQueryHandleRef, searchGenerationRef, searchLoadedWindowsRef, searchRowsRef, setSearchRowsVersion]);

  const searchPanelRowAt = useCallback((index: number): SearchPanelResult | undefined => {
    void searchRowsVersion;
    const row = searchRowsRef.current.get(index);
    if (!row) return undefined;
    return {
      id: String(index),
      chapterTitle: row.chapterTitle,
      chapterPath: row.chapterPath,
      snippet: row.snippet,
      matchRanges: row.snippetMatchRanges,
    };
  }, [searchRowsRef, searchRowsVersion]);

  const resolveSearchIndex = useCallback(async (index: number): Promise<SearchResult | undefined> => {
    const handle = searchQueryHandleRef.current;
    if (!handle) return undefined;
    const generation = searchGenerationRef.current;
    try {
      const result = await handle.resolve(index);
      if (generation !== searchGenerationRef.current || searchQueryHandleRef.current !== handle) return undefined;
      return result;
    } catch {
      return undefined;
    }
  }, [searchQueryHandleRef, searchGenerationRef]);

  const handleSearchViewChange = useCallback((view: TextSearchView) => {
    setSearchView(view);
    setSearchCurrentIndex(null);
  }, [setSearchCurrentIndex, setSearchView]);

  const handleSearchCancel = useCallback(() => {
    searchQueryHandleRef.current?.pause();
  }, [searchQueryHandleRef]);

  const handleSearchResume = useCallback(() => {
    void searchQueryHandleRef.current?.resume().catch(() => undefined);
  }, [searchQueryHandleRef]);

  return { searchPanelRowAt, ensureSearchRows, resolveSearchIndex,
    handleSearchViewChange, handleSearchCancel, handleSearchResume };
}
