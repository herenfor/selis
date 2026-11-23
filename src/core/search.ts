import { ChapterTextCache, compileBookQuery, mayMatchChapter } from "./searchChapterText";
import type { ScannedChapter } from "./readerSearchSource";
import { spineItemPath } from "./book";
import { splitHref } from "./paths";
import {
  buildDocument,
  extractSearchText,
  extractSearchTextSegments,
  extractVisibleText,
  normalizeQueryPart,
  type SearchTextSegment,
} from "./corpus";
import type { Book, TocNode } from "./types";
import type { ExactTextHit } from "./exactTextHits";
import type { SearchOccurrence } from "./searchOccurrence";

import { startReaderQuery, type ReaderSearchQuery, type ReaderQueryOptions } from "./readerSearchQuery";
export type { ReaderSearchQuery, ReaderQuerySnapshot, ReaderQueryOptions } from "./readerSearchQuery";
export type { SearchPreview } from "./searchMatches";
import { scanChapterRanges, matchesForDocument, projectedMatches, type ProjectedDocuments } from "./searchMatches";

function decodeBytes(data: Uint8Array): string {
  if (data.length >= 2) {
    if (data[0] === 0xff && data[1] === 0xfe) return new TextDecoder("utf-16le").decode(data.slice(2));
    if (data[0] === 0xfe && data[1] === 0xff) return new TextDecoder("utf-16be").decode(data.slice(2));
  }
  return new TextDecoder("utf-8").decode(data);
}

export interface SearchProgress {
  completed: number;
  total: number;
  spineIndex: number;
}

export interface SearchBookOptions {
  /**
   * Chapter source. `undefined` means "not available right now" and is never
   * cached; a thrown error means the read failed and fails the query.
   */
  textFor?: (path: string, signal?: AbortSignal) => string | undefined | Promise<string | undefined>;
  /** Alternative injected source; textFor takes precedence. */
  resourceServer?: {
    textFor(path: string): string | undefined;
    /** On-demand read for archives that decompress chapters lazily. */
    readTextFor?(path: string, signal?: AbortSignal): Promise<string>;
  };
  signal?: AbortSignal;
  maxResults?: number;
  /** Reader only: continue preparing chapter text after delivering a limited result set. */
  warmAfterLimit?: boolean;
  onProgress?: (progress: SearchProgress) => void;
  /** An explicit scheduler runs after each chapter; the default yields by elapsed time. */
  yieldToHost?: () => Promise<void>;
  /** When present, searches projected display text while retaining canonical original hits. */
  projection?: SearchProjection;
}

export type SearchQueryOptions = Pick<SearchBookOptions, "signal" | "maxResults" | "onProgress" | "yieldToHost">;

/**
 * Optional display-projection adapter. The core stays independent of render/UI
 * modules: callers provide the compiled projection and the raw-range inverse.
 */
export interface ProjectedSearchChapter {
  /** Projected visible text for one chapter. */
  readonly text: string;
  /** Map a raw UTF-16 range in `text` back to the chapter's source text. */
  toSourceRawRange(start: number, end: number): { start: number; end: number } | null;
}

export interface SearchProjection {
  /** Stable identity for display index caches. */
  readonly version: string;
  /** Build one immutable chapter snapshot. All hits in that chapter share it. */
  projectChapter(sourceText: string, segments: readonly SearchTextSegment[]): ProjectedSearchChapter;
}

export interface SearchSession {
  search(query: string, options?: SearchQueryOptions): Promise<SearchResult[]>;
  dispose(): void;
}

export interface ReaderSearchSession extends SearchSession {
  startQuery(query: string, options?: ReaderQueryOptions): ReaderSearchQuery;
}

export interface DisplaySearchTarget {
  /** Projection snapshot identity that produced `textHits`/`occurrence`. */
  projectionVersion: string;
  /** Display-only exact hits in projected text; never used as a canonical locator. */
  textHits: ExactTextHit[];
  /** Display-only context identity for robust re-resolution in the live DOM. */
  occurrence: SearchOccurrence;
}

export interface SearchDisplayHit extends DisplaySearchTarget {
  /** Raw UTF-16 range in projected extracted text. */
  range: { start: number; end: number };
  /** Display matched text with block separators rendered as newlines. */
  matchedText: string;
}

export interface SearchResult {
  spineIndex: number;
  chapterPath: string;
  chapterTitle: string;
  /** Original extracted visible text, or projected display text for display search. */
  snippet: string;
  /** UTF-16 ranges relative to snippet; one range for phrase, one per keyword. */
  snippetMatchRanges: Array<{ start: number; end: number }>;
  /**
   * Canonical range in the original extracted text, measured in UTF-16 code
   * units. For display search this is the source range chosen by the fragment
   * bias rules, not a reverse lookup of the query keyword.
   */
  originalRange: { start: number; end: number };
  /** Existing paginator text-anchor coordinate: original code points, whitespace removed. */
  textOffset: number;
  textSnippet: string;
  /** The matched text in the searched view; block separators rendered as newlines. */
  matchedText: string;
  /** Runtime-only exact body ranges; never persisted to the corpus database. */
  textHits?: ExactTextHit[];
  /** Runtime-only exact identity context for new search navigation. */
  occurrence?: SearchOccurrence;
  /** Present only for display-projected search. */
  display?: SearchDisplayHit;
  matchType: "phrase" | "keywords";
}

