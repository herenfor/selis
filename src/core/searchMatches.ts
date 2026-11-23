import { BLOCK_BOUNDARY, MAX_ANCHOR_SNIPPET_CODE_POINTS, type SearchDocument } from "./corpus";
import { createChapterHitResolver, type RawTextRange } from "./exactTextHits";
import { captureSearchOccurrence } from "./searchOccurrence";
import type { compileBookQuery } from "./searchChapterText";
import type { ProjectedSearchChapter, SearchResult } from "./search";

const ANCHOR_WHITESPACE = /\p{White_Space}/u;

function publicText(text: string): string {
  return text.replaceAll(BLOCK_BOUNDARY, "\n");
}

/** Build the persisted-anchor snippet without copying/splitting the whole chapter. */
function anchorSnippetFromRaw(text: string, rawStart: number): string {
  const points: string[] = [];
  for (const point of text.slice(rawStart)) {
    if (point === BLOCK_BOUNDARY || ANCHOR_WHITESPACE.test(point)) continue;
    points.push(point);
    if (points.length >= MAX_ANCHOR_SNIPPET_CODE_POINTS) break;
  }
  return points.join("");
}

function* findAll(text: string, needle: string) {
  for (let start = text.indexOf(needle); start >= 0; start = text.indexOf(needle, start + needle.length)) yield start;
}

function snippetFor(text: string, ranges: Array<{ start: number; end: number }>): {
  snippet: string;
  matchRanges: Array<{ start: number; end: number }>;
  rawStart: number;
  rawEnd: number;
} {
  const before = 48;
  const after = 96;
  const rawStart = Math.min(...ranges.map((range) => range.start));
  const rawEnd = Math.max(...ranges.map((range) => range.end));
  const contextStart = Math.max(0, rawStart - before);
  const contextEnd = Math.min(text.length, rawEnd + after);
  const rawSnippet = publicText(text.slice(contextStart, contextEnd));
  const leading = rawSnippet.length - rawSnippet.trimStart().length;
  return {
    snippet: rawSnippet.trim(),
    rawStart,
    rawEnd,
    matchRanges: ranges.map((range) => ({
      start: Math.max(0, range.start - contextStart - leading),
      end: Math.max(0, range.end - contextStart - leading),
    })),
  };
}

function rawRangeFor(doc: SearchDocument, start: number, end: number): { start: number; end: number } {
  const first = doc.rawStarts[start];
  const last = doc.rawEnds[Math.max(start, end - 1)];
  const rawStart = first ?? 0;
  const rawEnd = last ?? rawStart;
  return { start: rawStart, end: rawEnd };
}

function codePointRangeForUnits(doc: SearchDocument, startUnit: number, endUnit: number): { start: number; end: number } {
  if (endUnit <= startUnit || startUnit < 0 || startUnit >= doc.normalized.length) {
    return { start: 0, end: 0 };
  }
  const start = doc.normalizedUnitToEntry[startUnit] ?? 0;
  const last = doc.normalizedUnitToEntry[Math.min(doc.normalized.length, endUnit) - 1] ?? start;
  return { start, end: last + 1 };
}

interface MatchGroup {
  matchType: SearchResult["matchType"];
  /** Normalized code-point ranges in the scanned document. */
  ranges: Array<{ start: number; end: number }>;
}

function* matchGroupsForDocument(doc: SearchDocument, { phrase, tokens }: ReturnType<typeof compileBookQuery>, starts?: readonly number[]): Generator<MatchGroup | null> {
  if (!phrase) return;
  for (const start of starts ?? findAll(doc.normalized, phrase)) {
    yield { matchType: "phrase", ranges: [codePointRangeForUnits(doc, start, start + phrase.length)] };
  }
  if (tokens.length < 2) return;
  for (let from = 0; from <= doc.normalized.length;) {
    const boundary = doc.normalized.indexOf(BLOCK_BOUNDARY, from);
    const end = boundary < 0 ? doc.normalized.length : boundary;
    const segment = doc.normalized.slice(from, end);
    const offsets = tokens.map(token => segment.indexOf(token));
    yield offsets.every(value => value >= 0) ? { matchType: "keywords", ranges: offsets.map((value, i) =>
      codePointRangeForUnits(doc, from + value, from + value + tokens[i].length)) } : null;
    from = end + 1;
  }
}

export interface ProjectedDocuments {
  source: SearchDocument;
  display: SearchDocument;
  projected: ProjectedSearchChapter;
}

export interface RawMatch {
  matchType: SearchResult['matchType'];
  ranges: RawTextRange[];
  sourceRanges?: RawTextRange[];
}

export type SearchPreview = Pick<SearchResult, 'spineIndex' | 'chapterPath' | 'chapterTitle' | 'snippet' | 'snippetMatchRanges' | 'matchType'>;
export type ChapterIdentity = Pick<SearchPreview, 'spineIndex' | 'chapterPath' | 'chapterTitle'>;
type Resolver = ReturnType<typeof createChapterHitResolver>;

