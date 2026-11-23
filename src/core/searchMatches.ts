import { BLOCK_BOUNDARY, MAX_ANCHOR_SNIPPET_CODE_POINTS, type SearchDocument } from "./corpus";
import { buildExactTextHitsAndPoints, createChapterHitResolver } from "./exactTextHits";
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

function findAll(haystack: string, needle: string, from = 0): number[] {
  const result: number[] = [];
  if (!needle) return result;
  let index = from;
  while ((index = haystack.indexOf(needle, index)) >= 0) {
    result.push(index);
    index += Math.max(1, needle.length);
  }
  return result;
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

function resultFor(
  doc: SearchDocument,
  start: number,
  spineIndex: number,
  chapterPath: string,
  chapterTitle: string,
  matchType: SearchResult["matchType"],
  normalizedRanges: Array<{ start: number; end: number }>,
  exact?: ReturnType<typeof createChapterHitResolver>,
): SearchResult {
  const rawRanges = normalizedRanges.map((range) => rawRangeFor(doc, range.start, range.end));
  const snippet = snippetFor(doc.text, rawRanges);
  const rawStart = snippet.rawStart;
  const rawEnd = snippet.rawEnd;
  const anchorOffset = doc.anchorStarts[start] ?? 0;
  const exactHits = exact ? exact(rawRanges) : buildExactTextHitsAndPoints(doc.text, rawRanges);
  const textHits = exactHits?.hits;
  const occurrence = exactHits && textHits
    ? captureSearchOccurrence(exactHits.points, textHits) ?? undefined
    : undefined;
  return {
    spineIndex,
    chapterPath,
    chapterTitle,
    snippet: snippet.snippet,
    snippetMatchRanges: snippet.matchRanges,
    originalRange: { start: rawStart, end: rawEnd },
    textOffset: anchorOffset,
    textSnippet: anchorSnippetFromRaw(doc.text, rawStart),
    matchedText: publicText(doc.text.slice(rawStart, rawEnd)),
    textHits,
    occurrence,
    matchType,
  };
}

interface MatchGroup {
  matchType: SearchResult["matchType"];
  /** Normalized code-point ranges in the scanned document. */
  ranges: Array<{ start: number; end: number }>;
}

function matchGroupsForDocument(doc: SearchDocument, { phrase, tokens }: ReturnType<typeof compileBookQuery>, starts?: readonly number[]): MatchGroup[] {
  if (!phrase) return [];
  const groups: MatchGroup[] = [];
  for (const startUnit of starts ?? findAll(doc.normalized, phrase)) {
    const range = codePointRangeForUnits(doc, startUnit, startUnit + phrase.length);
    groups.push({ matchType: "phrase", ranges: [range] });
  }
  if (tokens.length < 2) return groups;
  let segmentStart = 0;
  for (let i = 0; i <= doc.normalized.length; i++) {
    if (i !== doc.normalized.length && doc.normalized[i] !== BLOCK_BOUNDARY) continue;
    const segment = doc.normalized.slice(segmentStart, i);
    const tokenStarts = tokens.map((token) => segment.indexOf(token));
    if (tokenStarts.every((value) => value >= 0)) {
      const ranges = tokenStarts.map((value, index) => codePointRangeForUnits(
        doc,
        segmentStart + value,
        segmentStart + value + tokens[index].length,
      ));
      groups.push({ matchType: "keywords", ranges });
    }
    segmentStart = i + 1;
  }
  return groups;
}

function resultForGroup(
  doc: SearchDocument,
  group: MatchGroup,
  spineIndex: number,
  chapterPath: string,
  chapterTitle: string,
  exact?: ReturnType<typeof createChapterHitResolver>,
): SearchResult {
  return resultFor(
    doc,
    Math.min(...group.ranges.map((range) => range.start)),
    spineIndex,
    chapterPath,
    chapterTitle,
    group.matchType,
    group.ranges, exact,
  );
}

export function matchesForDocument(
  doc: SearchDocument, query: ReturnType<typeof compileBookQuery>, spineIndex: number, path: string,
  title: string, limit: number, starts?: readonly number[],
): SearchResult[] {
  const groups = matchGroupsForDocument(doc, query, starts);
  // Phrase groups precede keyword groups; keep the phrase when both cover the same original range.
  const unique = new Map<string, { start: number; group: MatchGroup }>();
  for (const group of groups) {
    const ranges = group.ranges.map(range => rawRangeFor(doc, range.start, range.end));
    const start = Math.min(...ranges.map(r => r.start));
    const key = `${start}:${Math.max(...ranges.map(r => r.end))}`;
    if (!unique.has(key)) unique.set(key, { start, group });
    if (query.tokens.length < 2 && unique.size >= limit) break;
  }
  const selected = [...unique.values()].sort((a, b) => a.start - b.start).slice(0, limit);
  const exact = selected.length > 1 ? createChapterHitResolver(doc.text) : undefined;
  return selected.map(({group}) => resultForGroup(doc, group, spineIndex, path, title, exact));
}

function displayResultForGroup(
  sourceDoc: SearchDocument,
  displayDoc: SearchDocument,
  displayGroup: MatchGroup,
  sourceRanges: ReadonlyArray<{ start: number; end: number }>,
  projectionVersion: string,
  spineIndex: number,
  chapterPath: string,
  chapterTitle: string,
  sourceResolver: ReturnType<typeof createChapterHitResolver>,
  displayResolver: ReturnType<typeof createChapterHitResolver>,
): SearchResult | null {
  const displayRawRanges = displayGroup.ranges.map((range) =>
    rawRangeFor(displayDoc, range.start, range.end),
  );
  if (displayRawRanges.some((range) => range.end <= range.start)) return null;
  const sourceExact = sourceResolver(sourceRanges);
  const displayExact = displayResolver(displayRawRanges);
  if (!sourceExact || !displayExact || sourceExact.hits.length === 0) return null;
  const sourceRawStart = Math.min(...sourceRanges.map((range) => range.start));
  const sourceRawEnd = Math.max(...sourceRanges.map((range) => range.end));
  const displayRawStart = Math.min(...displayRawRanges.map((range) => range.start));
  const displayRawEnd = Math.max(...displayRawRanges.map((range) => range.end));
  const displaySnippet = snippetFor(displayDoc.text, displayRawRanges);
  const displayHits = displayExact.hits;
  const displayOccurrence = captureSearchOccurrence(displayExact.points, displayHits);
  if (!displayOccurrence) return null;
  return {
    spineIndex,
    chapterPath,
    chapterTitle,
    snippet: displaySnippet.snippet,
    snippetMatchRanges: displaySnippet.matchRanges,
    originalRange: { start: sourceRawStart, end: sourceRawEnd },
    textOffset: Math.min(...sourceExact.hits.map((hit) => hit.start)),
    textSnippet: anchorSnippetFromRaw(sourceDoc.text, sourceRawStart),
    matchedText: publicText(displayDoc.text.slice(displayRawStart, displayRawEnd)),
    textHits: sourceExact.hits,
    occurrence: captureSearchOccurrence(sourceExact.points, sourceExact.hits) ?? undefined,
    display: {
      projectionVersion,
      range: { start: displayRawStart, end: displayRawEnd },
      matchedText: publicText(displayDoc.text.slice(displayRawStart, displayRawEnd)),
      textHits: displayHits,
      occurrence: displayOccurrence,
    },
    matchType: displayGroup.matchType,
  };
}

export interface ProjectedDocuments {
  source: SearchDocument;
  display: SearchDocument;
  projected: ProjectedSearchChapter;
}

export function projectedMatches(chapter: ProjectedDocuments, compiled: ReturnType<typeof compileBookQuery>,
  index: number, path: string, title: string, version: string, limit: number): SearchResult[] {
  const groups = matchGroupsForDocument(chapter.display, compiled);
  if (!groups.length) return [];
  const sourceResolver = createChapterHitResolver(chapter.source.text);
  const displayResolver = chapter.source === chapter.display ? sourceResolver : createChapterHitResolver(chapter.display.text);
  const chapterResults: SearchResult[] = [];
  const projected = chapter.projected;

  for (const group of groups) {
    const sourceRanges: Array<{ start: number; end: number }> = [];
    let mapped = true;
    for (const range of group.ranges) {
      const displayRaw = rawRangeFor(chapter.display, range.start, range.end);
      const sourceRaw = projected.toSourceRawRange(displayRaw.start, displayRaw.end);
      if (!sourceRaw) {
        mapped = false;
        break;
      }
      sourceRanges.push(sourceRaw);
    }
    if (!mapped) continue;
    const result = displayResultForGroup(
      chapter.source,
      chapter.display,
      group,
      sourceRanges,
      version,
      index,
      path,
      title, sourceResolver, displayResolver,
    );
    if (result) chapterResults.push(result);
  }
  // Phrase wins over keyword duplicates of the same visible
  // occurrence. Different display occurrences are never removed
  // merely because they map back to one non-invertible fragment.
  const uniqueChapter = new Map<string, SearchResult>();
  for (const result of chapterResults) {
    const key = `${result.display?.range.start ?? -1}:${result.display?.range.end ?? -1}`;
    const previous = uniqueChapter.get(key);
    if (!previous || (previous.matchType === "keywords" && result.matchType === "phrase")) {
      uniqueChapter.set(key, result);
    }
  }
  const uniqueResults = [...uniqueChapter.values()].sort((a, b) =>
    a.originalRange.start - b.originalRange.start ||
    (a.display?.range.start ?? 0) - (b.display?.range.start ?? 0),
  );
  return uniqueResults.slice(0, limit);
}
