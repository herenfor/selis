import type { SearchResult } from './search';
import type { ChapterIdentity, RawMatch, SearchPreview } from './searchMatches';
import { previewHit, resolveChapterHits } from './searchMatches';
import type { NativeMatch, ScanChapters, ScannedChapter } from './readerSearchSource';
import type { compileBookQuery } from './searchChapterText';

type Query = ReturnType<typeof compileBookQuery>;
export interface ChapterSource { index: number; path: string }
export interface ChapterWindow { source: string; display: string; version?: string; hits: RawMatch[] }
export interface QuerySources {
  chapters: readonly ChapterSource[];
  native?: ScanChapters;
  identity(chapter: ChapterSource): ChapterIdentity;
  compatible(chapter: ChapterSource, query: Query, signal: AbortSignal): Promise<ChapterWindow>;
  yieldToHost(): Promise<void>;
}

export interface ReaderQuerySnapshot {
  status: 'scanning' | 'paused' | 'complete' | 'error' | 'cancelled';
  /** Committed chapters form a stable prefix in reading order. Count is final only on complete. */
  completed: number;
  total: number;
  count: number;
  error?: unknown;
}
export interface ReaderQueryOptions {
  signal?: AbortSignal;
  onUpdate?(snapshot: ReaderQuerySnapshot): void;
}
export interface ReaderSearchQuery {
  snapshot(): ReaderQuerySnapshot;
  /** Settles with the terminal or paused snapshot of the current run, including errors. */
  readonly finished: Promise<ReaderQuerySnapshot>;
  /** Zero-based within this query. Up to 128 already published rows per call. */
  window(offset: number, limit: number): Promise<SearchPreview[]>;
  resolve(index: number): Promise<SearchResult | undefined>;
  pause(): void;
  resume(): Promise<ReaderQuerySnapshot>;
  cancel(): void;
}

interface FoundChapter { chapter: ChapterSource; first: number; count: number; native: boolean }
const aborted = () => new DOMException('搜索已取消', 'AbortError');

function nativePreview(id: ChapterIdentity, hit: NativeMatch): SearchPreview {
  let text = '';
  for (let k = 0; k < hit.context.length; k += 4096) text += String.fromCharCode(...hit.context.slice(k, k + 4096));
  const base = Math.max(0, Math.min(...hit.ranges.map(r => r[0])) - 48);
  return previewHit(id, text, { matchType: hit.keywords ? 'keywords' : 'phrase',
    ranges: hit.ranges.map(([start, end]) => ({ start: start - base, end: end - base })) });
}