function abortIfNeeded(signal?: AbortSignal): void {
  if (!signal?.aborted) return;
  const error = new Error("搜索已取消");
  error.name = "AbortError";
  throw error;
}

function defaultYield(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function titleFor(book: Book, path: string): string {
  const target = book.archiveReferences ? path : splitHref(path).path;
  const visit = (nodes: TocNode[]): string | undefined => {
    for (const node of nodes) {
      if ((book.archiveReferences ? book.archiveReferences.resolve(book.opfPath, node.href).path : splitHref(node.href).path) === target && node.label.trim()) return node.label.trim();
      const nested = visit(node.children);
      if (nested) return nested;
    }
    return undefined;
  };
  const found = visit(book.toc);
  if (found) return found;
  const base = target.split("/").pop() ?? target;
  return base.replace(/\.[^.]+$/, "") || target;
}

/**
 * Read chapters on demand. Plain text is cached within a memory budget, while
 * projected chapters retain the coordinate maps needed by display search.
 */
export function createSearchSession(book: Book, options: SearchBookOptions = {}): ReaderSearchSession {
  const server = options.resourceServer;
  const textFor = options.textFor
    ?? (server
      ? (server.readTextFor
        ? (path: string, signal?: AbortSignal) => server.readTextFor!(path, signal)
        : (path: string) => server.textFor(path))
      : undefined)
    ?? ((path: string) => {
      const resource = book.resources.get(path);
      return resource ? decodeBytes(resource.data) : undefined;
    });
  const linear = book.spine.map((item, index) => ({ item, index })).filter(({ item }) => item.linear);
  const cache = new Map<number, ProjectedDocuments>();
  const plain = new ChapterTextCache();
  const projection = options.projection;
  let disposed = false;
  let warmJob: AbortController | undefined;
  let queryEpoch = 0;
  async function plainChapter(index: number, path: string, signal?: AbortSignal) {
    const cached = plain.get(index);
    if (cached) return cached;
    const source = await textFor(path, signal);
    abortIfNeeded(signal);
    if (source === undefined) return undefined;
    const visible = await extractSearchText(source);
    abortIfNeeded(signal);
    if (disposed) throw new DOMException("搜索会话已释放", "AbortError");
    return plain.remember(index, visible);
  }

  async function projectedChapter(index: number, path: string, signal?: AbortSignal) {
    const cached = cache.get(index);
    if (cached) return cached;
    const source = await textFor(path, signal);
    abortIfNeeded(signal);
    if (source === undefined || !projection) return undefined;
    const { text, segments } = await extractSearchTextSegments(source);
    abortIfNeeded(signal);
    if (disposed) throw new DOMException("搜索会话已释放", "AbortError");
    const sourceDoc = buildDocument(text);
    const projected = projection.projectChapter(text, segments);
    const chapter = { source: sourceDoc, display: projected.text === text ? sourceDoc : buildDocument(projected.text), projected };
    cache.set(index, chapter);
    return chapter;
  }

  function nativeFor(compiled: ReturnType<typeof compileBookQuery>) {
    return !projection && !options.textFor && compiled.phrase.length <= 4096 && compiled.tokens.length <= 128 && !compiled.phrase.includes("\0")
      ? book.scanChapters : undefined;
  }
  let readerQuery: ReaderSearchQuery | undefined;
  let readerChapters: { index: number; path: string }[] | undefined;
  function warmRemaining(start: number, native: typeof book.scanChapters) {
    if (start >= linear.length || disposed) return;
    const controller = new AbortController();
    warmJob = controller;
    const signal = controller.signal;
    const run = async () => {
      for (let pos = start; pos < linear.length; pos += 16) {
        await new Promise(resolve => setTimeout(resolve, 16));
        abortIfNeeded(signal);
        const items = linear.slice(pos, pos + 16);
        const paths = items.map(({ index }) => spineItemPath(book, index) ?? "");
        const rows = await native?.(paths, "", [], signal);
        for (let i = 0; i < items.length; i++) {
          abortIfNeeded(signal);
          if (paths[i] && (!rows || rows[i].kind === "compatibility")) await plainChapter(items[i].index, paths[i], signal);
        }
      }
    };
    // A foreground read will retry any missing chapter and report actual read errors.
    void run().catch(() => undefined).finally(() => { if (warmJob === controller) warmJob = undefined; });
  }
  return {
    startQuery(query, queryOptions = {}) {
      if (disposed) throw new Error("搜索会话已释放");
      readerQuery?.cancel();
      warmJob?.abort();
      queryEpoch++;
      readerChapters ??= linear.map(({ index }) => ({ index, path: spineItemPath(book, index) ?? "" }));
      const compiled = compileBookQuery(query);
      const schedule = options.yieldToHost ?? defaultYield;
      readerQuery = startReaderQuery({
        chapters: readerChapters,
        native: nativeFor(compiled),
        identity: ({ index, path }) => ({ spineIndex: index, chapterPath: path, chapterTitle: titleFor(book, path) }),
        yieldToHost: schedule,
        async compatible({ index, path }, terms, signal) {
          if (!path) throw new Error(`无法定位书内搜索章节 ${index + 1}`);
          if (projection) {
            const docs = await projectedChapter(index, path, signal);
            if (!docs) throw new Error(`无法读取搜索章节 ${path}`);
            return { source: docs.source.text, display: docs.display.text, version: projection.version,
              hits: await scanChapterRanges(docs.display, terms, docs, signal, schedule) };
          }
          const entry = await plainChapter(index, path, signal);
          if (!entry) throw new Error(`无法读取搜索章节 ${path}`);
          return { source: entry.text, display: entry.text,
            hits: mayMatchChapter(entry.normalized, terms) ? await scanChapterRanges(buildDocument(entry.text), terms, undefined, signal, schedule) : [] };
        },
      }, compiled, { ...queryOptions, signal: queryOptions.signal ?? options.signal });
      return readerQuery;
    },
    async search(query, queryOptions = {}): Promise<SearchResult[]> {
      if (disposed) throw new Error("搜索会话已释放");
      warmJob?.abort();
      const epoch = ++queryEpoch;
      const maxResults = Math.max(0, Math.floor(queryOptions.maxResults ?? options.maxResults ?? 100));
      if (maxResults === 0) return [];
      const signal = queryOptions.signal ?? options.signal;
      const onProgress = queryOptions.onProgress ?? options.onProgress;
      const yieldToHost = queryOptions.yieldToHost ?? options.yieldToHost ?? defaultYield;
      const results: SearchResult[] = [];
      const compiled = compileBookQuery(query);
      if (!compiled.phrase) return results;
      const nativeScan = nativeFor(compiled);
      let batch: ScannedChapter[] = [];
      let batchStart = 0;
      let lastYield = performance.now();
      for (let completed = 0; completed < linear.length; completed++) {
        abortIfNeeded(signal);
        const { index } = linear[completed];
        const path = spineItemPath(book, index);
        if (disposed) throw new DOMException("搜索会话已释放", "AbortError");
        if (nativeScan && completed >= batchStart + batch.length) {
          batchStart = completed;
          const paths = linear.slice(completed, completed + 32).map(item => spineItemPath(book, item.index) ?? "");
          batch = await nativeScan(paths, compiled.phrase, compiled.tokens, signal);
          abortIfNeeded(signal);
          if (disposed) throw new DOMException("搜索会话已释放", "AbortError");
        }
        const row = batch[completed - batchStart];
        if (path && !projection && row?.kind !== "miss") {
          let text: string | undefined;
          if (row?.kind === "match") text = row.text;
          else {
            const entry = await plainChapter(index, path, signal);
            if (entry && mayMatchChapter(entry.normalized, compiled)) text = entry.text;
          }
          if (text !== undefined) {
            const doc = buildDocument(text);
            const found = matchesForDocument(doc, compiled, index, path, titleFor(book, path), maxResults - results.length,
              row?.kind === "match" ? row.starts ?? undefined : undefined);
            for (const hit of found) results.push(hit);
          }
        } else if (path && projection) {
          const chapter = await projectedChapter(index, path, signal);
          if (chapter) {
            const found = projectedMatches(chapter, compiled, index, path, titleFor(book, path), projection.version, maxResults - results.length);
            for (const hit of found) results.push(hit);
          }
        }
        onProgress?.({ completed: completed + 1, total: linear.length, spineIndex: index });
        if (results.length >= maxResults) {
          if (options.warmAfterLimit && !projection && epoch === queryEpoch) warmRemaining(completed + 1, nativeScan);
          return results;
        }
        if (queryOptions.yieldToHost || options.yieldToHost || performance.now() - lastYield >= 8) {
          await yieldToHost(); lastYield = performance.now();
        }
      }
      return results;
    },
    dispose(): void {
      disposed = true;
      readerQuery?.cancel();
      warmJob?.abort();
      cache.clear();
      plain.clear();
    },
  };
}

/** One-shot compatibility wrapper; callers with repeated queries should retain a session. */
export async function searchBook(book: Book, query: string, options: SearchBookOptions = {}): Promise<SearchResult[]> {
  const session = createSearchSession(book, options);
  try {
    return await session.search(query, options);
  } finally {
    session.dispose();
  }
}

export { extractSearchText, extractVisibleText, buildDocument, normalizeQueryPart };
export type { SearchDocument } from "./corpus";