function* rangeWork(doc: SearchDocument, query: ReturnType<typeof compileBookQuery>,
  projection?: ProjectedDocuments, limit = Infinity, starts?: readonly number[]): Generator<void, RawMatch[]> {
  const unique = new Map<string, { visible: number; original: number; hit: RawMatch }>();
  let sourceCheck: Resolver | undefined;
  let displayCheck: Resolver | undefined;
  const ordered: RawMatch[] = [];
  let steps = 0;
  for (const group of matchGroupsForDocument(doc, query, starts)) {
    if (++steps % 256 === 0) yield;
    if (!group) continue;
    if (!projection && query.tokens.length < 2) {
      const range = rawRangeFor(doc, group.ranges[0].start, group.ranges[0].end);
      const previous = ordered.at(-1)?.ranges[0];
      if (!previous || range.start !== previous.start || range.end !== previous.end) ordered.push({ matchType: 'phrase', ranges: [range] });
      if (ordered.length >= limit) break;
      continue;
    }
    const ranges = group.ranges.map(r => rawRangeFor(doc, r.start, r.end));
    const visible = Math.min(...ranges.map(r => r.start));
    const key = `${visible}:${Math.max(...ranges.map(r => r.end))}`;
    if (unique.has(key)) continue;
    const hit: RawMatch = { matchType: group.matchType, ranges };
    let original = visible;
    if (projection) {
      const mapped = ranges.map(r => projection.projected.toSourceRawRange(r.start, r.end));
      if (!mapped.every((r): r is RawTextRange => r !== null)) continue;
      sourceCheck ??= createChapterHitResolver(projection.source.text);
      displayCheck ??= projection.source === doc ? sourceCheck : createChapterHitResolver(doc.text);
      if (!mapped.every(sourceCheck.covers) || !ranges.every(displayCheck.covers)) continue;
      hit.sourceRanges = mapped;
      original = Math.min(...mapped.map(r => r.start));
    }
    unique.set(key, { visible, original, hit });
  }
  if (!projection && query.tokens.length < 2) return ordered;
  return [...unique.values()].sort((a,b) => a.original - b.original || a.visible - b.visible)
    .slice(0, limit).map(entry => entry.hit);
}

function chapterRanges(...args: Parameters<typeof rangeWork>): RawMatch[] {
  const work = rangeWork(...args);
  let step = work.next();
  while (!step.done) step = work.next();
  return step.value;
}

export async function scanChapterRanges(doc: SearchDocument, query: ReturnType<typeof compileBookQuery>,
  projection: ProjectedDocuments | undefined, signal: AbortSignal, yieldToHost: () => Promise<void>): Promise<RawMatch[]> {
  const work = rangeWork(doc, query, projection);
  let lastYield = performance.now();
  for (;;) {
    if (signal.aborted) throw new DOMException('搜索已取消', 'AbortError');
    const step = work.next();
    if (step.done) return step.value;
    if (performance.now() - lastYield >= 8) { await yieldToHost(); lastYield = performance.now(); }
  }
}

export function previewHit(id: ChapterIdentity, text: string, hit: RawMatch): SearchPreview {
  const snippet = snippetFor(text, hit.ranges);
  return { ...id, snippet: snippet.snippet, snippetMatchRanges: snippet.matchRanges, matchType: hit.matchType };
}

/** Create exact-text maps only when a caller asks for a navigation target. */
export function resolveChapterHits(id: ChapterIdentity, source: string, display = source, version?: string) {
  const sourceResolver = createChapterHitResolver(source);
  const displayResolver = display === source ? sourceResolver : createChapterHitResolver(display);
  return (hit: RawMatch): SearchResult => {
    const sourceRanges = hit.sourceRanges ?? hit.ranges;
    const start = Math.min(...sourceRanges.map(r => r.start));
    const end = Math.max(...sourceRanges.map(r => r.end));
    const exact = sourceResolver(sourceRanges);
    const displayStart = Math.min(...hit.ranges.map(r => r.start));
    const displayEnd = Math.max(...hit.ranges.map(r => r.end));
    const result: SearchResult = {
      ...previewHit(id, display, hit), originalRange: { start, end },
      textOffset: sourceResolver.offsetAt(start), textSnippet: anchorSnippetFromRaw(source, start),
      matchedText: publicText(display.slice(displayStart, displayEnd)), textHits: exact?.hits,
      occurrence: exact ? captureSearchOccurrence(exact.points, exact.hits) ?? undefined : undefined,
    };
    if (version !== undefined) {
      const mapped = displayResolver(hit.ranges)!;
      result.display = { projectionVersion: version, range: { start: displayStart, end: displayEnd },
        matchedText: result.matchedText, textHits: mapped.hits, occurrence: captureSearchOccurrence(mapped.points, mapped.hits)! };
    }
    return result;
  };
}

export function matchesForDocument(doc: SearchDocument, query: ReturnType<typeof compileBookQuery>, spineIndex: number,
  chapterPath: string, chapterTitle: string, limit: number, starts?: readonly number[]): SearchResult[] {
  const hits = chapterRanges(doc, query, undefined, limit, starts);
  return hits.length ? hits.map(resolveChapterHits({ spineIndex, chapterPath, chapterTitle }, doc.text)) : [];
}

export function projectedMatches(chapter: ProjectedDocuments, query: ReturnType<typeof compileBookQuery>,
  spineIndex: number, chapterPath: string, chapterTitle: string, version: string, limit: number): SearchResult[] {
  const hits = chapterRanges(chapter.display, query, chapter, limit);
  return hits.length ? hits.map(resolveChapterHits({ spineIndex, chapterPath, chapterTitle }, chapter.source.text, chapter.display.text, version)) : [];
}