export function startReaderQuery(sources: QuerySources, query: Query, options: ReaderQueryOptions): ReaderSearchQuery {
  const found: FoundChapter[] = [];
  const lifetime = new AbortController();
  let state: ReaderQuerySnapshot = { status: 'paused', completed: 0, total: sources.chapters.length, count: 0 };
  let run: AbortController | undefined;
  let settleRun: ((snapshot: ReaderQuerySnapshot) => void) | undefined;
  let finished = Promise.resolve(state);
  let lastLocal: { chapter: ChapterSource; data: ChapterWindow } | undefined;
  let selectedChapter: { chapter: ChapterSource; resolve: ReturnType<typeof resolveChapterHits> } | undefined;

  function publish() { options.onUpdate?.({ ...state }); }
  function ensure(signal: AbortSignal) { if (signal.aborted || lifetime.signal.aborted) throw aborted(); }
  async function compatible(chapter: ChapterSource, signal: AbortSignal) {
    if (lastLocal?.chapter === chapter) return lastLocal.data;
    const data = await sources.compatible(chapter, query, signal);
    ensure(signal);
    lastLocal = { chapter, data };
    return data;
  }
  async function scan(signal: AbortSignal) {
    let lastUpdate = performance.now();
    let lastYield = lastUpdate;
    try {
      while (query.phrase && state.completed < sources.chapters.length) {
        ensure(signal);
        const start = state.completed;
        // Give the first chapter a chance to publish before the rest of the first native batch.
        const batch = sources.chapters.slice(start, start + (start === 0 ? 1 : 32));
        let counts: ScannedChapter[] | undefined;
        if (sources.native) {
          try {
            counts = await sources.native(batch.map(c => c.path), query.phrase, query.tokens, signal, { mode: 'count' });
          } catch (error) {
            ensure(signal);
            if (batch.length === 1) throw error;
            // Isolate a failed entry so earlier chapters can still be published and retried in order.
            batch.splice(1);
            counts = await sources.native([batch[0].path], query.phrase, query.tokens, signal, { mode: 'count' });
          }
        }
        for (const [i, chapter] of batch.entries()) {
          ensure(signal);
          const row = counts?.[i];
          const native = row?.kind === 'count';
          if (counts && !native && row?.kind !== 'compatibility') throw new Error('书内搜索计数回复无效');
          const count = native ? row.count : (await compatible(chapter, signal)).hits.length;
          ensure(signal);
          if (!Number.isSafeInteger(count) || count < 0) throw new Error('书内搜索计数无效');
          if (count) found.push({ chapter, first: state.count, count, native });
          const first = count > 0 && state.count === 0;
          state = { ...state, completed: state.completed + 1, count: state.count + count };
          if (first || performance.now() - lastUpdate >= 40) { publish(); lastUpdate = performance.now(); }
          if (first || performance.now() - lastYield >= 8) {
            await sources.yieldToHost();
            ensure(signal);
            lastYield = performance.now();
          }
        }
      }
      ensure(signal);
      state = { ...state, status: 'complete' };
      publish();
    } catch (error) {
      if (!signal.aborted && !lifetime.signal.aborted) { state = { ...state, status: 'error', error }; publish(); }
    }
    return { ...state };
  }
  function resume() {
    if (state.status === 'paused' || state.status === 'error') {
      state = { ...state, status: 'scanning', error: undefined };
      const controller = new AbortController();
      run = controller;
      finished = new Promise<ReaderQuerySnapshot>((resolve, reject) => {
        settleRun = resolve;
        void Promise.resolve().then(() => scan(controller.signal)).then(resolve, reject);
      });
    }
    return finished;
  }
  function cancel() {
    if (lifetime.signal.aborted) return;
    lifetime.abort();
    run?.abort();
    options.signal?.removeEventListener('abort', cancel);
    found.length = 0;
    lastLocal = selectedChapter = undefined;
    state = { ...state, status: 'cancelled', count: 0 };
    settleRun?.({ ...state });
    finished = Promise.resolve({ ...state });
    publish();
  }
  function chapterAt(index: number) {
    let lo = 0, hi = found.length;
    while (lo < hi) {
      const mid = Math.floor((lo + hi) / 2);
      if (found[mid].first + found[mid].count <= index) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  }
  async function read(entry: FoundChapter, offset: number, limit: number, includeTarget = false) {
    const signal = lifetime.signal;
    ensure(signal);
    if (!entry.native) {
      const data = await compatible(entry.chapter, signal);
      if (data.hits.length !== entry.count) throw new Error('搜索章节内容已变更');
      return { kind: 'local' as const, ...data, hits: data.hits.slice(offset, offset + limit) };
    }
    const [row] = await sources.native!([entry.chapter.path], query.phrase, query.tokens, signal, { mode: 'window', offset, limit, includeTarget });
    ensure(signal);
    if (row?.kind !== 'window' || row.rows.length !== limit) throw new Error('书内搜索窗口回复无效');
    return row;
  }
  if (options.signal?.aborted) { cancel(); finished = Promise.resolve({ ...state }); }
  else { options.signal?.addEventListener('abort', cancel, { once: true }); resume(); }
  return {
    snapshot: () => ({ ...state }), get finished() { return finished; }, cancel, resume,
    pause() {
      if (state.status !== 'scanning') return;
      run?.abort();
      state = { ...state, status: 'paused' };
      settleRun?.({ ...state });
      publish();
    },
    async window(offset, limit) {
      ensure(lifetime.signal);
      if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(limit) || limit < 0 || limit > 128) throw new RangeError('无效的搜索结果窗口');
      const end = Math.min(state.count, offset + limit);
      const rows: SearchPreview[] = [];
      for (let i = chapterAt(offset); offset < end; i++) {
        const entry = found[i];
        const take = Math.min(end, entry.first + entry.count) - offset;
        const data = await read(entry, offset - entry.first, take);
        ensure(lifetime.signal);
        const id = sources.identity(entry.chapter);
        if (data.kind === 'window') rows.push(...data.rows.map(hit => nativePreview(id, hit)));
        else rows.push(...data.hits.map(hit => previewHit(id, data.display, hit)));
        offset += take;
      }
      return rows;
    },
    async resolve(index) {
      ensure(lifetime.signal);
      if (!Number.isSafeInteger(index) || index < 0 || index >= state.count) return undefined;
      const entry = found[chapterAt(index)];
      const data = await read(entry, index - entry.first, 1, true);
      ensure(lifetime.signal);
      const id = sources.identity(entry.chapter);
      if (data.kind === 'window') {
        const hit = data.rows[0];
        if (!hit.target) throw new Error('书内搜索定位回复无效');
        const { before, after, textHits, ...anchor } = hit.target;
        const originalRange = { start: Math.min(...hit.ranges.map(r => r[0])), end: Math.max(...hit.ranges.map(r => r[1])) };
        const hits = [...textHits].sort((a,b) => a.start - b.start || a.end - b.end);
        return { ...nativePreview(id, hit), ...anchor, originalRange, textHits, occurrence: { hits, before, after } };
      }
      if (selectedChapter?.chapter !== entry.chapter) {
        selectedChapter = { chapter: entry.chapter, resolve: resolveChapterHits(id, data.source, data.display, data.version) };
      }
      return selectedChapter.resolve(data.hits[0]);
    },
  };
}
